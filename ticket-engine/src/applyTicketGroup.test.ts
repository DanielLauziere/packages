import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { DatabaseSync } from 'node:sqlite'
import {
  applyDdl,
  seedGroupDatabase,
  applyTicketGroup,
  hasLogBeenApplied,
  FULL_DDL,
  RETRY_BACKOFF_CAP_STEPS,
  type DbAdapter,
  type TicketLogRow,
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
  country: [{ uuid: 'ct-1', name: 'El Salvador', nombre: 'El Salvador', iso: 'SV', iso3: 'SLV', phone_code: 503 }],
  location_group: [{ uuid: LG, name: 'Main Location', country_uuid: 'ct-1' }],
  menu: [{ uuid: 'menu1', name: 'Main Menu', active: 1, location_group_uuid: LG }],
  menu_category: [{ uuid: 'cat1', name: 'Burgers', active: 1, location_group_uuid: LG }],
  menu_item: [{ uuid: 'mi1', name: 'Cheeseburger', description: '', price_whole: 5, price_hundredths: 0, active: 1, complete: 0, location_group_uuid: LG, cache: '{}' }],
  menu_menu_category: [{ uuid: 'mmc1', menu_uuid: 'menu1', menu_category_uuid: 'cat1' }],
  menu_item_menu_category: [{ uuid: 'mimc1', menu_item_uuid: 'mi1', menu_category_uuid: 'cat1' }],
  dining_table: [{ uuid: 'tbl1', name: '12', active: 1, location_group_uuid: LG }],
  payment: [{ uuid: 'pay1', name: 'Cash', code: 'CASH' }],
  fulfillment: [{ uuid: 'fu1', name: 'Dine-in', code: 'DINE' }],
  admin: [{ uuid: 'admin1', user_name: 'admin', password_hash: 'x' }],
}

let seq = 0
function logRow(overrides: Partial<TicketLogRow> = {}): TicketLogRow {
  seq++
  return {
    uuid: `grp-${String(seq).padStart(4, '0')}`,
    ticket_uuid: 't1',
    location_group_uuid: LG,
    admin_uuid: 'admin1',
    action: 'SET_TABLE',
    payload: { table_uuid: 'tbl1' },
    time_stamp: 1000 + seq,
    ...overrides,
  } as TicketLogRow
}

/** Park the row in ticket_log exactly like ingest (insertLog) does — the
 *  guard reads siblings from ticket_log JOIN ticket_log_applied. */
function park(db: DatabaseSync, rows: TicketLogRow[]): void {
  for (const r of rows) {
    db.prepare(
      `INSERT INTO ticket_log (uuid, ticket_uuid, location_group_uuid, action, payload, time_stamp, admin_uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(uuid) DO NOTHING`,
    ).run(
      r.uuid,
      r.ticket_uuid,
      r.location_group_uuid,
      r.action,
      r.payload == null ? null : JSON.stringify(r.payload),
      r.time_stamp ?? null,
      r.admin_uuid ?? null,
    )
  }
}

function row(db: DatabaseSync, sql: string, ...p: any[]): any {
  return db.prepare(sql).get(...p)
}

describe('applyTicketGroup (one shared adapter per ticket group)', () => {
  let db: DatabaseSync

  beforeEach(async () => {
    seq = 0
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    db = new DatabaseSync(':memory:')
    db.prepare('PRAGMA foreign_keys = ON').run()
    await applyDdl(makeAdapter(db), FULL_DDL)
    await seedGroupDatabase(makeAdapter(db), seed as any)
  })

  afterEach(() => {
    db.close()
    vi.restoreAllMocks()
  })

  it('applies a whole ticket group and marks every log applied', async () => {
    const rows = [
      logRow({ action: 'SET_TABLE', payload: { table_uuid: 'tbl1' }, time_stamp: 1000 }),
      logRow({ action: 'ADD_ITEM', payload: { menu_item_uuid: 'mi1' }, time_stamp: 2000 }),
      logRow({ action: 'SET_STATUS_PAID', payload: {}, time_stamp: 3000 }),
    ]
    park(db, rows)

    const res = await applyTicketGroup(
      { adapter: makeAdapter(db), query: (sql, params) => db.prepare(sql).all(...((params ?? []) as any[])) },
      rows,
    )

    expect(res.applied).toBe(3)
    expect(res.skipped).toBe(0)
    expect(res.errors).toEqual([])
    expect(row(db, 'SELECT status FROM ticket WHERE uuid = ?', 't1').status).toBe('PAID')
    expect(row(db, 'SELECT COUNT(*) AS c FROM ticket_menu_item').c).toBe(1)
    for (const r of rows) expect(await hasLogBeenApplied(makeAdapter(db), r.uuid)).toBe(true)
  })

  it('skips already-applied logs via ONE batched prefetch (not a query per log)', async () => {
    const rows = [
      logRow({ action: 'SET_TABLE', payload: { table_uuid: 'tbl1' }, time_stamp: 1000 }),
      logRow({ action: 'SET_STATUS_PAID', payload: {}, time_stamp: 2000 }),
      logRow({ action: 'PRINT_SUCCESS', payload: {}, time_stamp: 3000 }),
    ]
    // First log applied in a previous pass.
    db.prepare(`INSERT INTO ticket_log_applied (uuid, time_stamp) VALUES (?, ?)`).run(rows[0]!.uuid, 1000)
    park(db, rows)

    const rawQueries: string[] = []
    const res = await applyTicketGroup(
      {
        adapter: makeAdapter(db),
        query: (sql, params) => {
          if (sql.includes('"uuid" IN (')) rawQueries.push(sql)
          return db.prepare(sql).all(...((params ?? []) as any[]))
        },
      },
      rows,
    )

    expect(res.applied).toBe(2)
    expect(res.skipped).toBe(1)
    expect(rawQueries).toHaveLength(1)
    expect(rawQueries[0]).toContain('"uuid" IN (')
  })

  it('MISSING_DEPENDENCY backs off with retry state and keeps going (no error)', async () => {
    const rows = [
      logRow({ action: 'SET_TABLE', payload: { table_uuid: 'ghost-table' }, time_stamp: 1000 }),
      logRow({ action: 'SET_STATUS_ACCEPTED', payload: {}, time_stamp: 2000 }),
    ]
    park(db, rows)

    const res = await applyTicketGroup(
      { adapter: makeAdapter(db), query: (sql, params) => db.prepare(sql).all(...((params ?? []) as any[])) },
      rows,
    )

    expect(res.applied).toBe(1)
    expect(res.skipped).toBe(1)
    expect(res.errors).toEqual([])

    const tla = row(db, 'SELECT retry_count, next_retry_at, time_stamp FROM ticket_log_applied WHERE uuid = ?', rows[0]!.uuid)
    expect(tla.retry_count).toBe(1)
    expect(tla.next_retry_at).toBe(1_000_000 + 10_000) // first failure = +10s
    expect(tla.time_stamp).toBeNull() // still unapplied → the loop retries it
    expect(await hasLogBeenApplied(makeAdapter(db), rows[1]!.uuid)).toBe(true)
  })

  it('one bad log never stops the rest of the group (claim + backoff persist)', async () => {
    const rows = [
      logRow({ action: 'BOGUS_ACTION', payload: {}, time_stamp: 1000 }),
      logRow({ action: 'SET_STATUS_ACCEPTED', payload: {}, time_stamp: 2000 }),
    ]
    park(db, rows)

    const res = await applyTicketGroup(
      { adapter: makeAdapter(db), query: (sql, params) => db.prepare(sql).all(...((params ?? []) as any[])) },
      rows,
    )

    expect(res.applied).toBe(1)
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]!.entry.uuid).toBe(rows[0]!.uuid)
    expect(res.errors[0]!.error).toBeInstanceOf(Error)
    expect(String((res.errors[0]!.error as Error).message)).toMatch(/UNKNOWN_ACTION/)

    // Claim + failure state persisted (outside the rolled-back transaction).
    const tla = row(db, 'SELECT retry_count, time_stamp, next_retry_at FROM ticket_log_applied WHERE uuid = ?', rows[0]!.uuid)
    expect(tla.retry_count).toBe(1)
    expect(tla.time_stamp).toBeNull()
    expect(tla.next_retry_at).toBe(1_000_000 + 10_000)
    expect(await hasLogBeenApplied(makeAdapter(db), rows[1]!.uuid)).toBe(true)
    expect(row(db, 'SELECT status FROM ticket WHERE uuid = ?', 't1').status).toBe('ACCEPTED')
  })

  it('retry backoff is capped at RETRY_BACKOFF_CAP_STEPS × 10s (60s)', async () => {
    const bad = logRow({ action: 'BOGUS_ACTION', payload: {}, time_stamp: 1000 })
    park(db, [bad])

    const deps = {
      adapter: makeAdapter(db),
      query: (sql: string, params?: any[]) => db.prepare(sql).all(...((params ?? []) as any[])),
    }

    const failures = RETRY_BACKOFF_CAP_STEPS + 3
    for (let i = 0; i < failures; i++) {
      await applyTicketGroup(deps, [bad])
    }

    const tla = row(db, 'SELECT retry_count, next_retry_at FROM ticket_log_applied WHERE uuid = ?', bad.uuid)
    expect(tla.retry_count).toBe(failures)
    // Uncapped would be failures × 10s = 90s — the cap pins it at 60s.
    expect(tla.next_retry_at).toBe(1_000_000 + RETRY_BACKOFF_CAP_STEPS * 10_000)
    expect(tla.next_retry_at).toBe(1_000_000 + 60_000)
  })

  it('is idempotent: re-running an applied group skips everything', async () => {
    const rows = [
      logRow({ action: 'SET_TABLE', payload: { table_uuid: 'tbl1' }, time_stamp: 1000 }),
      logRow({ action: 'ADD_ITEM', payload: { menu_item_uuid: 'mi1' }, time_stamp: 2000 }),
    ]
    park(db, rows)

    const deps = {
      adapter: makeAdapter(db),
      query: (sql: string, params?: any[]) => db.prepare(sql).all(...((params ?? []) as any[])),
    }

    const first = await applyTicketGroup(deps, rows)
    expect(first.applied).toBe(2)

    const second = await applyTicketGroup(deps, rows)
    expect(second.applied).toBe(0)
    expect(second.skipped).toBe(2)
    expect(second.errors).toEqual([])
    expect(row(db, 'SELECT COUNT(*) AS c FROM ticket_menu_item').c).toBe(1)
  })

  it('850 unapplied logs span exactly 3 chunked prefetch queries; a pre-applied log in the LAST chunk is skipped', async () => {
    // 851 rows: 850 unapplied + 1 already applied in the final chunk
    // (APPLIED_CHECK_CHUNK = 400 → ceil(851/400) = 3 IN-queries).
    const rows: TicketLogRow[] = []
    for (let i = 0; i < 851; i++) {
      rows.push(logRow({ action: 'PRINT_SUCCESS', payload: {}, time_stamp: 1000 + i }))
    }
    // Sorted by time_stamp, so the newest row sorts into the LAST chunk.
    const preApplied = rows[rows.length - 1]!
    db.prepare('INSERT INTO ticket_log_applied (uuid, time_stamp) VALUES (?, ?)').run(preApplied.uuid, preApplied.time_stamp)
    park(db, rows)

    const inQueries: string[] = []
    const res = await applyTicketGroup(
      {
        adapter: makeAdapter(db),
        query: (sql, params) => {
          if (sql.includes('"uuid" IN (')) inQueries.push(sql)
          return db.prepare(sql).all(...((params ?? []) as any[]))
        },
      },
      rows,
    )

    expect(inQueries).toHaveLength(3) // 400 + 400 + 51 placeholders
    expect(res.applied).toBe(850)
    expect(res.skipped).toBe(1) // the pre-applied log in the last chunk
    expect(res.errors).toEqual([])
    // Every row accounted for: 851 ledger rows, none left unapplied, and the
    // pre-applied one kept its original stamp (never re-claimed).
    expect(row(db, 'SELECT COUNT(*) AS c FROM ticket_log_applied').c).toBe(851)
    expect(row(db, 'SELECT COUNT(*) AS c FROM ticket_log_applied WHERE "time_stamp" IS NULL').c).toBe(0)
    const pre = row(db, 'SELECT time_stamp FROM ticket_log_applied WHERE uuid = ?', preApplied.uuid)
    expect(Number(pre.time_stamp)).toBe(preApplied.time_stamp)
    expect(await hasLogBeenApplied(makeAdapter(db), preApplied.uuid)).toBe(true)
  })

  it('a stale ACCEPTED in a later pass never downgrades an applied PAID', async () => {
    const paid = logRow({ action: 'SET_STATUS_PAID', payload: {}, time_stamp: 10000 })
    park(db, [paid])
    const pass1 = await applyTicketGroup(
      { adapter: makeAdapter(db), query: (sql, params) => db.prepare(sql).all(...((params ?? []) as any[])) },
      [paid],
    )
    expect(pass1.applied).toBe(1)
    expect(row(db, 'SELECT status FROM ticket WHERE uuid = ?', 't1').status).toBe('PAID')

    // Device comes back online with a stale ACCEPTED for the same ticket.
    const stale = logRow({ action: 'SET_STATUS_ACCEPTED', payload: {}, time_stamp: 8000 })
    park(db, [stale])
    const pass2 = await applyTicketGroup(
      { adapter: makeAdapter(db), query: (sql, params) => db.prepare(sql).all(...((params ?? []) as any[])) },
      [stale],
    )

    expect(pass2.errors).toEqual([])
    expect(row(db, 'SELECT status FROM ticket WHERE uuid = ?', 't1').status).toBe('PAID')
    // The stale log is recorded as applied (guard skip ≠ unapplied) so it is
    // never re-fetched/re-replayed.
    expect(await hasLogBeenApplied(makeAdapter(db), stale.uuid)).toBe(true)
  })
})
