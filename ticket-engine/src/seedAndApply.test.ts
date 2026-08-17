import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { DatabaseSync } from 'node:sqlite'
import {
  applyDdl,
  seedDatabase,
  seedMenuDatabase,
  applyLogsBatch,
  migrateSchema,
  dropAllTables,
  getSchemaUuid,
  setSchemaUuid,
  FULL_DDL,
  SCHEMA_UUID,
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
  { uuid: 'l-table', ticket_uuid: 't1', location_group_uuid: LG, admin_uuid: 'admin1', action: 'SET_TABLE', payload: { table_uuid: 'tbl1' }, time_stamp: 1000 },
  { uuid: 'l-guest', ticket_uuid: 't1', location_group_uuid: LG, admin_uuid: 'admin1', action: 'SET_GUEST', payload: { guest_user_name: 'Dani' }, time_stamp: 2000 },
  { uuid: 'l-fulfill', ticket_uuid: 't1', location_group_uuid: LG, admin_uuid: 'admin1', action: 'SET_FULFILLMENT', payload: { fulfillment_uuid: 'fu1' }, time_stamp: 3000 },
  { uuid: 'tmi1', ticket_uuid: 't1', location_group_uuid: LG, admin_uuid: 'admin1', action: 'ADD_ITEM', payload: { menu_item_uuid: 'mi1' }, time_stamp: 4000 },
  { uuid: 'l-mod', ticket_uuid: 't1', location_group_uuid: LG, admin_uuid: 'admin1', action: 'ADD_MODIFIER', payload: { ticket_menu_item_uuid: 'tmi1', modifier_uuid: 'mod1' }, time_stamp: 5000 },
  { uuid: 'l-promo', ticket_uuid: 't1', location_group_uuid: LG, admin_uuid: 'admin1', action: 'APPLY_PROMOTION', payload: { promotion_uuid: 'promo1' }, time_stamp: 6000 },
  { uuid: 'l-pay', ticket_uuid: 't1', location_group_uuid: LG, admin_uuid: 'admin1', action: 'ADD_PAYMENT', payload: { payment_uuid: 'pay1', price_whole: 800, price_hundredths: 0, code: 'CASH', complete: false }, time_stamp: 7000 },
  { uuid: 'l-accepted', ticket_uuid: 't1', location_group_uuid: LG, admin_uuid: 'admin1', action: 'SET_STATUS_ACCEPTED', payload: {}, time_stamp: 8000 },
  { uuid: 'l-complete', ticket_uuid: 't1', location_group_uuid: LG, admin_uuid: 'admin1', action: 'SET_STATUS_COMPLETE', payload: {}, time_stamp: 9000 },
  { uuid: 'l-paid', ticket_uuid: 't1', location_group_uuid: LG, admin_uuid: 'admin1', action: 'SET_STATUS_PAID', payload: {}, time_stamp: 10000 },
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
    applyDdl(makeAdapter(db), FULL_DDL)
  })

  afterEach(() => db.close())

  it('creates all 53 tables including print_record', () => {
    const tables = all(db, `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).map((r) => r.name)
    expect(tables.length).toBe(53)
    expect(tables).toContain('print_record')
    expect(tables).toContain('ticket_log_applied')
    expect(tables).toContain('location_group_schema_version')
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

  it('migrateSchema persists the applied uuid and is idempotent', () => {
    expect(getSchemaUuid(makeAdapter(db))).toBe('')
    const first = migrateSchema(makeAdapter(db), { schemaUuid: SCHEMA_UUID, fullDdl: FULL_DDL })
    expect(first.needsReseed).toBe(true)
    const second = migrateSchema(makeAdapter(db), { schemaUuid: SCHEMA_UUID, fullDdl: FULL_DDL })
    expect(second.needsReseed).toBe(false)
    expect(getSchemaUuid(makeAdapter(db))).toBe(SCHEMA_UUID)
  })

  it('migrateSchema requests a reseed when the stored uuid differs', () => {
    applyDdl(makeAdapter(db), FULL_DDL)
    setSchemaUuid(makeAdapter(db), 'some-old-schema-uuid')
    const res = migrateSchema(makeAdapter(db), { schemaUuid: SCHEMA_UUID, fullDdl: FULL_DDL })
    expect(res.needsReseed).toBe(true)
    expect(getSchemaUuid(makeAdapter(db))).toBe(SCHEMA_UUID)
  })

  it('dropAllTables protects print_record and key_value', () => {
    db.prepare(`INSERT INTO print_record (ticket_uuid, decision, printed_at, synced) VALUES ('t1','printed',1,0)`).run()
    db.prepare(`INSERT INTO key_value (key, value) VALUES ('schema_uuid','abc')`).run()
    dropAllTables(makeAdapter(db), ['print_record', 'key_value'])
    expect((row(db, 'SELECT COUNT(*) AS c FROM print_record')).c).toBe(1)
    expect((row(db, 'SELECT COUNT(*) AS c FROM key_value')).c).toBe(1)
    expect((row(db, `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='ticket'`)).c).toBe(0)
  })

  it('dropAllTables without key_value protection drops it (wipe contract)', () => {
    db.prepare(`INSERT INTO key_value (key, value) VALUES ('schema_uuid','abc')`).run()
    dropAllTables(makeAdapter(db), ['print_record'])
    expect((row(db, `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='key_value'`)).c).toBe(0)
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

  it('seedDatabase survives a hostile seed: empty strings, nulls, missing keys, unknown keys', () => {
    const hostile: any = {
      country: [
        { uuid: 'ct-1', name: '', nombre: 'El Salvador', iso2: 'SV', iso3: 'SLV', this_key_does_not_exist: 'ignored' },
        { uuid: 'ct-2', nombre: 'United States', iso2: 'US', iso3: 'USA' },
      ],
      location_group: [{ uuid: LG, name: 'Main Location', country_uuid: 'ct-1' }],
      menu: [{ uuid: 'menu1', name: 'Main Menu', active: 1, location_group_uuid: LG }],
      menu_category: [
        { uuid: 'cat1', name: 'Burgers', active: 1, location_group_uuid: LG },
        { uuid: 'cat2', name: null, active: 1, location_group_uuid: LG },
        { uuid: 'cat3', location_group_uuid: LG },
      ],
      menu_item: [
        { uuid: 'mi1', name: 'Cheeseburger', active: 1, complete: 0, price_whole: 5, price_hundredths: 0, location_group_uuid: LG, cache: '{}' },
        { uuid: 'mi2', name: 'Soda', active: 1, complete: 0, price_whole: 2, price_hundredths: 0, location_group_uuid: LG },
      ],
    }

    seedDatabase(makeAdapter(db), hostile)

    // Unknown keys are dropped against the live schema (PRAGMA table_info), no
    // extra columns, no crash. Empty string name is preserved as '' — never
    // coerced to null (AGENTS.md §null/empty contract).
    expect((row(db, 'SELECT COUNT(*) AS c FROM country')).c).toBe(1)
    expect((row(db, `SELECT COUNT(*) AS c FROM country WHERE name = ''`)).c).toBe(1)
    // Rows missing a NOT NULL column (menu_category.name, menu_item.cache) or
    // carrying null for one are skipped in isolation, never aborting the seed.
    expect((row(db, 'SELECT COUNT(*) AS c FROM location_group')).c).toBe(1)
    expect((row(db, 'SELECT COUNT(*) AS c FROM menu')).c).toBe(1)
    expect((row(db, 'SELECT COUNT(*) AS c FROM menu_category')).c).toBe(1)
    expect((row(db, 'SELECT COUNT(*) AS c FROM menu_item')).c).toBe(1)
    expect(all(db, 'PRAGMA foreign_key_check')).toEqual([])
  })

  it('rowsFromDb passes snake_case rows through (identity wire contract)', () => {
    db.prepare(`INSERT INTO print_record (ticket_uuid, decision, printed_at, synced) VALUES ('t1','printed',123,0)`).run()
    const raw = all(db, 'SELECT ticket_uuid, decision, printed_at, synced FROM print_record WHERE ticket_uuid=?', 't1')
    const snake = rowsFromDb(raw)
    expect(snake[0]).toMatchObject({ ticket_uuid: 't1', decision: 'printed', printed_at: 123, synced: 0 })
  })

  it('a brand-new server table seeds with zero client release (no bundled metadata)', () => {
    // CORE-LOGIC-SCHEMA-SYNC.md: a table added server-side must seed
    // on an unmodified engine. No SEED_COLUMNS entry, no playback code — the
    // column set is derived from the live schema by PRAGMA introspection.
    applyDdl(makeAdapter(db), `CREATE TABLE IF NOT EXISTS "taste_preference" ("uuid" TEXT NOT NULL, "guest_uuid" TEXT, "note" TEXT, PRIMARY KEY ("uuid"))`)
    seedDatabase(makeAdapter(db), {
      taste_preference: [
        { uuid: 'tp-1', guest_uuid: 'guest1', note: '' },
        { uuid: 'tp-2', guest_uuid: 'guest1', unknown_key: 'dropped' },
      ],
    } as any)
    expect(row(db, 'SELECT COUNT(*) AS c FROM taste_preference').c).toBe(2)
    expect(row(db, `SELECT COUNT(*) AS c FROM taste_preference WHERE note = ''`).c).toBe(1)
  })
})