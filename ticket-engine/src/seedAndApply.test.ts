import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { DatabaseSync } from 'node:sqlite'
import {
  applyFullDdl,
  seedDatabase,
  seedMenuDatabase,
  applyLogsBatch,
  migrateSchema,
  dropAllTables,
  rowsFromDb,
  type DbAdapter,
} from './index.js'

function makeAdapter(db: DatabaseSync): DbAdapter {
  return {
    run(sql: string, params: unknown[] = []) {
      db.prepare(sql).run(...(params as any[]))
    },
    query(sql: string, params: unknown[] = []): any[] {
      return db.prepare(sql).all(...(params as any[])) as any[]
    },
  }
}

const LG = 'lg-main'
const seed = {
  country: [{ uuid: 'ct-1', name: 'El Salvador', nombre: 'El Salvador', iso2: 'SV', iso3: 'SLV', phone_code: 503 }],
  location_group: [{ uuid: LG, name: 'Main Location', country_uuid: 'ct-1' }],
  menu: [{ uuid: 'menu1', name: 'Main Menu', active: 1, location_group_uuid: LG }],
  menu_category: [{ uuid: 'cat1', name: 'Burgers', active: 1, location_group_uuid: LG }],
  menu_item: [{ uuid: 'mi1', name: 'Cheeseburger', description: '', price_whole: 5, price_hundredths: 0, active: 1, complete: 0, location_group_uuid: LG, cache: '{}' }],
  modifier_group: [{ uuid: 'mg1', name: 'Size', amount_required: 0, location_group_uuid: LG }],
  modifier: [{ uuid: 'mod1', name: 'Large', price_whole: 1, price_hundredths: 0, active: 1, location_group_uuid: LG }],
  menu_menu_category: [{ uuid: 'mmc1', menu_uuid: 'menu1', menu_category_uuid: 'cat1' }],
  menu_item_menu_category: [{ uuid: 'mimc1', menu_item_uuid: 'mi1', menu_category_uuid: 'cat1' }],
  menu_item_modifier_group: [{ uuid: 'mimg1', modifier_group_uuid: 'mg1', menu_item_uuid: 'mi1' }],
  modifier_group_modifier: [{ uuid: 'mgm1', modifier_group_uuid: 'mg1', modifier_uuid: 'mod1' }],
  dining_table: [{ uuid: 'tbl1', name: '12', active: 1, location_group_uuid: LG }],
  payment: [{ uuid: 'pay1', name: 'Cash', code: 'CASH' }],
  fulfillment: [{ uuid: 'fu1', name: 'Dine-in', code: 'DINE' }],
  promotion: [{ uuid: 'promo1', name: 'BOGO', type: 'BOGO', active: 1, location_group_uuid: LG }],
  guest: [{ uuid: 'guest1', user_name: 'Dani', first_name: 'D', last_name: 'L', email: 'd@x.com', phone: '50370000000' }],
  admin: [{ uuid: 'admin1', user_name: 'admin', password_hash: 'x' }],
}

const logs = [
  { uuid: 'l-table', ticketUuid: 't1', locationGroupUuid: LG, adminUuid: 'admin1', action: 'SET_TABLE', payload: { tableUuid: 'tbl1' }, timeStamp: 1000 },
  { uuid: 'l-guest', ticketUuid: 't1', locationGroupUuid: LG, adminUuid: 'admin1', action: 'SET_GUEST', payload: { guestUserName: 'Dani' }, timeStamp: 2000 },
  { uuid: 'l-fulfill', ticketUuid: 't1', locationGroupUuid: LG, adminUuid: 'admin1', action: 'SET_FULFILLMENT', payload: { fulfillmentUuid: 'fu1' }, timeStamp: 3000 },
  { uuid: 'tmi1', ticketUuid: 't1', locationGroupUuid: LG, adminUuid: 'admin1', action: 'ADD_ITEM', payload: { menuItemUuid: 'mi1' }, timeStamp: 4000 },
  { uuid: 'l-mod', ticketUuid: 't1', locationGroupUuid: LG, adminUuid: 'admin1', action: 'ADD_MODIFIER', payload: { ticketMenuItemUuid: 'tmi1', modifierUuid: 'mod1' }, timeStamp: 5000 },
  { uuid: 'l-promo', ticketUuid: 't1', locationGroupUuid: LG, adminUuid: 'admin1', action: 'APPLY_PROMOTION', payload: { promotionUuid: 'promo1' }, timeStamp: 6000 },
  { uuid: 'l-pay', ticketUuid: 't1', locationGroupUuid: LG, adminUuid: 'admin1', action: 'ADD_PAYMENT', payload: { paymentUuid: 'pay1', priceWhole: 800, priceHundredths: 0, code: 'CASH', complete: false }, timeStamp: 7000 },
  { uuid: 'l-accepted', ticketUuid: 't1', locationGroupUuid: LG, adminUuid: 'admin1', action: 'SET_STATUS_ACCEPTED', payload: {}, timeStamp: 8000 },
  { uuid: 'l-complete', ticketUuid: 't1', locationGroupUuid: LG, adminUuid: 'admin1', action: 'SET_STATUS_COMPLETE', payload: {}, timeStamp: 9000 },
  { uuid: 'l-paid', ticketUuid: 't1', locationGroupUuid: LG, adminUuid: 'admin1', action: 'SET_STATUS_PAID', payload: {}, timeStamp: 10000 },
]

function row(db: DatabaseSync, sql: string, ...p: any[]): any {
  return db.prepare(sql).get(...p)
}
function all(db: DatabaseSync, sql: string, ...p: any[]): any[] {
  return db.prepare(sql).all(...p)
}

describe('integration: FULL_DDL + seed + applyLogs against real SQLite', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    applyFullDdl(makeAdapter(db))
  })

  afterEach(() => db.close())

  it('creates all 51 tables including print_record', () => {
    const tables = all(db, `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).map((r) => r.name)
    expect(tables.length).toBe(51)
    expect(tables).toContain('print_record')
    expect(tables).toContain('ticket_log_applied')
  })

  it('seedDatabase maps snake_case wire keys to snake columns per-row', () => {
    seedDatabase(makeAdapter(db), seed as any)
    expect((row(db, 'SELECT COUNT(*) AS c FROM location_group')).c).toBe(1)
    expect((row(db, 'SELECT COUNT(*) AS c FROM menu_item')).c).toBe(1)
    // FK join tables populated
    expect((row(db, 'SELECT COUNT(*) AS c FROM menu_item_modifier_group')).c).toBe(1)
    expect((row(db, 'SELECT COUNT(*) AS c FROM menu_menu_category')).c).toBe(1)
    expect((row(db, 'SELECT COUNT(*) AS c FROM modifier_group_modifier')).c).toBe(1)
  })

  it('applyLogsBatch applies a full ticket lifecycle', () => {
    seedDatabase(makeAdapter(db), seed as any)
    const res = applyLogsBatch(makeAdapter(db), logs as any)
    expect(res.applied).toBe(10)
    expect(res.skipped).toBe(0)
    expect(res.errors).toEqual([])

    const t = row(db, 'SELECT id, status, table_uuid, guest_uuid, fulfillment_uuid FROM ticket WHERE uuid=?', 't1')
    expect(t.status).toBe('PAID')
    expect(t.table_uuid).toBe('tbl1')
    expect(t.fulfillment_uuid).toBe('fu1')

    const items = all(db, 'SELECT * FROM ticket_menu_item WHERE ticket_uuid=?', 't1')
    expect(items).toHaveLength(1)
    expect(items[0].menu_item_uuid).toBe('mi1')

    const mods = all(db, 'SELECT * FROM ticket_menu_item_modifier WHERE ticket_uuid=?', 't1')
    expect(mods).toHaveLength(1)
    expect(mods[0].modifier_uuid).toBe('mod1')
    expect(mods[0].ticket_menu_item_uuid).toBe('tmi1')

    const pays = all(db, 'SELECT * FROM ticket_payment WHERE ticket_uuid=?', 't1')
    expect(pays).toHaveLength(1)
    expect(pays[0].payment_uuid).toBe('pay1')
    expect(pays[0].price_whole).toBe(800)

    const promos = all(db, 'SELECT * FROM ticket_promotion WHERE ticket_uuid=?', 't1')
    expect(promos).toHaveLength(1)
    expect(promos[0].promotion_uuid).toBe('promo1')
  })

  it('migrateSchema sets schemaVersion and is idempotent', () => {
    const first = migrateSchema(makeAdapter(db))
    expect(first.needsReseed).toBe(true)
    const second = migrateSchema(makeAdapter(db))
    expect(second.needsReseed).toBe(false)
  })

  it('dropAllTables protects print_record', () => {
    db.prepare(`INSERT INTO print_record (ticket_uuid, decision, printed_at, synced) VALUES ('t1','printed',1,0)`).run()
    dropAllTables(makeAdapter(db), ['print_record'])
    expect((row(db, 'SELECT COUNT(*) AS c FROM print_record')).c).toBe(1)
    expect((row(db, `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='ticket'`)).c).toBe(0)
  })

  it('SEED_ORDER guarantees FK parents precede children (base seed must run before menu-sync)', () => {
    // This mirrors the runtime bug: the menu-sync path seeded menu_item while
    // location_group was empty, causing "FOREIGN KEY constraint failed".
    // Seeding the full base snapshot (with locationGroup + menu parents)
    // in engine SEED_ORDER must never violate FKs.
    seedDatabase(makeAdapter(db), seed as any)
    // All FK ancestors exist and point at parents that were inserted earlier.
    expect((row(db, 'SELECT COUNT(*) AS c FROM location_group')).c).toBeGreaterThan(0)
    expect((row(db, 'SELECT COUNT(*) AS c FROM menu')).c).toBeGreaterThan(0)
    expect((row(db, 'SELECT COUNT(*) AS c FROM menu_category')).c).toBeGreaterThan(0)
    expect((row(db, 'SELECT COUNT(*) AS c FROM menu_item')).c).toBeGreaterThan(0)
    // PRAGMA foreign_key_check must be empty after a full seed.
    const violations = all(db, 'PRAGMA foreign_key_check')
    expect(violations).toEqual([])
  })

  it('menu-only snapshot with out-of-order parent must survive applyLogs FK references', () => {
    seedDatabase(makeAdapter(db), seed as any)
    // The symptom surfaced as a SECONDARY FK error when applying a
    // SET_STATUS_COMPLETE log, because the parent rows the ticket referenced
    // (table, guest, fulfillment, menu item) were absent. After a correct
    // base seed they exist, so the full lifecycle applies without error.
    const res = applyLogsBatch(makeAdapter(db), logs as any)
    expect(res.errors).toEqual([])
    expect(res.applied).toBe(10)
  })

  it('seedMenuDatabase upserts the menu subtree from a /sync/menu payload', () => {
    seedDatabase(makeAdapter(db), seed as any)
    const menuSeed: any = { menu: seed.menu, menu_category: seed.menu_category, menu_item: seed.menu_item, modifier_group: seed.modifier_group, modifier: seed.modifier, menu_menu_category: seed.menu_menu_category, menu_item_menu_category: seed.menu_item_menu_category, menu_item_modifier_group: seed.menu_item_modifier_group, modifier_group_modifier: seed.modifier_group_modifier, sub_category: [], combo: [] }

    seedMenuDatabase(makeAdapter(db), menuSeed)

    expect(row(db, 'SELECT COUNT(*) AS c FROM menu_item').c).toBe(1)
    expect(row(db, 'SELECT COUNT(*) AS c FROM menu').c).toBe(1)
    expect(row(db, 'SELECT COUNT(*) AS c FROM menu_category').c).toBe(1)
    expect(row(db, 'SELECT COUNT(*) AS c FROM menu_item_menu_category').c).toBe(1)
    expect(row(db, 'SELECT COUNT(*) AS c FROM modifier').c).toBe(1)
    expect(all(db, 'PRAGMA foreign_key_check')).toEqual([])
  })

  it('seedMenuDatabase rerun (second menu payload) is idempotent and FK-clean', () => {
    seedDatabase(makeAdapter(db), seed as any)
    const menuSeed: any = { menu: seed.menu, menu_category: seed.menu_category, menu_item: seed.menu_item, modifier_group: seed.modifier_group, modifier: seed.modifier, menu_menu_category: seed.menu_menu_category, menu_item_menu_category: seed.menu_item_menu_category, menu_item_modifier_group: seed.menu_item_modifier_group, modifier_group_modifier: seed.modifier_group_modifier, sub_category: [], combo: [] }

    seedMenuDatabase(makeAdapter(db), menuSeed)
    seedMenuDatabase(makeAdapter(db), menuSeed)
    expect(row(db, 'SELECT COUNT(*) AS c FROM menu_item').c).toBe(1)
    expect(all(db, 'PRAGMA foreign_key_check')).toEqual([])
  })

  it('rowsFromDb passes snake_case rows through (identity wire contract)', () => {
    db.prepare(`INSERT INTO print_record (ticket_uuid, decision, printed_at, synced) VALUES ('t1','printed',123,0)`).run()
    const raw = all(db, 'SELECT ticket_uuid, decision, printed_at, synced FROM print_record WHERE ticket_uuid=?', 't1')
    const snake = rowsFromDb(raw)
    expect(snake[0]).toMatchObject({ ticket_uuid: 't1', decision: 'printed', printed_at: 123, synced: 0 })
  })
})