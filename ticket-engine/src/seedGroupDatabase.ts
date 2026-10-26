import type { DbAdapter } from './dbAdapter.js'
import { normalizeValue, type Seed } from './seedCommon.js'

// seedGroupDatabase is the single unified seed/reseed engine (§2 SEED-REFACTOR).
// It replaces the old dual path (seedMenuDatabase + seedRefDatabase) with ONE
// idempotent pass over a canonical group snapshot:
//
//   - ENTITY tables (settings, menu items, modifiers, promotions, tables,
//     fulfillments, admins, guests, ...) are UPSERTed by their uuid primary key
//     and NEVER deleted from.
//   - JOIN tables (menu_item_menu_category, combo_menu_item,
//     modifier_group_modifier, location_group_feature, ...) are UPSERTed by
//     their unique key, then diff-deleted: any row whose unique key is not
//     present in the seed is removed, so server-side removals stop lingering.
//   - Ticket/local tables are NEVER touched (defensive NEVER_TOUCH set below),
//     even if a malformed payload includes them.
//
// The whole pass runs in a single transaction with `foreign_keys` OFF, so
// parent/child ordering bugs cannot surface as FK violations (spec §2.2), and
// it is re-enabled on the way out. Per-row isolation: one bad row is logged and
// skipped, never aborting the seed.
//
// Only tables present in the payload are processed. A key present with an empty
// array means the server has zero rows for it: join tables are fully cleared,
// entity tables are left untouched. A key absent from the payload is ignored
// entirely — nothing is deleted for data that was not part of the snapshot.

// Tables that must survive any seed/reseed and are owned by other subsystems:
// local device/auth state (key_value, session), per-location schema versioning,
// and the whole ticket family. The seed engine
// must never write to them; a stray key in the payload is skipped, not applied.
//
// `admin_location` / `admin_location_permission` are intentionally NOT here: the
// server snapshot is the authoritative source for which location group an admin
// belongs to and their permissions (incl. the `owner` flag that drives the full
// dashboard nav). Skipping them would leave a logged-in admin unable to see
// their screens, so they are seeded like any other ref table.
//
// `guest_location_group` is intentionally NOT here either: guest loyalty points
// are server-authoritative (§9) and arrive via the snapshot, so the local app
// can read/display them and they refresh on every reseed. Skipping it would pin
// every guest's points at 0 locally — which is exactly why the itemless-reward
// and points e2e tests regressed after the seed refactor.
const NEVER_TOUCH = new Set<string>([
  'key_value',
  'session',
  'location_group_schema_version',
  'environment',
  'lets_encrypt',
  'location_group_balance_history',
  'admin_push_creds',
  'ticket',
  'ticket_log',
  'ticket_log_applied',
  'ticket_menu_item',
  'ticket_menu_item_modifier',
  'ticket_payment',
  'ticket_promotion',
])

// Leaf association tables that carry no UNIQUE constraint in the schema (their
// unique key is their uuid PK): diff-deletion is keyed on it. Everything else
// with a UNIQUE index is classified at runtime (see classify below).
const JOIN_OVERRIDE = new Set<string>([
  'bogo_menu_item',
  'location_group_feature',
  // admin_location_permission is a many-to-many join (admin_location ↔ permission)
  // with no UNIQUE constraint on its FK columns. Without this entry, classify()
  // treats it as an ENTITY table (upsert by uuid only, no diff-delete), so
  // permission rows the server stops sending linger indefinitely and the local
  // app reports stale permissions. JOIN_OVERRIDE forces diff-delete by uuid.
  'admin_location_permission',
  // floor_item is a leaf "one row per placed sprite" table keyed by its uuid
  // PK. classify() would treat it as ENTITY (upsert, no diff-delete), so items
  // the server drops in a whole-floor replace would linger locally forever.
  // JOIN_OVERRIDE forces diff-delete by uuid like admin_location_permission.
  'floor_item',
])

interface TablePlan {
  table: string
  columns: string[]
  pk: string[]
  joinKey: string[] | null
}

async function tableColumns(db: DbAdapter, table: string): Promise<{ columns: string[]; pk: string[] } | null> {
  try {
    const rows = await db.query(`PRAGMA table_info("${table}")`) as Array<{ name?: unknown; pk?: unknown }>
    if (rows.length === 0 || rows[0].name === undefined) return null
    const pk = rows
      .filter((r) => Number(r.pk) > 0)
      .sort((a, b) => Number(a.pk) - Number(b.pk))
      .map((r) => String(r.name))
    return { columns: rows.map((r) => String(r.name)), pk }
  } catch {
    return null
  }
}

async function uniqueIndexes(db: DbAdapter, table: string): Promise<string[][]> {
  try {
    const indexes = await db.query(`PRAGMA index_list("${table}")`) as Array<{
      name?: unknown
      unique?: unknown
      origin?: unknown
    }>
    const out: string[][] = []
    for (const ix of indexes) {
      // origin 'u' = an explicit UNIQUE constraint (PK is origin 'pk'; CREATE
      // UNIQUE INDEX is 'c'). We only auto-detect constraints; an explicit
      // CREATE UNIQUE INDEX must be added to JOIN_OVERRIDE if it needs diff
      // deletion.
      if (ix.origin !== 'u' || !ix.name) continue
      const cols = await db.query(`PRAGMA index_info("${ix.name}")`) as Array<{ name?: unknown }>
      out.push(cols.map((r) => String(r.name)).filter(Boolean))
    }
    return out
  } catch {
    return []
  }
}

async function foreignKeyColumns(db: DbAdapter, table: string): Promise<Set<string>> {
  try {
    const rows = await db.query(`PRAGMA foreign_key_list("${table}")`) as Array<{ from?: unknown }>
    return new Set(rows.map((r) => String(r.from)).filter(Boolean))
  } catch {
    return new Set()
  }
}

// classify decides entity vs join at runtime from live schema metadata:
//   - a table whose UNIQUE-index columns are ALL foreign-key columns is a JOIN
//     table (menu_item_menu_category, combo_menu_item, ...);
//   - a table with JOIN_OVERRIDE keyed by uuid is a JOIN table lacking a UNIQUE;
//   - everything else with a uuid primary key is an ENTITY (upsert by uuid).
async function classify(db: DbAdapter, table: string): Promise<TablePlan | null> {
  const info = await tableColumns(db, table)
  const columns = info ? info.columns : null
  const pk = info ? info.pk : []
  if (!columns || columns.length === 0) return null

  let joinKey: string[] | null = null
  if (JOIN_OVERRIDE.has(table)) {
    joinKey = pk.length ? pk : null
  } else {
    const fks = await foreignKeyColumns(db, table)
    for (const key of await uniqueIndexes(db, table)) {
      if (key.length && key.every((c) => fks.has(c))) {
        joinKey = key
        break
      }
    }
  }

  // A join table must have a usable conflict key AND be a leaf (nothing may
  // reference it, or diff-deletion would cascade FK side effects). Entity
  // tables are ever only upserted, so they need at least a primary key.
  if (joinKey && joinKey.length) {
    return { table, columns, pk, joinKey }
  }
  if (pk.length) {
    return { table, columns, pk, joinKey: null }
  }
  return null
}

function rowValues(columns: string[], row: Record<string, unknown>): unknown[] {
  return columns.map((c) => {
    const v = row[c]
    if (v === undefined) return null
    return normalizeValue(v)
  })
}

async function runRow(db: DbAdapter, sql: string, values: unknown[], tag: string): Promise<void> {
  try {
    await db.run(sql, values)
  } catch (err) {
    console.error(`🌱 ${tag}: ${(err as Error).message}`)
  }
}

function quote(col: string): string {
  return `"${col}"`
}

// notNullColumns returns the NOT NULL columns of a table split by whether they
// have a DEFAULT. Cached per table to avoid repeated PRAGMA calls.
interface NotNullInfo {
  noDefault: Set<string>
  withDefault: Set<string>
}
const notNullColumnsCache = new Map<string, NotNullInfo>()
async function notNullColumns(db: DbAdapter, table: string): Promise<NotNullInfo> {
  const cached = notNullColumnsCache.get(table)
  if (cached) return cached
  const info: NotNullInfo = { noDefault: new Set(), withDefault: new Set() }
  try {
    const rows = await db.query(`PRAGMA table_info("${table}")`) as Array<{
      name?: unknown
      notnull?: unknown
      dflt_value?: unknown
    }>
    for (const r of rows) {
      if (Number(r.notnull) !== 1 || !r.name) continue
      if (r.dflt_value === null) info.noDefault.add(String(r.name))
      else info.withDefault.add(String(r.name))
    }
  } catch {
    // if PRAGMA fails, be permissive — let the INSERT attempt proceed
  }
  notNullColumnsCache.set(table, info)
  return info
}

// fillNotNullDefaults normalizes NOT NULL columns before the upsert:
//   - no DEFAULT: a missing or null value is filled (''), so the INSERT never
//     trips the constraint and the row stays present for FK integrity.
//   - HAS a DEFAULT: an explicit null is dropped from the row (treated as
//     absent), so the column is omitted from the INSERT and SQLite applies the
//     default instead of rejecting the row — a forward-compat payload that
//     sends null for a defaulted NOT NULL column must not silently lose the row.
// Mutates the row in-place.
async function fillNotNullDefaults(db: DbAdapter, table: string, row: Record<string, unknown>): Promise<void> {
  const { noDefault, withDefault } = await notNullColumns(db, table)
  for (const col of noDefault) {
    if (row[col] === undefined || row[col] === null) {
      // Default to '' for safety since most NOT NULL columns are TEXT.
      row[col] = ''
    }
  }
  for (const col of withDefault) {
    if (row[col] === null) delete row[col]
  }
}

// buildUpsert produces an entity-style upsert against the given conflict key.
// Non-key columns are refreshed from the seed row; a null-safe WHERE clause
// skips the write entirely when every column equals its new value (spec §2.1:
// no-op updates are cheap to skip). SQLite 3.39.4 can reference `excluded` in
// the DO UPDATE WHERE clause and `IS`/`IS NOT` are null-safe comparisons.
//
// Rows missing a NOT NULL column (no DEFAULT) are filled with safe defaults
// rather than skipped — the hostile-seed contract (§8.2) requires the engine
// to tolerate missing keys without aborting the seed, and skipping would leave
// dangling FK references from join tables.
function buildUpsert(
  table: string,
  plan: TablePlan,
  keys: string[],
  row: Record<string, unknown>,
): { sql: string; values: unknown[] } | null {
  const keySet = new Set(keys)
  const insertCols = plan.columns.filter((c) => row[c] !== undefined)
  if (insertCols.length === 0) return null

  // Only refresh columns the seed row actually carries — a row that omits a
  // column never clobbers the stored value with a default/NULL (AGENTS.md
  // null/empty contract: missing field → null only when explicitly null).
  const updateCols = insertCols.filter((c) => !keySet.has(c))

  const values = rowValues(insertCols, row)
  const quotedCols = insertCols.map(quote).join(',')
  const placeholders = insertCols.map(() => '?').join(',')
  const conflictTarget = `(${keys.map(quote).join(',')})`

  if (updateCols.length === 0) {
    const sql = `INSERT INTO "${table}" (${quotedCols}) VALUES (${placeholders}) ON CONFLICT ${conflictTarget} DO NOTHING`
    return { sql, values }
  }

  const setClause = updateCols.map((c) => `${quote(c)}=excluded.${quote(c)}`).join(',')
  const eqClause = updateCols.map((c) => `${quote(c)} IS NOT excluded.${quote(c)}`).join(' OR ')
  const sql = `INSERT INTO "${table}" (${quotedCols}) VALUES (${placeholders}) ON CONFLICT ${conflictTarget} DO UPDATE SET ${setClause} WHERE ${eqClause}`
  return { sql, values }
}

function renderValue(v: unknown): unknown {
  return v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v
}

// reconcileGuestIdentities resolves guest-uuid divergence BEFORE any row is
// written (guest has a UNIQUE user_name in addition to its uuid PK, so a
// naive PK upsert aborts the whole seed — see core-logic-schema-boot.md
// "guest identity reconciliation").
//
// Divergence happens in the offline-first flow: a local SET_GUEST log mints
// uuidv5(user_name), while the server's own guest row (portal registration)
// uses a random uuid — two uuids, one user_name. The rule mirrors the apply
// engine (core-logic-ticket-logs.md: "an existing row with this user_name
// wins"): the LOCAL holder's uuid is authoritative.
//
//   - snapshot uuid NOT local, user_name held by a local row
//       → merge: rewrite the snapshot row's uuid to the local holder, and
//         remap every other payload row's references (guest_location_group,
//         guest_address, …) to it. The upsert then refreshes the local row's
//         columns instead of colliding on user_name.
//   - snapshot uuid IS local, but user_name owned by a different local row
//       → keep the local row's current user_name (uuid stays identity) so
//         the DO UPDATE cannot violate the UNIQUE index; other columns merge.
//
// Never touches ticket_* (NEVER_TOUCH). A pre-existing orphaned
// guest_location_group row (child committed under the divergent uuid by an
// earlier failed seed) heals via the normal join diff-delete: the remapped
// payload no longer carries its key.
async function reconcileGuestIdentities(db: DbAdapter, seed: Seed): Promise<void> {
  const payload = seed['guest']
  if (!Array.isArray(payload)) return
  const payloadRows = payload.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
  if (!payloadRows.length) return

  let localRows: Array<{ uuid?: unknown; user_name?: unknown }>
  try {
    localRows = await db.query(`SELECT "uuid", "user_name" FROM "guest"`) as typeof localRows
  } catch {
    return // guest table not created yet — the seed itself will surface the error
  }

  const nameToUuid = new Map<string, string>()
  const uuidToName = new Map<string, string>()
  for (const r of localRows) {
    const uuid = String(r.uuid ?? '')
    const name = String(r.user_name ?? '')
    if (uuid) {
      uuidToName.set(uuid, name)
      if (!nameToUuid.has(name)) nameToUuid.set(name, uuid)
    }
  }

  const remap = new Map<string, string>() // divergent snapshot uuid → local uuid
  for (const row of payloadRows) {
    const snapshotUuid = row['uuid'] === undefined || row['uuid'] === null ? '' : String(row['uuid'])
    if (!snapshotUuid) continue
    // Missing user_name becomes '' in fillNotNullDefaults — match it here.
    const name = row['user_name'] === undefined || row['user_name'] === null ? '' : String(row['user_name'])
    const holder = nameToUuid.get(name)
    if (!holder || holder === snapshotUuid) continue

    const localName = uuidToName.get(snapshotUuid)
    if (localName !== undefined) {
      // The snapshot uuid exists locally but another row owns the target
      // user_name (e.g. a server-side rename into a locally-claimed name).
      // Keep the local row's name rather than violating UNIQUE(user_name).
      row['user_name'] = localName
      console.error(`🌱 seedGroup guest ${snapshotUuid}: snapshot user_name "${name}" is owned by local guest ${holder} — keeping local name "${localName}"`)
    } else {
      // The offline row (uuidv5 or otherwise) already owns this user_name —
      // it wins; merge the snapshot row onto it.
      remap.set(snapshotUuid, holder)
      row['uuid'] = holder
      console.error(`🌱 seedGroup guest: snapshot uuid ${snapshotUuid} diverges from local ${holder} for user_name "${name}" — merging onto local uuid`)
    }
  }

  if (!remap.size) return
  for (const [table, rows] of Object.entries(seed)) {
    if (NEVER_TOUCH.has(table) || table === 'guest') continue
    const tableRows = rows === null ? [] : rows
    if (!Array.isArray(tableRows)) continue
    for (const row of tableRows) {
      if (!row || typeof row !== 'object') continue
      for (const [col, v] of Object.entries(row as Record<string, unknown>)) {
        if (typeof v !== 'string') continue
        const target = remap.get(v)
        if (target) (row as Record<string, unknown>)[col] = target
      }
    }
  }
}

// fkOrder returns the payload tables in FK-parent-first order when the caller
// passes no explicit `order` (the live schema-version reseed passes none, and
// payload key order is not FK-safe — e.g. the sync payload ships
// guest_location_group before guest). Children committing before their parents
// is what strands orphaned rows when a later table fails mid-seed (each
// classify() read flushes the atomic buffer as its own committed sub-batch).
// Dependencies outside the payload don't block. Cycles fall back to input
// order — FKs are OFF during the seed, so order only affects failure windows,
// never correctness.
async function fkOrder(db: DbAdapter, keys: string[]): Promise<string[]> {
  const all = new Set(keys)
  const deps = new Map<string, string[]>()
  for (const table of keys) {
    const parents: string[] = []
    try {
      const fks = await db.query(`PRAGMA foreign_key_list("${table}")`) as Array<{ table?: unknown }>
      for (const fk of fks) {
        const parent = String(fk.table ?? '')
        if (parent && parent !== table) parents.push(parent)
      }
    } catch {
      // unknown/unquotable key — treat as independent
    }
    deps.set(table, parents)
  }

  const remaining = keys.slice()
  const emitted = new Set<string>()
  const out: string[] = []
  while (remaining.length) {
    const idx = remaining.findIndex((t) =>
      (deps.get(t) ?? []).every((p) => !all.has(p) || emitted.has(p)),
    )
    const pick = idx === -1 ? 0 : idx // no ready table → cycle: emit in input order
    const table = remaining.splice(pick, 1)[0]!
    emitted.add(table)
    out.push(table)
  }
  return out
}

// diffDelete removes join rows whose unique key is not present in the seed.
// Row-value NOT IN is supported since SQLite 3.15, so the 3.39.4 floor holds.
// Values are parameterized — never string-interpolated (injection-free).
async function diffDelete(db: DbAdapter, table: string, keys: string[], rows: Array<Record<string, unknown>>): Promise<void> {
  const tag = `seedGroup ${table}`
  try {
    if (rows.length === 0) {
      await db.run(`DELETE FROM "${table}"`)
      return
    }
    if (keys.length === 1) {
      const key = keys[0]
      const placeholders = rows.map(() => '?').join(',')
      const values = rows.map((r) => renderValue(r[key]))
      await db.run(`DELETE FROM "${table}" WHERE ${quote(key)} NOT IN (${placeholders})`, values)
      return
    }
    const placeholders = rows.map(() => `(${keys.map(() => '?').join(',')})`).join(',')
    const values = rows.flatMap((r) => keys.map((k) => renderValue(r[k])))
    await db.run(`DELETE FROM "${table}" WHERE (${keys.map(quote).join(',')}) NOT IN (${placeholders})`, values)
  } catch (err) {
    console.error(`🌱 ${tag}: ${(err as Error).message}`)
  }
}

// seedTable processes a single payload table (entity or join) per its plan.
async function seedTable(db: DbAdapter, plan: TablePlan, rows: unknown[]): Promise<void> {
  const recordRows = rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')

  // Pre-fill missing NOT NULL defaults on every row so buildUpsert never
  // attempts an INSERT that SQLite would reject.
  for (const row of recordRows) {
    await fillNotNullDefaults(db, plan.table, row)
  }

  if (plan.joinKey) {
    for (const row of recordRows) {
      const upsert = buildUpsert(plan.table, plan, plan.joinKey, row)
      if (!upsert) continue
      const key = row['uuid'] ?? plan.joinKey.map((k) => row[k]).join('/') ?? '[no-key]'
      await runRow(db, upsert.sql, upsert.values, `seedGroup ${plan.table} ${String(key)}`)
    }
    await diffDelete(db, plan.table, plan.joinKey, recordRows)
    return
  }

  for (const row of recordRows) {
    const upsert = buildUpsert(plan.table, plan, plan.pk, row)
    if (!upsert) continue
    const key = row['uuid'] ?? plan.pk.map((k) => row[k]).join('/') ?? '[no-key]'
    await runRow(db, upsert.sql, upsert.values, `seedGroup ${plan.table} ${String(key)}`)
  }
}

// validateSeedPayload sanity-checks a canonical snapshot against the live
// schema WITHOUT writing anything (SEED-REFACTOR §1.4/§4.5). It reports:
//   - unknown: payload keys that are not tables in the schema (incl. the
//     harmless top-level seed_version scalar);
//   - neverTouch: payload keys that name protected tables the engine refuses to
//     seed;
//   - missingKeys: rows lacking their conflict key (entity pk or join unique);
//   - nonTable: payload values that are not arrays.
// An empty slice means the payload is complete and self-consistent with the
// schema — it will seed with no skipped tables and no un-keyed rows.
export async function validateSeedPayload(db: DbAdapter, seed: Seed): Promise<Array<{ table: string; issue: string; detail?: unknown }>> {
  const problems: Array<{ table: string; issue: string; detail?: unknown }> = []

  for (const [table, rows] of Object.entries(seed)) {
    if (NEVER_TOUCH.has(table)) {
      problems.push({ table, issue: 'neverTouch' })
      continue
    }
    // Normalize null → [] so servers that send null for
    // an empty table are treated as "delete all rows" (join tables),
    // not as a validation error.
    const normalizedRows = rows === null ? [] : rows
    if (!Array.isArray(normalizedRows)) {
      problems.push({ table, issue: 'nonTable', detail: typeof rows })
      continue
    }
    const plan = await classify(db, table)
    if (!plan) {
      problems.push({ table, issue: 'unknown' })
      continue
    }
    const key = plan.joinKey ?? plan.pk
    for (const row of normalizedRows) {
      if (typeof row !== 'object' || row === null) {
        problems.push({ table, issue: 'missingKeys', detail: 'row is not an object' })
        continue
      }
      const missing = key.filter((k) => (row as Record<string, unknown>)[k] === undefined || (row as Record<string, unknown>)[k] === null)
      if (missing.length) {
        problems.push({ table, issue: 'missingKeys', detail: missing })
      }
    }
  }

  return problems
}

// seedGroupDatabase seeds or re-seeds a restaurant group's SQLite DB from the
// canonical snapshot payload. `order` (the server's seed_order, passed by the
// boot path) hoists parent tables first; without it the tables are ordered
// from live FK metadata (fkOrder). Guest-uuid divergence is reconciled up
// front (reconcileGuestIdentities) so a snapshot guest colliding on the
// UNIQUE user_name merges onto the local row instead of aborting the seed.
// Tables not present in the payload are never touched.
export async function seedGroupDatabase(db: DbAdapter, seed: Seed, order?: string[]): Promise<void> {
  // Clear cached schema metadata so DDL changes between calls are picked up.
  notNullColumnsCache.clear()

  const tableOrder = order && order.length ? order.filter((t) => t in seed) : await fkOrder(db, Object.keys(seed))
  await reconcileGuestIdentities(db, seed)

  const prevFK = await (async () => {
    try {
      const rows = await db.query('PRAGMA foreign_keys') as Array<{ foreign_keys?: unknown }>
      return rows[0]?.foreign_keys ?? 1
    } catch {
      return 1
    }
  })()
  const restore = async () => {
    try {
      await db.run(prevFK ? 'PRAGMA foreign_keys = ON' : 'PRAGMA foreign_keys = OFF')
    } catch {
      // ignore restore errors
    }
  }

  await db.run('PRAGMA foreign_keys = OFF')
  try {
    await db.run('BEGIN')
    for (const table of tableOrder) {
      if (NEVER_TOUCH.has(table)) continue
      const rows = seed[table]
      const normalizedRows = rows === null ? [] : rows
      if (!Array.isArray(normalizedRows)) continue
      const plan = await classify(db, table)
      if (!plan) continue
      await seedTable(db, plan, normalizedRows)
    }
    await db.run('COMMIT')
  } catch (err) {
    try {
      await db.run('ROLLBACK')
    } catch {
      // ignore nested error
    }
    throw err
  } finally {
    await restore()
  }
}
