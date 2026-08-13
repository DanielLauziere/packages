import type { DbAdapter } from './dbAdapter.js'
import { dbColumnName, dbTableName } from './rowMapping.js'
import { SEED_COLUMNS } from './generatedSchema.js'

export type Seed = Record<string, unknown[]>

function normalizeValue(v: unknown): unknown {
  if (v === '') return null
  if (typeof v === 'boolean') return v ? 1 : 0
  return v
}

// keepSchemaKeys filters a wire row down to the columns that actually exist in
// the union schema (schema-driven column mapping — Phase 5, replacing key-copy).
// Under the snake_case wire contract the payload key IS the column, so this is
// a plain intersection with SEED_COLUMNS keys (identity).
function keepSchemaKeys(table: string, record: Record<string, unknown>): Record<string, unknown> {
  const cols = SEED_COLUMNS[dbTableName(table)]
  if (!cols) return record
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(record)) {
    if (key in cols) out[key] = record[key]
  }
  return out
}

function buildInsert(table: string, record: Record<string, unknown>) {
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

function buildUpsert(table: string, record: Record<string, unknown>) {
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

// Ref-only (non-menu) tables the schema-version counter covers, minus the menu
// family (handled by seedMenuDatabase).
//
// UPSERT — rows other tables depend on, so a delete+reinsert would violate FKs:
//   - location_group: referenced by menu, dining_table, promotion,
//     location_group_feature, location_group_activation_history,
//     location_group_printer, guest_location_group, etc.
//   - location_group_printer: referenced by location_group
//     (guest/kitchen_location_group_printer_uuid).
//   - promotion: referenced by ticket_promotion.
//   - dining_table: referenced by ticket (table_uuid).
const UPSERT_ORDER = [
  'location_group',
  'location_group_printer',
  'promotion',
  'dining_table',
]

// DELETE + reinsert — leaf tables, nothing references them (verified in
// generatedSchema.ts: no FK targets these tables), so deleting is FK-safe and
// clears rows the server no longer sends.
const DELETE_ORDER = [
  'location_group_feature',
  'location_group_activation_history',
]

const INSERT_ORDER = [
  'location_group_feature',
  'location_group_activation_history',
]

/**
 * seedRefDatabase re-seeds the non-menu reference tables from the full sync
 * snapshot. It is the FK-safe live re-seed used by the RN schema-sync poll:
 *
 * - Rows that other seeded tables (menu, tickets, location_group) reference are
 *   UPSERTed — never deleted, so no FK violation.
 * - Leaf tables (feature flags, activation history) are deleted then reinserted
 *   so rows removed server-side stop lingering locally.
 * - Menu tables are intentionally NOT handled here (see seedMenuDatabase) and
 *   ticket_* tables are never touched — this path must never clobber local
 *   offline tickets.
 * - Per-row isolation (ticket-engine rule 7): a single malformed row is logged
 *   and skipped, never aborting the whole seed.
 */
export function seedRefDatabase(db: DbAdapter, seed: Seed): void {
  db.run('BEGIN')

  try {
    // 1. UPSERT parent/dependency tables (FK targets stay put).
    for (const table of UPSERT_ORDER) {
      const rows = seed[table]
      if (!Array.isArray(rows)) continue

      for (const row of rows) {
        if (!row || typeof row !== 'object') continue
        const upsert = buildUpsert(table, row as Record<string, unknown>)
        if (!upsert) continue
        try {
          db.run(upsert.sql, upsert.values)
        } catch (err) {
          const key = (row as { uuid?: string }).uuid ?? '[no-uuid]'
          console.error(`🌱 seedRef ${table} ${key}: ${(err as Error).message}`)
        }
      }
    }

    // 2. DELETE leaf tables (dependent-first; nothing references them).
    for (const table of DELETE_ORDER) {
      db.run(`DELETE FROM "${dbTableName(table)}"`)
    }

    // 3. INSERT in FK order, per-row isolated.
    for (const table of INSERT_ORDER) {
      const rows = seed[table]
      if (!Array.isArray(rows)) continue

      for (const row of rows) {
        if (!row || typeof row !== 'object') continue
        const insert = buildInsert(table, row as Record<string, unknown>)
        if (!insert) continue
        try {
          db.run(insert.sql, insert.values)
        } catch (err) {
          const key = (row as { uuid?: string; id?: number | string }).uuid ?? 'id-unknown'
          console.error(`🌱 seedRef ${table} ${key}: ${(err as Error).message}`)
        }
      }
    }

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
