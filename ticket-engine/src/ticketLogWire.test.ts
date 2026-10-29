import { describe, expect, it } from 'vitest'

import {
  TICKET_LOG_ACTION_IDS,
  decodeTicketLogBuckets,
  decodeTicketLogGroup,
  encodeTicketLogBuckets,
  encodeTicketLogGroup,
  type TicketLogWireInput,
} from './ticketLogWire.js'

describe('compact ticket-log wire protocol', () => {
  it('uses the stable action IDs, including the menu-item wire aliases', () => {
    expect(TICKET_LOG_ACTION_IDS.ADD_MENU_ITEM).toBe(1)
    expect(TICKET_LOG_ACTION_IDS.REMOVE_MENU_ITEM).toBe(2)
    expect(TICKET_LOG_ACTION_IDS.PRINT_REASSIGN).toBe(20)

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
