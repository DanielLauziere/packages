import { SEED_ORDER } from './generatedSchema.js'
import type { DbAdapter } from './dbAdapter.js'

export type Seed = Record<string, unknown[]>

// tableInfo returns the table's real column names and primary-key columns via
// PRAGMA, or null when the adapter can't introspect (engine-level schema-
// agnosticism: we never trust bundled column metadata for the LIVE schema).
// When null, the seeder falls back to deriving columns from the rows themselves.
function tableInfo(db: DbAdapter, table: string): { columns: string[]; pk: string[] } | null {
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

// tableEmpty distinguishes the two seeding modes at runtime:
//   - empty table → full wipe/rebuild → INSERT OR REPLACE is safe (nothing to
//     cascade) and preserves SQLite's default-substitution for explicit NULL
//     (legacy behavior, relied on by partial snapshot rows).
//   - non-empty table → heal/repair over live data → UPSERT, so a conflict
//     updates in place instead of DELETE+INSERT (which fires ON DELETE
//     CASCADE and would silently wipe ticket/order rows).
function tableEmpty(db: DbAdapter, table: string): boolean {
  try {
    const rows = db.query(`SELECT 1 FROM "${table}" LIMIT 1`)
    return rows.length === 0
  } catch {
    return false
  }
}

// seedDatabase inserts every row from the server payload into SQLite. The
// column set is derived from the schema itself (PRAGMA introspection when
// available; otherwise the rows' own keys): under the snake_case wire contract
// the payload key IS the SQLite column name (§5.5a) and the local DB is
// rebuilt from the authoritative snapshot DDL, so no bundled column metadata
// is needed. This is what makes "add a new table/column with zero client
// release" true (CORE-LOGIC-SCHEMA-SYNC.md).
//
// Two write modes, chosen per table at runtime (tableEmpty):
//   - Empty table (full wipe/rebuild): INSERT OR REPLACE. Nothing exists to
//     cascade, so it's safe, and SQLite substitutes column DEFAULTS for
//     explicit NULLs — legacy behavior partial snapshot rows rely on.
//   - Non-empty table (heal/repair over live data): UPSERT off the table's
//     primary key (ON CONFLICT DO UPDATE). INSERT OR REPLACE is forbidden
//     here — it fires ON DELETE CASCADE on child tables (ticket,
//     ticket_menu_item, ticket_promotion, ticket_payment reference
//     menu_item/fulfillment/dining_table/promotion/payment), which would
//     silently wipe live order data on every heal. Tables WITHOUT a primary
//     key (the join table combo_menu_item) keep INSERT OR REPLACE: nothing
//     references them, so the delete+reinsert cannot cascade.
//
// - Per-row isolation: one bad row never aborts the whole seed.
// - Missing fields in a row map to NULL (AGENTS.md null/undefined contract);
//   empty string stays '', booleans → 0/1; unknown keys are dropped.
//
// `order` is the FK-topological seed order from the server descriptor; when
// omitted, the payload's own key order is used.
export function seedDatabase(db: DbAdapter, seed: Seed, order?: string[]): void {
  const tableOrder = order && order.length ? order : Object.keys(seed)

  for (const table of tableOrder) {
    const rows = seed[table]
    if (!Array.isArray(rows)) continue
    const recordRows = rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')

    // Column set: real table columns when introspectable, else union of the
    // rows' own keys (fixed once per table; row 0 junk is then filtered out).
    const info = tableInfo(db, table)
    let columns: string[]
    let pk: string[] = []
    if (info) {
      columns = info.columns
      pk = info.pk
    } else {
      const seen = new Set<string>()
      for (const r of recordRows) for (const k of Object.keys(r)) seen.add(k)
      columns = Array.from(seen)
    }
    if (columns.length === 0) continue

    // No PK → leaf join table (combo_menu_item); OR REPLACE cannot cascade
    // (nothing references it) and keeps default-substitution on rebuild.
    if (pk.length === 0 || tableEmpty(db, table)) {
      const quoted = columns.map((n) => `"${n}"`).join(',')
      const placeholders = columns.map(() => '?').join(',')
      const sql = `INSERT OR REPLACE INTO "${table}" (${quoted}) VALUES (${placeholders})`
      writeRows(db, table, sql, columns, recordRows)
      continue
    }

    // PK-backed, non-empty table → non-destructive upsert on the PK. DO
    // UPDATE SET may not reference the PK columns, hence the filter.
    const pkBare = `(${pk.map((n) => `"${n}"`).join(',')})`
    const pkSet = new Set(pk)
    const updateCols = columns.filter((n) => !pkSet.has(n))
    const quoted = columns.map((n) => `"${n}"`).join(',')
    const placeholders = columns.map(() => '?').join(',')
    const updateClause =
      updateCols.length > 0
        ? `DO UPDATE SET ${updateCols.map((n) => `"${n}"=excluded."${n}"`).join(',')}`
        : 'DO NOTHING'
    const sql = `INSERT INTO "${table}" (${quoted}) VALUES (${placeholders}) ON CONFLICT ${pkBare} ${updateClause}`
    writeRows(db, table, sql, columns, recordRows)
  }
}

function writeRows(db: DbAdapter, table: string, sql: string, columns: string[], rows: Array<Record<string, unknown>>): void {
  for (const record of rows) {
    const values: unknown[] = []
    for (const key of columns) {
      let value = record[key]
      if (value === undefined) value = null
      else if (typeof value === 'boolean') value = value ? 1 : 0
      values.push(value)
    }

    try {
      db.run(sql, values)
    } catch (err) {
      const tag = (record.uuid ?? record.id ?? '[no-key]') as string
      console.error(`🌱 seed ${table} ${tag}: ${(err as Error).message}`)
    }
  }
}

// seedOrder is transitional: used only when a server predates the rollout and
// offers no descriptor seed_order. Bundled SEED_ORDER is a generated fallback.
export function seedOrder(): string[] {
  return SEED_ORDER.slice()
}