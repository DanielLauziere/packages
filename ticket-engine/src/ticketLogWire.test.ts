import { describe, expect, it } from 'vitest'

import {
  TICKET_LOG_ACTION_IDS,
  actionIdForTicketLog,
  decodeTicketLogBuckets,
  decodeTicketLogGroup,
  encodeTicketLogBuckets,
  encodeTicketLogGroup,
  rowTimeStamp,
  type TicketLogWireInput,
} from './ticketLogWire.js'

describe('compact ticket-log wire protocol', () => {
  it('uses the stable action IDs, including the menu-item wire aliases', () => {
    expect(TICKET_LOG_ACTION_IDS.ADD_MENU_ITEM).toBe(1)
    expect(TICKET_LOG_ACTION_IDS.REMOVE_MENU_ITEM).toBe(2)
    expect(TICKET_LOG_ACTION_IDS.PRINT_SUCCESS).toBe(17)
    expect(TICKET_LOG_ACTION_IDS.PRINT_REASSIGN).toBe(20)
    expect(TICKET_LOG_ACTION_IDS.PRINT_FAILED).toBe(21)

    const group = encodeTicketLogGroup([
      {
        uuid: 'item',
        action: 'ADD_ITEM',
        payload: { menu_item_uuid: 'menu-item' },
        time_stamp: 120,
      },
    ])
    expect(group.logs[0]).toEqual({
      u: 'item',
      a: 1,
      p: { menu_item_uuid: 'menu-item' },
    })
  })

  it('round-trips the last-adjusted time, the admin set, and payload', () => {
    const logs: TicketLogWireInput[] = [
      {
        uuid: 'later',
        action: 'PRINT_REQUEST',
        payload: {},
        time_stamp: 200,
        admin_uuid: 'admin-b',
      },
      {
        uuid: 'earlier',
        action: 'SET_TABLE',
        payload: { table_uuid: 'table' },
        time_stamp: 100,
        admin_uuid: 'admin-a',
      },
      {
        uuid: 'last',
        action: 'PRINT_PASS',
        payload: { reason: 'handoff' },
        time_stamp: 220,
        admin_uuid: 'admin-b',
      },
    ]

    const wire = encodeTicketLogGroup(logs)
    expect(wire).toEqual({
      time_stamp: 220,
      admin_uuid: ['admin-a', 'admin-b'],
      logs: [
        { u: 'earlier', a: 3, p: { table_uuid: 'table' } },
        { u: 'later', a: 19, p: {} },
        { u: 'last', a: 18, p: { reason: 'handoff' } },
      ],
    })

    // Rows carry no timestamp or author: every row is stamped with the
    // group's last-adjusted time and attributed to the first admin.
    expect(decodeTicketLogGroup('ticket', 'location', wire)).toEqual([
      {
        uuid: 'earlier',
        ticket_uuid: 'ticket',
        location_group_uuid: 'location',
        action: 'SET_TABLE',
        payload: { table_uuid: 'table' },
        time_stamp: 220,
        admin_uuid: 'admin-a',
      },
      {
        uuid: 'later',
        ticket_uuid: 'ticket',
        location_group_uuid: 'location',
        action: 'PRINT_REQUEST',
        payload: {},
        time_stamp: 220,
        admin_uuid: 'admin-a',
      },
      {
        uuid: 'last',
        ticket_uuid: 'ticket',
        location_group_uuid: 'location',
        action: 'PRINT_PASS',
        payload: { reason: 'handoff' },
        time_stamp: 220,
        admin_uuid: 'admin-a',
      },
    ])
  })

  it('carries an empty admin list for guest-created tickets', () => {
    const wire = encodeTicketLogGroup([
      {
        uuid: 'guest-log',
        action: 'ADD_ITEM',
        payload: {},
        time_stamp: 5,
      },
      {
        uuid: 'admin-log',
        action: 'PRINT_REQUEST',
        payload: {},
        time_stamp: 6,
        admin_uuid: 'admin-a',
      },
    ])
    // First-touch order: only admins that actually adjusted the ticket.
    expect(wire.admin_uuid).toEqual(['admin-a'])
    const decoded = decodeTicketLogGroup('ticket', 'location', wire)
    expect(decoded.every((row) => row.admin_uuid === 'admin-a')).toBe(true)

    const guestOnly = encodeTicketLogGroup([
      { uuid: 'g', action: 'ADD_ITEM', payload: {}, time_stamp: 1 },
    ])
    expect(guestOnly.admin_uuid).toEqual([])
    expect(
      decodeTicketLogGroup('ticket', 'location', guestOnly)[0],
    ).not.toHaveProperty('admin_uuid')
  })

  it('encodes and decodes ticket groups in bucket maps', () => {
    const encoded = encodeTicketLogBuckets({
      4: {
        ticket: [
          {
            uuid: 'log',
            action: 'REMOVE_ITEM',
            payload: { ticket_menu_item_uuid: 'item' },
            time_stamp: 44,
            admin_uuid: 'admin',
          },
        ],
      },
    })
    expect(encoded[4]?.ticket?.logs[0]?.a).toBe(2)
    expect(decodeTicketLogBuckets(encoded, 'location')[4]?.ticket?.[0]).toEqual({
      uuid: 'log',
      ticket_uuid: 'ticket',
      location_group_uuid: 'location',
      action: 'REMOVE_ITEM',
      payload: { ticket_menu_item_uuid: 'item' },
      time_stamp: 44,
      admin_uuid: 'admin',
    })
  })

  it('rejects unknown actions and malformed groups', () => {
    expect(() =>
      encodeTicketLogGroup([
        {
          uuid: 'unknown',
          action: 'FUTURE_ACTION',
          payload: {},
          time_stamp: 1,
        },
      ]),
    ).toThrow('unknown ticket-log action')

    const group = encodeTicketLogGroup([
      { uuid: 'known', action: 'SET_TABLE', payload: {}, time_stamp: 1 },
    ])
    expect(() =>
      decodeTicketLogGroup('ticket', 'location', { ...group, logs: [] }),
    ).toThrow('invalid compact ticket-log group')
    expect(() =>
      decodeTicketLogGroup('ticket', 'location', {
        ...group,
        admin_uuid: null as never,
      }),
    ).toThrow('invalid compact ticket-log group')
    expect(() =>
      decodeTicketLogGroup('ticket', 'location', {
        ...group,
        admin_uuid: [42] as never,
      }),
    ).toThrow('invalid compact ticket-log group')
    expect(() =>
      decodeTicketLogGroup('ticket', 'location', {
        ...group,
        time_stamp: 'x' as never,
      }),
    ).toThrow('invalid ticket timestamp')
    expect(() =>
      decodeTicketLogGroup('ticket', 'location', {
        ...group,
        logs: [{ ...group.logs[0]!, a: 99 }],
      }),
    ).toThrow('unknown ticket-log action ID')
    expect(() =>
      decodeTicketLogGroup('ticket', 'location', {
        ...group,
        logs: [{ u: 'missing-payload', a: 3 } as never],
      }),
    ).toThrow('invalid compact ticket-log row')
  })

  it('rejects timestamps that cannot be represented on the wire', () => {
    expect(() =>
      encodeTicketLogGroup([
        {
          uuid: 'unsafe',
          action: 'SET_TABLE',
          payload: {},
          time_stamp: 2 ** 53,
        },
      ]),
    ).toThrow('invalid ticket-log timestamp')

    const group = encodeTicketLogGroup([
      { uuid: 'known', action: 'SET_TABLE', payload: {}, time_stamp: 1 },
    ])
    expect(() =>
      decodeTicketLogGroup('ticket', 'location', {
        ...group,
        completed_at: 2 ** 53,
      }),
    ).toThrow('invalid completed timestamp')
  })

  it('maps PRINT_SUCCESS to wire id 17 and back', () => {
    expect(TICKET_LOG_ACTION_IDS.PRINT_SUCCESS).toBe(17)
    expect(actionIdForTicketLog('PRINT_SUCCESS')).toBe(17)

    const wire = encodeTicketLogGroup([
      { uuid: 'p', action: 'PRINT_SUCCESS', payload: {}, time_stamp: 10 },
    ])
    expect(wire.logs[0]).toEqual({ u: 'p', a: 17, p: {} })
    expect(
      decodeTicketLogGroup('ticket', 'location', wire)[0]!.action,
    ).toBe('PRINT_SUCCESS')
  })

  it('maps PRINT_FAILED to wire id 21 and back (Phase 4)', () => {
    expect(TICKET_LOG_ACTION_IDS.PRINT_FAILED).toBe(21)
    expect(actionIdForTicketLog('PRINT_FAILED')).toBe(21)

    const wire = encodeTicketLogGroup([
      {
        uuid: 'f',
        action: 'PRINT_FAILED',
        payload: { device_id: 'dev-2', seq: 7 },
        time_stamp: 10,
      },
    ])
    expect(wire.logs[0]).toEqual({ u: 'f', a: 21, p: { device_id: 'dev-2', seq: 7 } })
    expect(
      decodeTicketLogGroup('ticket', 'location', wire)[0]!.action,
    ).toBe('PRINT_FAILED')
  })

  it('round-trips a manual takeover payload ({manual:true, device_id})', () => {
    // What manualTakeover appends: manual:true plus the acting device. The
    // peer's fold keys its printed/conflict state on `manual === true`, so a
    // lossy payload would turn a takeover into an AUTO_SUCCESS conflict.
    const wire = encodeTicketLogGroup([
      {
        uuid: 'manual',
        action: 'PRINT_SUCCESS',
        payload: { manual: true, device_id: 'dev-1' },
        time_stamp: 500,
        admin_uuid: 'admin-a',
      },
    ])
    expect(wire.logs[0]).toEqual({
      u: 'manual',
      a: 17,
      p: { manual: true, device_id: 'dev-1' },
    })
    expect(decodeTicketLogGroup('ticket', 'location', wire)[0]).toMatchObject({
      action: 'PRINT_SUCCESS',
      payload: { manual: true, device_id: 'dev-1' },
      time_stamp: 500,
      admin_uuid: 'admin-a',
    })
  })

  it('carries completed_at from the newest SET_STATUS_COMPLETE row', () => {
    const wire = encodeTicketLogGroup([
      {
        uuid: 'done',
        action: 'SET_STATUS_COMPLETE',
        payload: {},
        time_stamp: 300,
      },
      { uuid: 'print', action: 'PRINT_SUCCESS', payload: {}, time_stamp: 400 },
      {
        uuid: 'late',
        action: 'SET_STATUS_COMPLETE',
        payload: {},
        time_stamp: 350,
      },
    ])
    expect(wire.time_stamp).toBe(400)
    expect(wire.completed_at).toBe(350)

    // completed_at never stamps rows — row stamping stays on time_stamp.
    const decoded = decodeTicketLogGroup('ticket', 'location', wire)
    expect(decoded.every((row) => row.time_stamp === 400)).toBe(true)
    expect(decoded.every((row) => !('completed_at' in row))).toBe(true)

    // Never-completed groups omit the field entirely (compact wire).
    const open = encodeTicketLogGroup([
      { uuid: 'open', action: 'ADD_ITEM', payload: {}, time_stamp: 1 },
    ])
    expect(open).not.toHaveProperty('completed_at')
    expect(JSON.stringify(open)).not.toContain('completed_at')
  })
})

describe('server-authored rows (empty-string admin)', () => {
  it('the empty-string author survives the round-trip (item 5 regression)', () => {
    // The server's rows are read back with COALESCE(admin_uuid::text, '') —
    // the empty string IS the server's device id in the baton fold. A
    // truthiness check would drop it, and the peer would fold the server's own
    // announce as PASS_FROM_NON_HOLDER → conflict.
    const wire = encodeTicketLogGroup([
      { uuid: 's1', action: 'PRINT_PASS', payload: {}, time_stamp: 1000, admin_uuid: '' },
    ])
    expect(wire.admin_uuid).toEqual([''])

    const decoded = decodeTicketLogGroup('ticket', 'location', wire)
    expect(decoded[0]!.admin_uuid).toBe('')
  })

  it('a null/undefined author is still omitted', () => {
    const wire = encodeTicketLogGroup([
      { uuid: 's1', action: 'PRINT_PASS', payload: {}, time_stamp: 1000 },
    ])
    expect(wire.admin_uuid).toEqual([])
    const decoded = decodeTicketLogGroup('ticket', 'location', wire)
    expect(decoded[0]!.admin_uuid).toBeUndefined()
  })

  it('mixed authors keep their order and include the server', () => {
    const wire = encodeTicketLogGroup([
      { uuid: 'a', action: 'PRINT_PASS', payload: {}, time_stamp: 1000, admin_uuid: '' },
      { uuid: 'b', action: 'PRINT_REQUEST', payload: {}, time_stamp: 1100, admin_uuid: 'adm-1' },
      { uuid: 'c', action: 'PRINT_REASSIGN', payload: {}, time_stamp: 1200, admin_uuid: 'adm-1' },
    ])
    expect(wire.admin_uuid).toEqual(['', 'adm-1'])
  })
})

describe('per-row lifecycle times on the wire', () => {
  // The Start dashboard subtracts two of a ticket's own rows (acceptance lag,
  // ready-to-paid, time-to-paid). The wire stamps every row with the group's
  // newest time, which zeroes those on any device that received the ticket by
  // sync — while the authoring device keeps real per-row times.
  const lifecycle = [
    { uuid: 'c', action: 'SET_STATUS_COMPLETE', payload: {}, time_stamp: 1000 },
    { uuid: 'a', action: 'SET_STATUS_ACCEPTED', payload: {}, time_stamp: 5000 },
    { uuid: 'r', action: 'SET_STATUS_READY', payload: {}, time_stamp: 21000 },
    { uuid: 'p', action: 'SET_STATUS_PAID', payload: {}, time_stamp: 31000 },
    { uuid: 'i', action: 'ADD_ITEM', payload: {}, time_stamp: 500 },
  ]

  it('rides each lifecycle row\'s own time in its payload', () => {
    const wire = encodeTicketLogGroup(lifecycle)
    expect(wire.time_stamp).toBe(31000)
    const payloadOf = (u: string) =>
      (wire.logs.find((l) => l.u === u)!.p as Record<string, number>).timeStamp
    expect(payloadOf('c')).toBe(1000)
    expect(payloadOf('a')).toBe(5000)
    expect(payloadOf('r')).toBe(21000)
    expect(payloadOf('p')).toBe(31000)
  })

  it('leaves non-lifecycle payloads alone', () => {
    const wire = encodeTicketLogGroup(lifecycle)
    const item = wire.logs.find((l) => l.u === 'i')!
    expect(item.p).toEqual({})
  })

  it('round-trips: decode collapses the row time but rowTimeStamp recovers it', () => {
    const rows = decodeTicketLogGroup('t', 'lg', encodeTicketLogGroup(lifecycle))
    // The collapse is the wire's documented behaviour.
    expect(rows.every((r) => r.time_stamp === 31000)).toBe(true)
    const timeOf = (u: string) => rowTimeStamp(rows.find((r) => r.uuid === u)!)
    expect(timeOf('c')).toBe(1000)
    expect(timeOf('a')).toBe(5000)
    expect(timeOf('r')).toBe(21000)
    expect(timeOf('p')).toBe(31000)
    // A non-lifecycle row has nothing to recover — caller keeps the stamp.
    expect(timeOf('i')).toBeNull()
  })

  it('keeps an existing payload timeStamp instead of overwriting it', () => {
    const wire = encodeTicketLogGroup([
      {
        uuid: 'p',
        action: 'SET_STATUS_PAID',
        payload: { price_whole: 12, price_hundredths: 50, timeStamp: 4242 },
        time_stamp: 31000,
      },
    ])
    expect((wire.logs[0]!.p as Record<string, number>).timeStamp).toBe(4242)
  })

  it('recovers a real lag, not zero', () => {
    const rows = decodeTicketLogGroup('t', 'lg', encodeTicketLogGroup(lifecycle))
    const at = (action: string) => rowTimeStamp(rows.find((r) => r.action === action)!)!
    expect(at('SET_STATUS_PAID') - at('SET_STATUS_READY')).toBe(10000)
    expect(at('SET_STATUS_PAID') - at('SET_STATUS_COMPLETE')).toBe(30000)
    expect(at('SET_STATUS_ACCEPTED') - at('SET_STATUS_COMPLETE')).toBe(4000)
  })
})
