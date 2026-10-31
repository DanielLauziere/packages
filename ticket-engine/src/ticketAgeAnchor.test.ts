import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { TICKET_AGE_ANCHOR_SQL } from './ticketAgeAnchor.js'
import {
  decodeTicketLogGroup,
  encodeTicketLogGroup,
  type TicketLogWireInput,
} from './ticketLogWire.js'

// The age badge must survive the compact wire: rows carry no per-row
// timestamp, so SET_STATUS_COMPLETE carries `p.timeStamp` instead, and the
// shared anchor SQL reads it back after a wipe + re-pull (logout/login).
describe('completion timeStamp on the compact wire', () => {
  it('backfills p.timeStamp on every SET_STATUS_COMPLETE from its row time', () => {
    const wire = encodeTicketLogGroup([
      { uuid: 'create', action: 'ADD_ITEM', payload: {}, time_stamp: 100 },
      {
        uuid: 'done',
        action: 'SET_STATUS_COMPLETE',
        payload: {},
        time_stamp: 5000,
      },
    ])

    const complete = wire.logs.find((log) => log.u === 'done')
    expect(complete?.p).toEqual({ timeStamp: 5000 })
    // Other actions keep their payloads byte-for-byte.
    expect(wire.logs.find((log) => log.u === 'create')?.p).toEqual({})
  })

  it('keeps an existing payload.timeStamp instead of overwriting it', () => {
    const wire = encodeTicketLogGroup([
      {
        uuid: 'done',
        action: 'SET_STATUS_COMPLETE',
        payload: { timeStamp: 4200, note: 'x' },
        time_stamp: 9000, // row time is newer — p.timeStamp wins
      },
    ])
    expect(wire.logs[0]!.p).toEqual({ timeStamp: 4200, note: 'x' })
  })

  it('survives decode: rows collapse to the group time, p.timeStamp does not', () => {
    const wire = encodeTicketLogGroup([
      { uuid: 'create', action: 'ADD_ITEM', payload: {}, time_stamp: 100 },
      {
        uuid: 'done',
        action: 'SET_STATUS_COMPLETE',
        payload: {},
        time_stamp: 5000,
      },
      {
        uuid: 'print',
        action: 'PRINT_SUCCESS',
        payload: {},
        time_stamp: 6000,
      },
    ])
    expect(wire.time_stamp).toBe(6000)

    const rows = decodeTicketLogGroup('ticket', 'location', wire)
    const done = rows.find((row) => row.uuid === 'done')!
    // The row timestamp is destroyed by the wire (group stamping)…
    expect(done.time_stamp).toBe(6000)
    // …but the completion time still rides the payload.
    expect(done.payload).toEqual({ timeStamp: 5000 })
  })
})

describe('TICKET_AGE_ANCHOR_SQL', () => {
  function makeDb() {
    const db = new DatabaseSync(':memory:')
    db.exec(`
      CREATE TABLE ticket_log (
        uuid TEXT PRIMARY KEY,
        ticket_uuid TEXT,
        action TEXT,
        payload TEXT,
        time_stamp INTEGER
      )
    `)
    return db
  }

  function insert(
    db: DatabaseSync,
    row: {
      uuid: string
      ticket_uuid?: string
      action: string
      payload: unknown
      time_stamp: number
    },
  ) {
    db.prepare(
      `INSERT INTO ticket_log (uuid, ticket_uuid, action, payload, time_stamp)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      row.uuid,
      row.ticket_uuid ?? 't-1',
      row.action,
      JSON.stringify(row.payload),
      row.time_stamp,
    )
  }

  function anchor(db: DatabaseSync, ticketUuid = 't-1'): number | null {
    const row = db
      .prepare(TICKET_AGE_ANCHOR_SQL)
      .get(ticketUuid) as { time_stamp: number | null } | undefined
    return row?.time_stamp ?? null
  }

  it('anchors a completed ticket on p.timeStamp, not the collapsed row time', () => {
    const db = makeDb()
    insert(db, { uuid: 'create', action: 'ADD_ITEM', payload: {}, time_stamp: 100 })
    // Wipe + re-pull: every row stamped with the group time (6000), but the
    // payload still says the ticket completed at 5000.
    insert(db, {
      uuid: 'done',
      action: 'SET_STATUS_COMPLETE',
      payload: { timeStamp: 5000 },
      time_stamp: 6000,
    })
    insert(db, {
      uuid: 'print',
      action: 'PRINT_SUCCESS',
      payload: {},
      time_stamp: 6000,
    })

    expect(anchor(db)).toBe(5000)
    db.close()
  })

  it('falls back to the row time for legacy completion rows without p.timeStamp', () => {
    const db = makeDb()
    insert(db, { uuid: 'create', action: 'ADD_ITEM', payload: {}, time_stamp: 100 })
    insert(db, {
      uuid: 'done',
      action: 'SET_STATUS_COMPLETE',
      payload: {},
      time_stamp: 5000,
    })

    expect(anchor(db)).toBe(5000)
    db.close()
  })

  it('uses the newest completion when the ticket completed more than once', () => {
    const db = makeDb()
    insert(db, {
      uuid: 'done-1',
      action: 'SET_STATUS_COMPLETE',
      payload: { timeStamp: 4000 },
      time_stamp: 4000,
    })
    insert(db, {
      uuid: 'done-2',
      action: 'SET_STATUS_COMPLETE',
      payload: { timeStamp: 7000 },
      time_stamp: 7000,
    })

    expect(anchor(db)).toBe(7000)
    db.close()
  })

  it('anchors a never-completed ticket on its first log (creation)', () => {
    const db = makeDb()
    insert(db, { uuid: 'a', action: 'ADD_ITEM', payload: {}, time_stamp: 300 })
    insert(db, { uuid: 'b', action: 'SET_TABLE', payload: {}, time_stamp: 200 })

    expect(anchor(db)).toBe(200)
    db.close()
  })

  it('returns null for a ticket with no logs', () => {
    const db = makeDb()
    expect(anchor(db)).toBeNull()
    db.close()
  })
})
