import type { DbAdapter } from './dbAdapter.js'
import {
  buildInsert,
  buildUpsert,
  runRow,
  withSeedTransaction,
  type Seed,
} from './seedCommon.js'

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

  withSeedTransaction(db, () => {
    // 1. UPSERT menu_item
    for (const row of menuItems) {
      const upsert = buildUpsert('menu_item', row)
      if (!upsert) continue
      runRow(db, upsert, `seedMenu menu_item ${(row.uuid ?? '[no-uuid]') as string}`)
    }

    // 2. UPSERT modifier
    for (const row of modifiers) {
      const upsert = buildUpsert('modifier', row)
      if (!upsert) continue
      runRow(db, upsert, `seedMenu modifier ${(row.uuid ?? '[no-uuid]') as string}`)
    }

    // 3. DELETE dependent tables
    for (const table of DELETE_ORDER) {
      db.run(`DELETE FROM "${table}"`)
    }

    // 4. INSERT in FK order, per-row isolated
    for (const table of INSERT_ORDER) {
      const rows = seed[table]
      if (!Array.isArray(rows)) continue

      for (const row of rows) {
        if (!row || typeof row !== 'object') continue
        const insert = buildInsert(table, row as Record<string, unknown>)
        if (!insert) continue
        const key = (row as { uuid?: string; id?: number | string }).uuid ?? 'id-unknown'
        runRow(db, insert, `seedMenu ${table} ${key}`)
      }
    }
  })
}
