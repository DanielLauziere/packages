import type { DbAdapter } from './dbAdapter.js'
import {
  buildInsert,
  buildUpsert,
  runRow,
  withSeedTransaction,
  type Seed,
} from './seedCommon.js'

// Ref-only (non-menu) tables the schema-version counter covers, minus the menu
// family (handled by seedMenuDatabase).
//
// UPSERT — rows other tables depend on, so a delete+reinsert would violate FKs:
//   - location_group: referenced by menu, dining_table, promotion,
//     location_group_feature, location_group_activation_history,
//     location_group_printer, guest_location_group, admin_location, etc.
//   - location_group_printer: referenced by location_group
//     (guest/kitchen_location_group_printer_uuid) and admin.
//   - guest: referenced by guest_address and ticket (guest_uuid).
//   - guest_address: referenced by ticket (guest_address_uuid).
//   - admin: referenced by ticket (admin_uuid), admin_balance_history,
//     admin_location, admin_location_permission, admin_push_creds.
//   - fulfillment: referenced by ticket (fulfillment_uuid).
//   - payment: referenced by ticket_payment.
//   - promotion: referenced by ticket_promotion.
//   - dining_table: referenced by ticket (table_uuid).
//
// FK-topological: parents (country/language/feature live below but are seeded
// by the full snapshot's seed_order; here only the tables this seeder touches
// need ordering) — guest before guest_address (FK), location_group_printer
// before admin (admin's printer FKs), and the menu/ticket dependents come last.
const UPSERT_ORDER = [
  'location_group',
  'location_group_printer',
  'guest',
  'guest_address',
  'fulfillment',
  'payment',
  'admin',
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
  withSeedTransaction(db, () => {
    // 1. UPSERT parent/dependency tables (FK targets stay put).
    for (const table of UPSERT_ORDER) {
      const rows = seed[table]
      if (!Array.isArray(rows)) continue

      for (const row of rows) {
        if (!row || typeof row !== 'object') continue
        const upsert = buildUpsert(table, row as Record<string, unknown>)
        if (!upsert) continue
        const key = (row as { uuid?: string }).uuid ?? '[no-uuid]'
        runRow(db, upsert, `seedRef ${table} ${key}`)
      }
    }

    // 2. DELETE leaf tables (dependent-first; nothing references them).
    for (const table of DELETE_ORDER) {
      db.run(`DELETE FROM "${table}"`)
    }

    // 3. INSERT in FK order, per-row isolated.
    for (const table of INSERT_ORDER) {
      const rows = seed[table]
      if (!Array.isArray(rows)) continue

      for (const row of rows) {
        if (!row || typeof row !== 'object') continue
        const insert = buildInsert(table, row as Record<string, unknown>)
        if (!insert) continue
        const key = (row as { uuid?: string; id?: number | string }).uuid ?? 'id-unknown'
        runRow(db, insert, `seedRef ${table} ${key}`)
      }
    }
  })
}
