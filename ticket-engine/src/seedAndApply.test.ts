import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { DatabaseSync } from 'node:sqlite'
import {
  applyDdl,
  seedGroupDatabase,
  applyLogsBatch,
  migrateSchema,
  dropAllTables,
  getSchemaUuid,
  setSchemaUuid,
  FULL_DDL,
  SCHEMA_UUID,
  SEED_ORDER,
  ticketIdFromUUID,
  rowsFromDb,
  type DbAdapter,
} from './index.js'

function makeAdapter(db: DatabaseSync): DbAdapter {
  return {
    async run(sql: string, params: unknown[] = []) {
      db.prepare(sql).run(...(params as any[]))
    },
    async query(sql: string, params: unknown[] = []): Promise<any[]> {
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

  beforeEach(async () => {
    db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    await applyDdl(makeAdapter(db), FULL_DDL)
  })

  afterEach(() => db.close())

  it('creates all 52 tables including print_record', () => {
    const tables = all(db, `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).map((r) => r.name)
    expect(tables.length).toBe(52)
    expect(tables).toContain('print_record')
    expect(tables).toContain('ticket_log_applied')
    expect(tables).toContain('location_group_schema_version')
    expect(tables).not.toContain('mock_schema_sync_probe')
  })

  it('seedGroupDatabase maps snake_case wire keys to snake columns per-row', async () => {
    await seedGroupDatabase(makeAdapter(db), seed as any)
    expect((row(db, 'SELECT COUNT(*) AS c FROM location_group')).c).toBe(1)
    expect((row(db, 'SELECT COUNT(*) AS c FROM menu_item')).c).toBe(1)
    // FK join tables populated
    expect((row(db, 'SELECT COUNT(*) AS c FROM menu_item_modifier_group')).c).toBe(1)
    expect((row(db, 'SELECT COUNT(*) AS c FROM menu_menu_category')).c).toBe(1)
    expect((row(db, 'SELECT COUNT(*) AS c FROM modifier_group_modifier')).c).toBe(1)
  })

  it('applyLogsBatch applies a full ticket lifecycle', async () => {
    await seedGroupDatabase(makeAdapter(db), seed as any)
    const res = await applyLogsBatch(makeAdapter(db), logs as any)
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

  it('implicit ticket creation applies rule-4 defaults on real SQLite', async () => {
    await seedGroupDatabase(makeAdapter(db), seed as any)
    const res = await applyLogsBatch(makeAdapter(db), [
      { uuid: 'l-single', ticket_uuid: 'fresh-t1', location_group_uuid: LG, admin_uuid: 'admin1', action: 'SET_GUEST', payload: { guest_user_name: 'NewGuest' }, time_stamp: 500 },
    ] as any)
    expect(res.applied).toBe(1)
    const t = row(db, 'SELECT id, status, price_whole, price_hundredths, is_dirty, is_local, admin_uuid FROM ticket WHERE uuid=?', 'fresh-t1')
    // Rule 4: INCOMPLETE status, price 0/0 (not NULL), crc32-derived id.
    expect(t.status).toBe('INCOMPLETE')
    expect(t.price_whole).toBe(0)
    expect(t.price_hundredths).toBe(0)
    expect(t.id).toBe(ticketIdFromUUID('fresh-t1'))
    expect(t.is_dirty).toBe(1)
    expect(t.is_local).toBe(1)
    expect(t.admin_uuid).toBe('admin1')
  })

  it('replaying the same batch twice converges to identical state', async () => {
    await seedGroupDatabase(makeAdapter(db), seed as any)
    const first = await applyLogsBatch(makeAdapter(db), logs as any)
    expect(first.applied).toBe(10)

    const stateAfterFirst = all(db, 'SELECT * FROM ticket WHERE uuid=?', 't1')
    // Replay the exact same logs — nothing may change and nothing re-applies.
    const second = await applyLogsBatch(makeAdapter(db), logs as any)
    expect(second.applied).toBe(0)
    expect(second.skipped).toBe(10)
    expect(second.errors).toEqual([])
    const stateAfterSecond = all(db, 'SELECT * FROM ticket WHERE uuid=?', 't1')
    expect(stateAfterSecond).toEqual(stateAfterFirst)
    // Single source of truth: exactly one row per log, applied time_stamp set.
    const appliedRows = all(db, 'SELECT uuid, time_stamp, retry_count FROM ticket_log_applied ORDER BY uuid')
    expect(appliedRows).toHaveLength(10)
    for (const a of appliedRows) {
      expect(a.time_stamp).not.toBeNull()
      expect(a.retry_count).toBeNull()
    }
  })

  it('ticket_log_applied: claim row stays un-applied (retry) when deps missing, then applies', async () => {
    await seedGroupDatabase(makeAdapter(db), seed as any)
    // REMOVE_ITEM for a ticket_menu_item that does not exist yet — rule 5:
    // throw MISSING_DEPENDENCY → skip (keep claim time_stamp NULL) → retry later.
    const remove = { uuid: 'l-remove', ticket_uuid: 't1', location_group_uuid: LG, admin_uuid: 'admin1', action: 'REMOVE_ITEM', payload: { ticket_menu_item_uuid: 'tmi1' }, time_stamp: 4000 }
    const res = await applyLogsBatch(makeAdapter(db), [remove] as any)
    expect(res.applied).toBe(0)
    expect(res.skipped).toBe(1)
    const claim = row(db, 'SELECT time_stamp FROM ticket_log_applied WHERE uuid=?', 'l-remove')
    expect(claim.time_stamp).toBeNull() // still un-applied → next cycle retries

    // Now the ADD_ITEM arrives on the next cycle, then the remove applies.
    const add: any = { uuid: 'tmi1', ticket_uuid: 't1', location_group_uuid: LG, admin_uuid: 'admin1', action: 'ADD_ITEM', payload: { menu_item_uuid: 'mi1' }, time_stamp: 3000 }
    const res2 = await applyLogsBatch(makeAdapter(db), [add] as any)
    expect(res2.applied).toBe(1)
    const res3 = await applyLogsBatch(makeAdapter(db), [remove] as any)
    expect(res3.applied).toBe(1)
    expect(res3.skipped).toBe(0)
    expect(row(db, 'SELECT COUNT(*) AS c FROM ticket_menu_item WHERE uuid=?', 'tmi1').c).toBe(0) // removed
  })

  it('T2 cross-ticket never wedge: a MISSING_DEPENDENCY on ticket A never blocks ticket B', async () => {
    await seedGroupDatabase(makeAdapter(db), seed as any)
    const res = await applyLogsBatch(makeAdapter(db), [
      // ticket A: first item can't apply (menu_item doesn't exist anywhere)...
      { uuid: 'a-bad-1', ticket_uuid: 'A', location_group_uuid: LG, admin_uuid: 'admin1', action: 'ADD_ITEM', payload: { menu_item_uuid: 'missing-xyz' }, time_stamp: 1000 },
      // ...but A's second item and ALL of ticket B must still apply.
      { uuid: 'a-ok-2', ticket_uuid: 'A', location_group_uuid: LG, admin_uuid: 'admin1', action: 'ADD_ITEM', payload: { menu_item_uuid: 'mi1' }, time_stamp: 2000 },
      { uuid: 'b-ok-1', ticket_uuid: 'B', location_group_uuid: LG, admin_uuid: 'admin1', action: 'ADD_ITEM', payload: { menu_item_uuid: 'mi1' }, time_stamp: 3000 },
    ] as any)

    expect(res.applied).toBe(2) // a-ok-2 + b-ok-1
    expect(res.skipped).toBe(1) // a-bad-1 (MISSING_DEPENDENCY → retry, not wedge)
    expect(res.errors).toEqual([])

    // Ticket A got exactly its one valid item.
    const aItems = all(db, 'SELECT menu_item_uuid FROM ticket_menu_item WHERE ticket_uuid=?', 'A')
    expect(aItems.map((r) => r.menu_item_uuid)).toEqual(['mi1'])

    // Ticket B applied fully, completely independent of A's failure.
    const bItems = all(db, 'SELECT menu_item_uuid FROM ticket_menu_item WHERE ticket_uuid=?', 'B')
    expect(bItems.map((r) => r.menu_item_uuid)).toEqual(['mi1'])

    // Both tickets were implicitly created (rule 4) — the pipeline never halted.
    expect((row(db, 'SELECT COUNT(*) AS c FROM ticket WHERE uuid IN (?, ?)', 'A', 'B')).c).toBe(2)

    // The failed log is claimed-but-unapplied (retry contract: time_stamp NULL,
    // retry_count kept) so the next cycle retries it instead of dropping it.
    const claim = row(db, 'SELECT time_stamp, retry_count FROM ticket_log_applied WHERE uuid=?', 'a-bad-1')
    expect(claim.time_stamp).toBeNull()
  })

  it('the 5 rarely-integration-tested actions run against real SQLite', async () => {
    await seedGroupDatabase(makeAdapter(db), seed as any)
    // tmi-extra is added first so the follow-up remove/note/modifier actions have
    // their FK dependencies present.
    const setup = await applyLogsBatch(makeAdapter(db), [
      { uuid: 'tmi-extra', ticket_uuid: 't2', location_group_uuid: LG, admin_uuid: 'admin1', action: 'ADD_ITEM', payload: { menu_item_uuid: 'mi1' }, time_stamp: 1000 },
    ] as any)
    expect(setup.applied).toBe(1)

    const idiom: any[] = [
      { uuid: 'l-addr', ticket_uuid: 't2', location_group_uuid: LG, admin_uuid: 'admin1', action: 'SET_ANONYMOUS_ADDRESS', payload: { address: 'Calle 1' }, time_stamp: 2000 },
      { uuid: 'l-note', ticket_uuid: 't2', location_group_uuid: LG, admin_uuid: 'admin1', action: 'SET_ITEM_NOTE', payload: { ticket_menu_item_uuid: 'tmi-extra', note: 'sin cebolla' }, time_stamp: 3000 },
      { uuid: 'l-promo-item', ticket_uuid: 't2', location_group_uuid: LG, admin_uuid: 'admin1', action: 'APPLY_PROMOTION', payload: { promotion_uuid: 'promo1', ticket_menu_item_uuid: 'tmi-extra' }, time_stamp: 4000 },
      { uuid: 'l-rem-promo', ticket_uuid: 't2', location_group_uuid: LG, admin_uuid: 'admin1', action: 'REMOVE_PROMOTION', payload: { promotion_uuid: 'promo1' }, time_stamp: 5000 },
      { uuid: 'l-mod2', ticket_uuid: 't2', location_group_uuid: LG, admin_uuid: 'admin1', action: 'ADD_MODIFIER', payload: { ticket_menu_item_uuid: 'tmi-extra', modifier_uuid: 'mod1' }, time_stamp: 6000 },
    ]
    const res = await applyLogsBatch(makeAdapter(db), idiom)
    expect(res.applied).toBe(idiom.length)
    expect(res.errors).toEqual([])

    const t2 = row(db, 'SELECT anonymous_address FROM ticket WHERE uuid=?', 't2')
    expect(t2.anonymous_address).toBe('Calle 1')
    const tmi = row(db, 'SELECT note FROM ticket_menu_item WHERE uuid=?', 'tmi-extra')
    expect(tmi.note).toBe('sin cebolla')
    // Item-level promotion applied then removed.
    expect(row(db, 'SELECT COUNT(*) AS c FROM ticket_promotion WHERE ticket_uuid=?', 't2').c).toBe(0)

    // REMOVE_MODIFIER with its FK present applies.
    const rm = await applyLogsBatch(makeAdapter(db), [
      { uuid: 'l-mod3', ticket_uuid: 't2', location_group_uuid: LG, admin_uuid: 'admin1', action: 'REMOVE_MODIFIER', payload: { ticket_menu_item_modifier_uuid: 'l-mod2' }, time_stamp: 7000 },
    ] as any)
    expect(rm.applied).toBe(1)
    expect(row(db, 'SELECT COUNT(*) AS c FROM ticket_menu_item_modifier WHERE uuid=?', 'l-mod2').c).toBe(0)
  })

  it('SEED_ORDER is a valid FK-topological order that executes cleanly', async () => {
    await seedGroupDatabase(makeAdapter(db), seed as any, SEED_ORDER)
    expect(all(db, 'PRAGMA foreign_key_check')).toEqual([])
    // The exported order must name every seedable table and know the schema.
    expect(SEED_ORDER.length).toBeGreaterThan(0)
    // Probe table is gone from the restored 52-table schema.
    expect(SEED_ORDER).not.toContain('mock_schema_sync_probe')
  })

  it('migrateSchema persists the applied uuid and is idempotent', async () => {
    expect(await getSchemaUuid(makeAdapter(db))).toBe('')
    const first = await migrateSchema(makeAdapter(db), { schemaUuid: SCHEMA_UUID, fullDdl: FULL_DDL })
    expect(first.needsReseed).toBe(true)
    const second = await migrateSchema(makeAdapter(db), { schemaUuid: SCHEMA_UUID, fullDdl: FULL_DDL })
    expect(second.needsReseed).toBe(false)
    expect(await getSchemaUuid(makeAdapter(db))).toBe(SCHEMA_UUID)
  })

  it('migrateSchema requests a reseed when the stored uuid differs', async () => {
    await applyDdl(makeAdapter(db), FULL_DDL)
    await setSchemaUuid(makeAdapter(db), 'some-old-schema-uuid')
    const res = await migrateSchema(makeAdapter(db), { schemaUuid: SCHEMA_UUID, fullDdl: FULL_DDL })
    expect(res.needsReseed).toBe(true)
    expect(await getSchemaUuid(makeAdapter(db))).toBe(SCHEMA_UUID)
  })

  it('dropAllTables protects print_record and key_value', async () => {
    db.prepare(`INSERT INTO print_record (ticket_uuid, decision, printed_at, synced) VALUES ('t1','printed',1,0)`).run()
    db.prepare(`INSERT INTO key_value (key, value) VALUES ('schema_uuid','abc')`).run()
    await dropAllTables(makeAdapter(db), ['print_record', 'key_value'])
    expect((row(db, 'SELECT COUNT(*) AS c FROM print_record')).c).toBe(1)
    expect((row(db, 'SELECT COUNT(*) AS c FROM key_value')).c).toBe(1)
    expect((row(db, `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='ticket'`)).c).toBe(0)
  })

  it('dropAllTables without key_value protection drops it (wipe contract)', async () => {
    db.prepare(`INSERT INTO key_value (key, value) VALUES ('schema_uuid','abc')`).run()
    await dropAllTables(makeAdapter(db), ['print_record'])
    expect((row(db, `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='key_value'`)).c).toBe(0)
  })

  it('SEED_ORDER guarantees FK parents precede children (base seed must run before menu-sync)', async () => {
    // This mirrors the runtime bug: the menu-sync path seeded menu_item while
    // location_group was empty, causing "FOREIGN KEY constraint failed".
    // Seeding the full base snapshot (with locationGroup + menu parents)
    // in engine SEED_ORDER must never violate FKs.
    await seedGroupDatabase(makeAdapter(db), seed as any)
    // All FK ancestors exist and point at parents that were inserted earlier.
    expect((row(db, 'SELECT COUNT(*) AS c FROM location_group')).c).toBeGreaterThan(0)
    expect((row(db, 'SELECT COUNT(*) AS c FROM menu')).c).toBeGreaterThan(0)
    expect((row(db, 'SELECT COUNT(*) AS c FROM menu_category')).c).toBeGreaterThan(0)
    expect((row(db, 'SELECT COUNT(*) AS c FROM menu_item')).c).toBeGreaterThan(0)
    // PRAGMA foreign_key_check must be empty after a full seed.
    const violations = all(db, 'PRAGMA foreign_key_check')
    expect(violations).toEqual([])
  })

  it('menu-only snapshot with out-of-order parent must survive applyLogs FK references', async () => {
    await seedGroupDatabase(makeAdapter(db), seed as any)
    // The symptom surfaced as a SECONDARY FK error when applying a
    // SET_STATUS_COMPLETE log, because the parent rows the ticket referenced
    // (table, guest, fulfillment, menu item) were absent. After a correct
    // base seed they exist, so the full lifecycle applies without error.
    const res = await applyLogsBatch(makeAdapter(db), logs as any)
    expect(res.errors).toEqual([])
    expect(res.applied).toBe(10)
  })

  it('seedGroupDatabase upserts the menu subtree from a /sync/menu payload', async () => {
    await seedGroupDatabase(makeAdapter(db), seed as any)
    const menuSeed: any = { location_group: seed.location_group, menu: seed.menu, menu_category: seed.menu_category, menu_item: seed.menu_item, modifier_group: seed.modifier_group, modifier: seed.modifier, menu_menu_category: seed.menu_menu_category, menu_item_menu_category: seed.menu_item_menu_category, menu_item_modifier_group: seed.menu_item_modifier_group, modifier_group_modifier: seed.modifier_group_modifier, sub_category: [], combo: [] }

    await seedGroupDatabase(makeAdapter(db), menuSeed)

    expect(row(db, 'SELECT COUNT(*) AS c FROM menu_item').c).toBe(1)
    expect(row(db, 'SELECT COUNT(*) AS c FROM menu').c).toBe(1)
    expect(row(db, 'SELECT COUNT(*) AS c FROM menu_category').c).toBe(1)
    expect(row(db, 'SELECT COUNT(*) AS c FROM menu_item_menu_category').c).toBe(1)
    expect(row(db, 'SELECT COUNT(*) AS c FROM modifier').c).toBe(1)
    expect(all(db, 'PRAGMA foreign_key_check')).toEqual([])
  })

  it('seedGroupDatabase rerun (second menu payload) is idempotent and FK-clean', async () => {
    await seedGroupDatabase(makeAdapter(db), seed as any)
    const menuSeed: any = { location_group: seed.location_group, menu: seed.menu, menu_category: seed.menu_category, menu_item: seed.menu_item, modifier_group: seed.modifier_group, modifier: seed.modifier, menu_menu_category: seed.menu_menu_category, menu_item_menu_category: seed.menu_item_menu_category, menu_item_modifier_group: seed.menu_item_modifier_group, modifier_group_modifier: seed.modifier_group_modifier, sub_category: [], combo: [] }

    await seedGroupDatabase(makeAdapter(db), menuSeed)
    await seedGroupDatabase(makeAdapter(db), menuSeed)
    expect(row(db, 'SELECT COUNT(*) AS c FROM menu_item').c).toBe(1)
    expect(all(db, 'PRAGMA foreign_key_check')).toEqual([])
  })

  it('seedGroupDatabase survives a hostile seed: empty strings, nulls, missing keys, unknown keys', async () => {
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

    await seedGroupDatabase(makeAdapter(db), hostile)

    // Unknown keys are dropped against the live schema (PRAGMA table_info), no
    // extra columns, no crash. Empty string name is preserved as '' — never
    // coerced to null (AGENTS.md §null/empty contract).
    expect((row(db, 'SELECT COUNT(*) AS c FROM country')).c).toBe(2)
    expect((row(db, `SELECT COUNT(*) AS c FROM country WHERE name = ''`)).c).toBe(2)
    // Rows missing a NOT NULL column (menu_category.name, menu_item.cache) or
    // carrying null for one get safe defaults filled (TEXT → '') so they insert
    // successfully — skipping would leave dangling FK references from join tables.
    expect((row(db, 'SELECT COUNT(*) AS c FROM location_group')).c).toBe(1)
    expect((row(db, 'SELECT COUNT(*) AS c FROM menu')).c).toBe(1)
    expect((row(db, 'SELECT COUNT(*) AS c FROM menu_category')).c).toBe(3)
    expect((row(db, 'SELECT COUNT(*) AS c FROM menu_item')).c).toBe(2)
    expect(all(db, 'PRAGMA foreign_key_check')).toEqual([])
  })

  it('rowsFromDb passes snake_case rows through (identity wire contract)', async () => {
    db.prepare(`INSERT INTO print_record (ticket_uuid, decision, printed_at, synced) VALUES ('t1','printed',123,0)`).run()
    const raw = all(db, 'SELECT ticket_uuid, decision, printed_at, synced FROM print_record WHERE ticket_uuid=?', 't1')
    const snake = rowsFromDb(raw)
    expect(snake[0]).toMatchObject({ ticket_uuid: 't1', decision: 'printed', printed_at: 123, synced: 0 })
  })

  it('a brand-new server table seeds with zero client release (no bundled metadata)', async () => {
    // CORE-LOGIC-SCHEMA-SYNC.md: a table added server-side must seed
    // on an unmodified engine. No SEED_COLUMNS entry, no playback code — the
    // column set is derived from the live schema by PRAGMA introspection.
    await applyDdl(makeAdapter(db), `CREATE TABLE IF NOT EXISTS "taste_preference" ("uuid" TEXT NOT NULL, "guest_uuid" TEXT, "note" TEXT, PRIMARY KEY ("uuid"))`)
    await seedGroupDatabase(makeAdapter(db), {
      taste_preference: [
        { uuid: 'tp-1', guest_uuid: 'guest1', note: '' },
        { uuid: 'tp-2', guest_uuid: 'guest1', unknown_key: 'dropped' },
      ],
    } as any)
    expect(row(db, 'SELECT COUNT(*) AS c FROM taste_preference').c).toBe(2)
    expect(row(db, `SELECT COUNT(*) AS c FROM taste_preference WHERE note = ''`).c).toBe(1)
  })

  it('heal re-seed over live data upserts ref rows without cascading into tickets', async () => {
    // HIGH-1 regression: reconcileData heal re-seeds a NON-empty DB with a
    // fresh server snapshot. INSERT OR REPLACE on the ref tables fires ON
    // DELETE CASCADE (ticket→dining_table, ticket_promotion→promotion,
    // ticket_menu_item→menu_item, ticket_payment→payment), silently wiping
    // live orders. The seeder must UPSERT on the PK so ref rows update in
    // place and tickets survive. Regression: this test FAILS on OR REPLACE.
    await seedGroupDatabase(makeAdapter(db), seed as any)
    await applyLogsBatch(makeAdapter(db), logs as any)

    // Heal snapshot built from the LIVE rows (complete, default-filled) with
    // the server's renames applied — the exact shape /sync returns.
    const snap = (t: string) => all(db, `SELECT * FROM "${t}"`).map((r) => ({ ...r }))
    const promotion = snap('promotion')[0]
    promotion.name = 'New BOGO'
    promotion.description = 'renamed'
    const table = snap('dining_table')[0]
    table.name = '12-renamed'
    const menuItem = snap('menu_item')[0]
    menuItem.name = 'Cheeseburger v2'
    const fulfillment = snap('fulfillment')[0]
    const payment = snap('payment')[0]
    const locationGroup = snap('location_group')[0]

    await seedGroupDatabase(makeAdapter(db), {
      location_group: [locationGroup],
      promotion: [promotion],
      dining_table: [table],
      menu_item: [menuItem],
      fulfillment: [fulfillment],
      payment: [payment],
    })

    // Server renames landed...
    expect(row(db, "SELECT name FROM promotion WHERE uuid='promo1'").name).toBe('New BOGO')
    expect(row(db, "SELECT name FROM dining_table WHERE uuid='tbl1'").name).toBe('12-renamed')
    expect(row(db, "SELECT name FROM menu_item WHERE uuid='mi1'").name).toBe('Cheeseburger v2')

    // ...and the live ticket graph is untouched (no cascade, no row loss).
    expect((row(db, 'SELECT COUNT(*) AS c FROM ticket')).c).toBe(1)
    expect((row(db, 'SELECT COUNT(*) AS c FROM ticket_menu_item')).c).toBe(1)
    expect((row(db, 'SELECT COUNT(*) AS c FROM ticket_promotion')).c).toBe(1)
    expect((row(db, 'SELECT COUNT(*) AS c FROM ticket_payment')).c).toBe(1)
    expect(all(db, 'PRAGMA foreign_key_check')).toEqual([])
  })
})

describe('T14/T17: backoff value + last_error truncation (real SQLite)', () => {
  let db: DatabaseSync

  // Fixed clock so the backoff ARITHMETIC (not just ordering) is asserted:
  // next_retry_at must equal now + (count+1)*10s exactly, not just "greater".
  const FIXED_NOW = 1_700_000_000_000

  beforeEach(async () => {
    db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    await applyDdl(makeAdapter(db), FULL_DDL)
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW)
  })

  afterEach(() => {
    db.close()
    vi.restoreAllMocks()
  })

  function badLog(action: string, uuid: string) {
    return { uuid, ticket_uuid: 't1', location_group_uuid: LG, admin_uuid: 'admin1', action, payload: {}, time_stamp: 1 }
  }

  it('T14: failLog writes next_retry_at = now + (retry_count+1) × 10s — exact value', async () => {
    await seedGroupDatabase(makeAdapter(db), seed as any)

    const log = badLog('BOGUS_ACTION', 'bogus-1')
    const first = await applyLogsBatch(makeAdapter(db), [log] as any)
    expect(first.applied).toBe(0)
    expect(first.errors).toHaveLength(1)

    // First failure: retry_count 0 → +1 count, next_retry_at = now + 10s.
    let tla = row(db, 'SELECT retry_count, next_retry_at, time_stamp FROM ticket_log_applied WHERE uuid=?', 'bogus-1')
    expect(tla.retry_count).toBe(1)
    expect(tla.next_retry_at).toBe(FIXED_NOW + 10_000)
    expect(tla.time_stamp).toBeNull() // still unapplied → retried next cycle

    // Second failure of the same log: count 1 → backoff grows to +20s.
    const second = await applyLogsBatch(makeAdapter(db), [log] as any)
    expect(second.applied).toBe(0)
    tla = row(db, 'SELECT retry_count, next_retry_at FROM ticket_log_applied WHERE uuid=?', 'bogus-1')
    expect(tla.retry_count).toBe(2)
    expect(tla.next_retry_at).toBe(FIXED_NOW + 20_000)
  })

  it('T17: last_error is truncated to exactly 255 chars like the Go/RN clients', async () => {
    await seedGroupDatabase(makeAdapter(db), seed as any)

    // UNKNOWN_ACTION message = "UNKNOWN_ACTION: " + a 300-char action name.
    const long = 'X'.repeat(300)
    await applyLogsBatch(makeAdapter(db), [badLog(long, 'bogus-2')] as any)

    const tla = row(db, 'SELECT retry_count, last_error FROM ticket_log_applied WHERE uuid=?', 'bogus-2')
    expect(tla.retry_count).toBe(1)
    expect(tla.last_error).toHaveLength(255)
    expect(tla.last_error.startsWith('UNKNOWN_ACTION: ')).toBe(true)
    // The truncated message must be a clean prefix of the real error text:
    // "UNKNOWN_ACTION: " (16 chars) + exactly 239 remaining X's → 255 total.
    expect(tla.last_error.endsWith('X'.repeat(239))).toBe(true)
  })

  it('T17: short errors are stored verbatim (no padding, no mangling)', async () => {
    await seedGroupDatabase(makeAdapter(db), seed as any)
    await applyLogsBatch(makeAdapter(db), [badLog('BOGUS_ACTION', 'bogus-3')] as any)
    const tla = row(db, 'SELECT last_error FROM ticket_log_applied WHERE uuid=?', 'bogus-3')
    expect(tla.last_error).toBe('UNKNOWN_ACTION: BOGUS_ACTION')
  })
})