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

// Child->parent ordering: dependent tables are deleted first, and parents are
// inserted before children, so every FK reference has an existing target.
const DELETE_ORDER = [
  'menu_item_modifier_group',
  'modifier_group_modifier',
  'menu_item_menu_category',
  'menu_menu_category',
  'sub_category_menu_item',
  'combo_menu_item',
  'menu_combo',

  'sub_category',
  'modifier_group',
  'combo',

  'menu_category',
  'menu',
]

const INSERT_ORDER = [
  'menu',
  'menu_category',
  'modifier_group',
  'sub_category',
  'combo',

  'menu_menu_category',
  'menu_item_menu_category',
  'sub_category_menu_item',
  'menu_combo',
  'combo_menu_item',
  'modifier_group_modifier',
  'menu_item_modifier_group',
]

/**
 * seedMenuDatabase upserts the menu subtree from the `/sync/menu` payload.
 *
 * - menuItem and modifier are UPSERTed (they are referenced by tickets, so a
 *   delete+reinsert would violate ticket_menu_item FKs).
 * - Everything else in the menu family (categories, groups, combos, join
 *   tables) is deleted then reinserted in FK-topological order.
 * - Per-row isolation (ticket-engine rule 7): a single malformed row is logged
 *   and skipped, never aborting the whole seed.
 */
export function seedMenuDatabase(db: DbAdapter, seed: Seed): void {
  const menuItems = (seed['menu_item'] ?? []) as Record<string, unknown>[]
  const modifiers = (seed['modifier'] ?? []) as Record<string, unknown>[]

  db.run('BEGIN')

  try {
    // 1. UPSERT menu_item
    for (const row of menuItems) {
      const upsert = buildUpsert('menu_item', row)
      if (!upsert) continue
      try {
        db.run(upsert.sql, upsert.values)
      } catch (err) {
        console.error(
          `🌱 seedMenu menu_item ${(row.uuid ?? '[no-uuid]') as string}: ${(err as Error).message}`,
        )
      }
    }

    // 2. UPSERT modifier
    for (const row of modifiers) {
      const upsert = buildUpsert('modifier', row)
      if (!upsert) continue
      try {
        db.run(upsert.sql, upsert.values)
      } catch (err) {
        console.error(
          `🌱 seedMenu modifier ${(row.uuid ?? '[no-uuid]') as string}: ${(err as Error).message}`,
        )
      }
    }

    // 3. DELETE dependent tables
    for (const table of DELETE_ORDER) {
      db.run(`DELETE FROM "${dbTableName(table)}"`)
    }

    // 4. INSERT in FK order, per-row isolated
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
          console.error(`🌱 seedMenu ${table} ${key}: ${(err as Error).message}`)
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