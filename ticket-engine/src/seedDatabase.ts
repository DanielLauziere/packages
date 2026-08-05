import { SEED_ORDER, SEED_COLUMNS, type EngineColumn } from './generatedSchema.js'
import type { DbAdapter } from './dbAdapter.js'

export type Seed = Record<string, unknown[]>

function defaultFor(col: EngineColumn): unknown {
  if (col.default === undefined) return undefined
  const d = col.default
  if (col.type === 'INTEGER' || col.type === 'REAL') {
    if (d === 'true') return 1
    if (d === 'false') return 0
    const n = Number(d)
    if (!Number.isNaN(n)) return n
  }
  return undefined
}

// zeroFor returns a NOT NULL-compatible placeholder for a column that must be
// non-null but arrived empty/absent with no declared DEFAULT. This satisfies the
// shared schema's NOT NULL constraint (never silently drops a NOT NULL column)
// so a single row can't brick the whole seed. '' for text, 0 for numbers.
function zeroFor(col: EngineColumn): unknown {
  if (col.type === 'INTEGER' || col.type === 'REAL') return 0
  return ''
}

// seedDatabase inserts every row from the server payload into SQLite, mapped
// from snake_case wire keys (one naming scheme, §5.5a) to SQLite columns —
// identity, no key translation. Per-row isolation: one bad row never aborts
// the whole seed. NOT NULL columns missing from a row are filled with their
// declared default when one exists.
export function seedDatabase(db: DbAdapter, seed: Seed): void {
  for (const table of SEED_ORDER) {
    const payloadKey = table
    const rows = seed[payloadKey]
    if (!Array.isArray(rows)) continue

    const cols = SEED_COLUMNS[table]
    if (!cols) continue

    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const record = row as Record<string, unknown>

      const names: string[] = []
      const values: unknown[] = []

      for (const key of Object.keys(cols)) {
        const col = cols[key]
        let value: unknown
        if (key in record) {
          value = record[key]
          if (value === '') value = null
          else if (typeof value === 'boolean') value = value ? 1 : 0
        } else if (col.nullable) {
          continue
        } else {
          value = defaultFor(col)
          if (value === undefined) value = zeroFor(col)
        }

        if (value === null && !col.nullable) {
          const filled = defaultFor(col)
          if (filled === undefined) value = zeroFor(col)
          else value = filled
        }

        names.push(col.name)
        values.push(value)
      }

      if (names.length === 0) continue

      const placeholders = names.map(() => '?').join(',')
      const quoted = names.map((n) => `"${n}"`).join(',')
      const sql = `INSERT OR REPLACE INTO "${table}" (${quoted}) VALUES (${placeholders})`

      try {
        db.run(sql, values)
      } catch (err) {
        const key = (record.uuid ?? record.id ?? '[no-key]') as string
        console.error(`🌱 seed ${table} ${key}: ${(err as Error).message}`)
      }
    }
  }
}

// seedOrder returns the FK-topological seed order of SQLite table names.
export function seedOrder(): string[] {
  return SEED_ORDER.slice()
}
