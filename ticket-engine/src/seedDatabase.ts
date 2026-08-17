import { SEED_ORDER } from './generatedSchema.js'
import type { DbAdapter } from './dbAdapter.js'

export type Seed = Record<string, unknown[]>

// tableColumns returns the table's real column names via PRAGMA, or null when
// the adapter can't introspect (engine-level schema-agnosticism: we never trust
// bundled column metadata for the LIVE schema). When null, seeder falls back
// to deriving columns from the rows themselves.
function tableColumns(db: DbAdapter, table: string): string[] | null {
  try {
    const rows = db.query(`PRAGMA table_info("${table}")`) as Array<{ name?: unknown }>
    if (rows.length === 0 || rows[0].name === undefined) return null
    return rows.map((r) => String(r.name))
  } catch {
    return null
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
// - Per-row isolation: one bad row never aborts the whole seed.
// - INSERT OR REPLACE: idempotent replay.
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
    const known = tableColumns(db, table)
    let columns: string[]
    if (known) {
      columns = known
    } else {
      const seen = new Set<string>()
      for (const r of recordRows) for (const k of Object.keys(r)) seen.add(k)
      columns = Array.from(seen)
    }
    if (columns.length === 0) continue

    const quoted = columns.map((n) => `"${n}"`).join(',')
    const placeholders = columns.map(() => '?').join(',')
    const sql = `INSERT OR REPLACE INTO "${table}" (${quoted}) VALUES (${placeholders})`

    for (const record of recordRows) {
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
}

// seedOrder is transitional: used only when a server predates the rollout and
// offers no descriptor seed_order. Bundled SEED_ORDER is a generated fallback.
export function seedOrder(): string[] {
  return SEED_ORDER.slice()
}