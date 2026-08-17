import type { DbAdapter } from './dbAdapter.js'
import { dbColumnName, dbTableName } from './rowMapping.js'
import { SEED_COLUMNS } from './generatedSchema.js'

export type Seed = Record<string, unknown[]>

export interface BuiltStatement {
  sql: string
  values: unknown[]
}

export function normalizeValue(v: unknown): unknown {
  // Empty string stays '' (AGENTS.md §null/empty contract). Never nulled.
  if (typeof v === 'boolean') return v ? 1 : 0
  return v
}

// keepSchemaKeys filters a wire row down to the columns that actually exist in
// the union schema (schema-driven column mapping — Phase 5, replacing key-copy).
// Under the snake_case wire contract the payload key IS the column, so this is
// a plain intersection with SEED_COLUMNS keys (identity).
export function keepSchemaKeys(table: string, record: Record<string, unknown>): Record<string, unknown> {
  const cols = SEED_COLUMNS[dbTableName(table)]
  if (!cols) return record
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(record)) {
    if (key in cols) out[key] = record[key]
  }
  return out
}

export function buildInsert(table: string, record: Record<string, unknown>): BuiltStatement | null {
  record = keepSchemaKeys(table, record)
  const keys = Object.keys(record)
  if (keys.length === 0) return null

  const placeholders = keys.map(() => '?').join(',')
  const values = keys.map((k) => normalizeValue(record[k]))

  const sql = `
    INSERT OR REPLACE INTO "${dbTableName(table)}"
    (${keys.map((k) => `"${dbColumnName(k)}"`).join(',')})
    VALUES (${placeholders})
  `

  return { sql, values }
}

export function buildUpsert(table: string, record: Record<string, unknown>): BuiltStatement | null {
  record = keepSchemaKeys(table, record)
  const keys = Object.keys(record)
  if (keys.length === 0) return null

  const placeholders = keys.map(() => '?').join(',')
  const values = keys.map((k) => normalizeValue(record[k]))
  const updateKeys = keys.filter((k) => k !== 'uuid')

  const sql = `
    INSERT INTO "${dbTableName(table)}"
    (${keys.map((k) => `"${dbColumnName(k)}"`).join(',')})
    VALUES (${placeholders})
    ON CONFLICT("uuid") DO UPDATE SET
    ${updateKeys.map((k) => `"${dbColumnName(k)}" = excluded."${dbColumnName(k)}"`).join(',')}
  `

  return { sql, values }
}

// withSeedTransaction wraps a seed body in BEGIN/COMMIT with ROLLBACK on error,
// so a failed seed never leaves a half-applied snapshot.
export function withSeedTransaction(db: DbAdapter, work: () => void): void {
  db.run('BEGIN')

  try {
    work()
    db.run('COMMIT')
  } catch (err) {
    try {
      db.run('ROLLBACK')
    } catch {
      // ignore nested error
    }
    throw err
  }
}

// runRow executes a single seed write with per-row isolation (ticket-engine
// rule 7): a malformed row is logged and skipped, never aborting the seed.
// `tag` is the full log prefix, e.g. `seedMenu menu_item <uuid>`.
export function runRow(db: DbAdapter, stmt: BuiltStatement, tag: string): void {
  try {
    db.run(stmt.sql, stmt.values)
  } catch (err) {
    console.error(`🌱 ${tag}: ${(err as Error).message}`)
  }
}
