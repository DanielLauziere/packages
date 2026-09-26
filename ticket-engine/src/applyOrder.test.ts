import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { DatabaseSync } from 'node:sqlite'
import {
  applyDdl,
  seedGroupDatabase,
  applyLogsBatch,
  hasLogBeenApplied,
  FULL_DDL,
  type DbAdapter,
  type TicketLogEntry,
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
  menu_menu_category: [{ uuid: 'mmc1', menu_uuid: 'menu1', menu_category_uuid: 'cat1' }],
  menu_item_menu_category: [{ uuid: 'mimc1', menu_item_uuid: 'mi1', menu_category_uuid: 'cat1' }],
  dining_table: [{ uuid: 'tbl1', name: '12', active: 1, location_group_uuid: LG }, { uuid: 'tbl2', name: '13', active: 1, location_group_uuid: LG }],
  payment: [{ uuid: 'pay1', name: 'Cash', code: 'CASH' }],
  fulfillment: [{ uuid: 'fu1', name: 'Dine-in', code: 'DINE' }],
  promotion: [{ uuid: 'promo1', name: 'BOGO', type: 'BOGO', active: 1, location_group_uuid: LG }],
  admin: [{ uuid: 'admin1', user_name: 'admin', password_hash: 'x' }],
}

let seq = 0
function log(overrides: Partial<TicketLogEntry>): TicketLogEntry {
  seq++
  return {
    uuid: `ord-${String(seq).padStart(4, '0')}`,
    ticket_uuid: 't1',
    location_group_uuid: LG,
    admin_uuid: 'admin1',
    action: 'SET_TABLE',
    payload: {},
    time_stamp: 1000 + seq,
    ...overrides,
  } as TicketLogEntry
}

function row(db: DatabaseSync, sql: string, ...p: any[]): any {
  return db.prepare(sql).get(...p)
}

async function arrive(db: DatabaseSync, entries: TicketLogEntry[]): Promise<void> {
  for (const entry of entries) {
    db.prepare(
      `INSERT INTO ticket_log (uuid, ticket_uuid, location_group_uuid, action, payload, time_stamp, admin_uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(entry.uuid, entry.ticket_uuid, entry.location_group_uuid, entry.action, JSON.stringify(entry.payload), entry.time_stamp, entry.admin_uuid ?? null)
    const res = await applyLogsBatch(makeAdapter(db), [entry])
    expect(res.errors).toEqual([])
  }
}

describe('out-of-order apply convergence (order-guard)', () => {
  let db: DatabaseSync

  beforeEach(async () => {
    seq = 0
    db = new DatabaseSync(':memory:')
    db.prepare('PRAGMA foreign_keys = ON').run()
    await applyDdl(makeAdapter(db), FULL_DDL)
    await seedGroupDatabase(makeAdapter(db), seed as any)
  })

  afterEach(() => db.close())

  it('late SET_STATUS_ACCEPTED never downgrades an applied PAID (the paid-vs-unpaid split)', async () => {
    const paid = log({ action: 'SET_STATUS_PAID', time_stamp: 10000 })
    const accepted = log({ action: 'SET_STATUS_ACCEPTED', time_stamp: 8000 })

    await arrive(db, [paid, accepted])
    expect(row(db, 'SELECT status FROM ticket WHERE uuid = ?', 't1').status).toBe('PAID')

    const db2 = new DatabaseSync(':memory:')
    db2.prepare('PRAGMA foreign_keys = ON').run()
    await applyDdl(makeAdapter(db2), FULL_DDL)
    await seedGroupDatabase(makeAdapter(db2), seed as any)
    seq = 0
    const paid2 = log({ action: 'SET_STATUS_PAID', time_stamp: 10000 })
    const accepted2 = log({ action: 'SET_STATUS_ACCEPTED', time_stamp: 8000 })
    await arrive(db2, [accepted2, paid2])
    expect(row(db2, 'SELECT status FROM ticket WHERE uuid = ?', 't1').status).toBe('PAID')
    db2.close()
  })

  it('late SET_STATUS_COMPLETE never downgrades an applied ACCEPTED', async () => {
    const accepted = log({ action: 'SET_STATUS_ACCEPTED', time_stamp: 9000 })
    const complete = log({ action: 'SET_STATUS_COMPLETE', time_stamp: 10000 })
    await arrive(db, [accepted, complete])
    expect(row(db, 'SELECT status FROM ticket WHERE uuid = ?', 't1').status).toBe('ACCEPTED')

    const db2 = new DatabaseSync(':memory:')
    db2.prepare('PRAGMA foreign_keys = ON').run()
    await applyDdl(makeAdapter(db2), FULL_DDL)
    await seedGroupDatabase(makeAdapter(db2), seed as any)
    seq = 0
    const accepted2 = log({ action: 'SET_STATUS_ACCEPTED', time_stamp: 9000 })
    const complete2 = log({ action: 'SET_STATUS_COMPLETE', time_stamp: 10000 })
    await arrive(db2, [complete2, accepted2])
    expect(row(db2, 'SELECT status FROM ticket WHERE uuid = ?', 't1').status).toBe('ACCEPTED')
    db2.close()
  })

  it('late earlier SET_TABLE never downgrades a later one (same-priority ts ordering)', async () => {
    const tableLater = log({ action: 'SET_TABLE', payload: { table_uuid: 'tbl2' }, time_stamp: 5000 })
    const tableEarlier = log({ action: 'SET_TABLE', payload: { table_uuid: 'tbl1' }, time_stamp: 1000 })

    await arrive(db, [tableLater, tableEarlier])
    expect(row(db, 'SELECT table_uuid FROM ticket WHERE uuid = ?', 't1').table_uuid).toBe('tbl2')

    const db2 = new DatabaseSync(':memory:')
    db2.prepare('PRAGMA foreign_keys = ON').run()
    await applyDdl(makeAdapter(db2), FULL_DDL)
    await seedGroupDatabase(makeAdapter(db2), seed as any)
    seq = 0
    const tableEarlier2 = log({ action: 'SET_TABLE', payload: { table_uuid: 'tbl1' }, time_stamp: 1000 })
    const tableLater2 = log({ action: 'SET_TABLE', payload: { table_uuid: 'tbl2' }, time_stamp: 5000 })
    await arrive(db2, [tableEarlier2, tableLater2])
    expect(row(db2, 'SELECT table_uuid FROM ticket WHERE uuid = ?', 't1').table_uuid).toBe('tbl2')
    db2.close()
  })

  it('late earlier SET_ITEM_NOTE never downgrades a later one', async () => {
    const add = log({ action: 'ADD_ITEM', payload: { menu_item_uuid: 'mi1' }, time_stamp: 1000 })
    const noteLater = log({ action: 'SET_ITEM_NOTE', payload: { ticket_menu_item_uuid: add.uuid, note: 'later' }, time_stamp: 5000 })
    const noteEarlier = log({ action: 'SET_ITEM_NOTE', payload: { ticket_menu_item_uuid: add.uuid, note: 'earlier' }, time_stamp: 3000 })

    await arrive(db, [add, noteLater, noteEarlier])
    expect(row(db, 'SELECT note FROM ticket_menu_item WHERE uuid = ?', add.uuid).note).toBe('later')

    const db2 = new DatabaseSync(':memory:')
    db2.prepare('PRAGMA foreign_keys = ON').run()
    await applyDdl(makeAdapter(db2), FULL_DDL)
    await seedGroupDatabase(makeAdapter(db2), seed as any)
    seq = 0
    const add2 = log({ action: 'ADD_ITEM', payload: { menu_item_uuid: 'mi1' }, time_stamp: 1000 })
    const noteEarlier2 = log({ action: 'SET_ITEM_NOTE', payload: { ticket_menu_item_uuid: add2.uuid, note: 'earlier' }, time_stamp: 3000 })
    const noteLater2 = log({ action: 'SET_ITEM_NOTE', payload: { ticket_menu_item_uuid: add2.uuid, note: 'later' }, time_stamp: 5000 })
    await arrive(db2, [add2, noteEarlier2, noteLater2])
    expect(row(db2, 'SELECT note FROM ticket_menu_item WHERE uuid = ?', add2.uuid).note).toBe('later')
    db2.close()
  })

  it('late APPLY_PROMOTION after an applied REMOVE_PROMOTION stays removed', async () => {
    const add = log({ action: 'ADD_ITEM', payload: { menu_item_uuid: 'mi1' }, time_stamp: 1000 })
    const applyPromo = log({ action: 'APPLY_PROMOTION', payload: { promotion_uuid: 'promo1' }, time_stamp: 2000 })
    const removePromo = log({ action: 'REMOVE_PROMOTION', payload: { promotion_uuid: 'promo1' }, time_stamp: 3000 })

    await arrive(db, [add, removePromo, applyPromo])
    expect(row(db, 'SELECT COUNT(*) AS c FROM ticket_promotion WHERE ticket_uuid = ?', 't1').c).toBe(0)

    const db2 = new DatabaseSync(':memory:')
    db2.prepare('PRAGMA foreign_keys = ON').run()
    await applyDdl(makeAdapter(db2), FULL_DDL)
    await seedGroupDatabase(makeAdapter(db2), seed as any)
    seq = 0
    const add2 = log({ action: 'ADD_ITEM', payload: { menu_item_uuid: 'mi1' }, time_stamp: 1000 })
    const applyPromo2 = log({ action: 'APPLY_PROMOTION', payload: { promotion_uuid: 'promo1' }, time_stamp: 2000 })
    const removePromo2 = log({ action: 'REMOVE_PROMOTION', payload: { promotion_uuid: 'promo1' }, time_stamp: 3000 })
    await arrive(db2, [add2, applyPromo2, removePromo2])
    expect(row(db2, 'SELECT COUNT(*) AS c FROM ticket_promotion WHERE ticket_uuid = ?', 't1').c).toBe(0)
    db2.close()
  })

  it('late SET_FULFILLMENT after an applied ADD_ITEM still applies (items never supersede checkout)', async () => {
    const add = log({ action: 'ADD_ITEM', payload: { menu_item_uuid: 'mi1' }, time_stamp: 1000 })
    const fulfill = log({ action: 'SET_FULFILLMENT', payload: { fulfillment_uuid: 'fu1' }, time_stamp: 2000 })

    // items arrive in an earlier round, fulfillment lands later
    await arrive(db, [add, fulfill])
    expect(row(db, 'SELECT fulfillment_uuid FROM ticket WHERE uuid = ?', 't1').fulfillment_uuid).toBe('fu1')

    // reverse arrival still converges
    const db2 = new DatabaseSync(':memory:')
    db2.prepare('PRAGMA foreign_keys = ON').run()
    await applyDdl(makeAdapter(db2), FULL_DDL)
    await seedGroupDatabase(makeAdapter(db2), seed as any)
    seq = 0
    const add2 = log({ action: 'ADD_ITEM', payload: { menu_item_uuid: 'mi1' }, time_stamp: 1000 })
    const fulfill2 = log({ action: 'SET_FULFILLMENT', payload: { fulfillment_uuid: 'fu1' }, time_stamp: 2000 })
    await arrive(db2, [fulfill2, add2])
    expect(row(db2, 'SELECT fulfillment_uuid FROM ticket WHERE uuid = ?', 't1').fulfillment_uuid).toBe('fu1')
    db2.close()
  })

  it('a late note for one item is not superseded by a note on another item', async () => {
    const add1 = log({ action: 'ADD_ITEM', payload: { menu_item_uuid: 'mi1' }, time_stamp: 1000 })
    const add2 = log({ action: 'ADD_ITEM', payload: { menu_item_uuid: 'mi1' }, time_stamp: 1100 })
    const noteB = log({ action: 'SET_ITEM_NOTE', payload: { ticket_menu_item_uuid: add2.uuid, note: 'b' }, time_stamp: 3000 })
    const noteA = log({ action: 'SET_ITEM_NOTE', payload: { ticket_menu_item_uuid: add1.uuid, note: 'a' }, time_stamp: 2000 })

    await arrive(db, [add1, add2, noteB, noteA])
    expect(row(db, 'SELECT note FROM ticket_menu_item WHERE uuid = ?', add1.uuid).note).toBe('a')
    expect(row(db, 'SELECT note FROM ticket_menu_item WHERE uuid = ?', add2.uuid).note).toBe('b')
  })

  it('a superseded log is still marked applied — no retry loop, no wedge', async () => {
    const paid = log({ action: 'SET_STATUS_PAID', time_stamp: 10000 })
    const accepted = log({ action: 'SET_STATUS_ACCEPTED', time_stamp: 8000 })
    await arrive(db, [paid, accepted])
    expect(await hasLogBeenApplied(makeAdapter(db), accepted.uuid)).toBe(true)
    const pending = row(db, `SELECT COUNT(*) AS c FROM ticket_log_applied WHERE "time_stamp" IS NULL`)
    expect(pending.c).toBe(0)
  })

  it('ticket time_stamp converges to the MIN of its logs regardless of arrival order', async () => {
    const later = log({ action: 'SET_TABLE', payload: { table_uuid: 'tbl1' }, time_stamp: 5000 })
    const earlier = log({ action: 'ADD_ITEM', payload: { menu_item_uuid: 'mi1' }, time_stamp: 1000 })

    await arrive(db, [later, earlier])
    expect(Number(row(db, 'SELECT time_stamp FROM ticket WHERE uuid = ?', 't1').time_stamp)).toBe(1000)

    const db2 = new DatabaseSync(':memory:')
    db2.prepare('PRAGMA foreign_keys = ON').run()
    await applyDdl(makeAdapter(db2), FULL_DDL)
    await seedGroupDatabase(makeAdapter(db2), seed as any)
    seq = 0
    const earlier2 = log({ action: 'ADD_ITEM', payload: { menu_item_uuid: 'mi1' }, time_stamp: 1000 })
    const later2 = log({ action: 'SET_TABLE', payload: { table_uuid: 'tbl1' }, time_stamp: 5000 })
    await arrive(db2, [earlier2, later2])
    expect(Number(row(db2, 'SELECT time_stamp FROM ticket WHERE uuid = ?', 't1').time_stamp)).toBe(1000)
    db2.close()
  })

  it('in-batch sorted apply (all logs present at once) still yields the deterministic winner', async () => {
    const entries = [
      log({ action: 'ADD_ITEM', payload: { menu_item_uuid: 'mi1' }, time_stamp: 1000 }),
      log({ action: 'SET_STATUS_ACCEPTED', time_stamp: 8000 }),
      log({ action: 'SET_STATUS_PAID', time_stamp: 7000 }),
    ]
    for (const e of entries) {
      db.prepare(
        `INSERT INTO ticket_log (uuid, ticket_uuid, location_group_uuid, action, payload, time_stamp, admin_uuid)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(e.uuid, e.ticket_uuid, e.location_group_uuid, e.action, JSON.stringify(e.payload), e.time_stamp, e.admin_uuid ?? null)
    }
    const res = await applyLogsBatch(makeAdapter(db), entries)
    expect(res.applied).toBe(3)
    expect(row(db, 'SELECT status FROM ticket WHERE uuid = ?', 't1').status).toBe('PAID')
  })
})
