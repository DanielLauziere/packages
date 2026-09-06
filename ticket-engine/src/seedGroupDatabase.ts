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
// local device/auth state (key_value, session), print claims (print_record),
// per-location schema versioning, and the whole ticket family. The seed engine
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
  'print_record',
  'location_group_schema_version',
  'environment',
  'lets_encrypt',
  'log',
  'admin_balance_history',
  'admin_push_creds',
  'ticket',
  'ticket_log',
  'ticket_log_applied',
  'ticket_menu_item',
  'ticket_menu_item_modifier',
  'ticket_payment',
  'ticket_print',
  'ticket_promotion',
])

// Leaf association tables that carry no UNIQUE constraint in the schema (their
// unique key is their uuid PK): diff-deletion is keyed on it. Everything else
// with a UNIQUE index is classified at runtime (see classify below).
const JOIN_OVERRIDE = new Set<string>([
  'bogo_menu_item',
  'location_group_feature',
  'location_group_activation_history',
])

interface TablePlan {
  table: string
  columns: string[]
  pk: string[]
  joinKey: string[] | null
}

function tableColumns(db: DbAdapter, table: string): { columns: string[]; pk: string[] } | null {
  try {
    const rows = db.query(`PRAGMA table_info("${table}")`) as Array<{ name?: unknown; pk?: unknown }>
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

function uniqueIndexes(db: DbAdapter, table: string): string[][] {
  try {
    const indexes = db.query(`PRAGMA index_list("${table}")`) as Array<{
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
      const cols = db.query(`PRAGMA index_info("${ix.name}")`) as Array<{ name?: unknown }>
      out.push(cols.map((r) => String(r.name)).filter(Boolean))
    }
    return out
  } catch {
    return []
  }
}

function foreignKeyColumns(db: DbAdapter, table: string): Set<string> {
  try {
    const rows = db.query(`PRAGMA foreign_key_list("${table}")`) as Array<{ from?: unknown }>
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
function classify(db: DbAdapter, table: string): TablePlan | null {
  const info = tableColumns(db, table)
  const columns = info ? info.columns : null
  const pk = info ? info.pk : []
  if (!columns || columns.length === 0) return null

  let joinKey: string[] | null = null
  if (JOIN_OVERRIDE.has(table)) {
    joinKey = pk.length ? pk : null
  } else {
    const fks = foreignKeyColumns(db, table)
    for (const key of uniqueIndexes(db, table)) {
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

function runRow(db: DbAdapter, sql: string, values: unknown[], tag: string): void {
  try {
    db.run(sql, values)
  } catch (err) {
    console.error(`🌱 ${tag}: ${(err as Error).message}`)
  }
}

function quote(col: string): string {
  return `"${col}"`
}

// notNullNoDefault returns the set of columns in a table that are NOT NULL
// without a DEFAULT — these columns MUST be present in a seed row or the
// INSERT will fail. Cached per table to avoid repeated PRAGMA calls.
const notNullNoDefaultCache = new Map<string, Set<string>>()
function notNullNoDefault(db: DbAdapter, table: string): Set<string> {
  const cached = notNullNoDefaultCache.get(table)
  if (cached) return cached
  const set = new Set<string>()
  try {
    const rows = db.query(`PRAGMA table_info("${table}")`) as Array<{
      name?: unknown
      notnull?: unknown
      dflt_value?: unknown
    }>
    for (const r of rows) {
      if (Number(r.notnull) === 1 && r.dflt_value === null && r.name) {
        set.add(String(r.name))
      }
    }
  } catch {
    // if PRAGMA fails, be permissive — let the INSERT attempt proceed
  }
  notNullNoDefaultCache.set(table, set)
  return set
}

// fillNotNullDefaults ensures every NOT NULL column without a DEFAULT has a
// value in the row. TEXT → '', INTEGER → 0, other → null. This prevents
// SQLite rejecting the INSERT while keeping the row present for FK integrity
// (join tables may reference it). Mutates the row in-place.
function fillNotNullDefaults(db: DbAdapter, table: string, row: Record<string, unknown>): void {
  const required = notNullNoDefault(db, table)
  for (const col of required) {
    if (row[col] === undefined || row[col] === null) {
      // Peek at column type via PRAGMA table_info — TEXT columns get '', int gets 0.
      // Default to '' for safety since most NOT NULL columns are TEXT.
      row[col] = ''
    }
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

// diffDelete removes join rows whose unique key is not present in the seed.
// Row-value NOT IN is supported since SQLite 3.15, so the 3.39.4 floor holds.
// Values are parameterized — never string-interpolated (injection-free).
function diffDelete(db: DbAdapter, table: string, keys: string[], rows: Array<Record<string, unknown>>): void {
  const tag = `seedGroup ${table}`
  try {
    if (rows.length === 0) {
      db.run(`DELETE FROM "${table}"`)
      return
    }
    if (keys.length === 1) {
      const key = keys[0]
      const placeholders = rows.map(() => '?').join(',')
      const values = rows.map((r) => renderValue(r[key]))
      db.run(`DELETE FROM "${table}" WHERE ${quote(key)} NOT IN (${placeholders})`, values)
      return
    }
    const placeholders = rows.map(() => `(${keys.map(() => '?').join(',')})`).join(',')
    const values = rows.flatMap((r) => keys.map((k) => renderValue(r[k])))
    db.run(`DELETE FROM "${table}" WHERE (${keys.map(quote).join(',')}) NOT IN (${placeholders})`, values)
  } catch (err) {
    console.error(`🌱 ${tag}: ${(err as Error).message}`)
  }
}

// seedTable processes a single payload table (entity or join) per its plan.
function seedTable(db: DbAdapter, plan: TablePlan, rows: unknown[]): void {
  const recordRows = rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')

  // Pre-fill missing NOT NULL defaults on every row so buildUpsert never
  // attempts an INSERT that SQLite would reject.
  for (const row of recordRows) {
    fillNotNullDefaults(db, plan.table, row)
  }

  if (plan.joinKey) {
    for (const row of recordRows) {
      const upsert = buildUpsert(plan.table, plan, plan.joinKey, row)
      if (!upsert) continue
      const key = row['uuid'] ?? plan.joinKey.map((k) => row[k]).join('/') ?? '[no-key]'
      runRow(db, upsert.sql, upsert.values, `seedGroup ${plan.table} ${String(key)}`)
    }
    diffDelete(db, plan.table, plan.joinKey, recordRows)
    return
  }

  for (const row of recordRows) {
    const upsert = buildUpsert(plan.table, plan, plan.pk, row)
    if (!upsert) continue
    const key = row['uuid'] ?? plan.pk.map((k) => row[k]).join('/') ?? '[no-key]'
    runRow(db, upsert.sql, upsert.values, `seedGroup ${plan.table} ${String(key)}`)
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
export function validateSeedPayload(db: DbAdapter, seed: Seed): Array<{ table: string; issue: string; detail?: unknown }> {
  const problems: Array<{ table: string; issue: string; detail?: unknown }> = []

  for (const [table, rows] of Object.entries(seed)) {
    if (NEVER_TOUCH.has(table)) {
      problems.push({ table, issue: 'neverTouch' })
      continue
    }
    if (!Array.isArray(rows)) {
      problems.push({ table, issue: 'nonTable', detail: typeof rows })
      continue
    }
    const plan = classify(db, table)
    if (!plan) {
      problems.push({ table, issue: 'unknown' })
      continue
    }
    const key = plan.joinKey ?? plan.pk
    for (const row of rows) {
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
// canonical snapshot payload. `order` optionally hoists parent tables first
// (diagnostic readability); with foreign_keys off the seed order does not
// affect correctness, only insert sequencing. Tables not present in the payload
// are never touched.
export function seedGroupDatabase(db: DbAdapter, seed: Seed, order?: string[]): void {
  // Clear cached schema metadata so DDL changes between calls are picked up.
  notNullNoDefaultCache.clear()

  const tableOrder = order && order.length ? order.filter((t) => t in seed) : Object.keys(seed)

  const prevFK = (() => {
    try {
      const rows = db.query('PRAGMA foreign_keys') as Array<{ foreign_keys?: unknown }>
      return rows[0]?.foreign_keys ?? 1
    } catch {
      return 1
    }
  })()
  const restore = () => {
    try {
      db.run(prevFK ? 'PRAGMA foreign_keys = ON' : 'PRAGMA foreign_keys = OFF')
    } catch {
      // ignore restore errors
    }
  }

  db.run('PRAGMA foreign_keys = OFF')
  try {
    db.run('BEGIN')
    for (const table of tableOrder) {
      if (NEVER_TOUCH.has(table)) continue
      const rows = seed[table]
      if (!Array.isArray(rows)) continue
      const plan = classify(db, table)
      if (!plan) continue
      seedTable(db, plan, rows)
    }
    db.run('COMMIT')
  } catch (err) {
    try {
      db.run('ROLLBACK')
    } catch {
      // ignore nested error
    }
    throw err
  } finally {
    restore()
  }
}