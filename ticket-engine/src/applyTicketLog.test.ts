import { describe, it, expect, beforeEach } from 'vitest'
import {
  applyTicketLog,
  applyLogsBatch,
  hasLogBeenApplied,
  handleAddPaymentLog,
  normalizePhone,
  type TicketLogEntry,
} from './applyTicketLog.js'
import type { DbAdapter } from './dbAdapter.js'

class MockAdapter implements DbAdapter {
  runs: { sql: string; params?: any[] }[] = []
  queries: { sql: string; params?: any[] }[] = []
  queryResults: Record<string, any[]> = {}

  onQuery(sql: string, results: any[]) {
    this.queryResults[sql] = results
  }

  run(sql: string, params?: any[]) {
    this.runs.push({ sql, params })
  }

  query(sql: string, params?: any[]): any[] {
    this.queries.push({ sql, params })
    const key = Object.keys(this.queryResults).find((k) => sql.includes(k))
    if (key) return this.queryResults[key]!
    return []
  }

  reset() {
    this.runs = []
    this.queries = []
    this.queryResults = {}
  }

  lastRun(): { sql: string; params?: any[] } {
    return this.runs[this.runs.length - 1]!
  }

  findRun(needle: string): { sql: string; params?: any[] } | undefined {
    return this.runs.find((r) => r.sql.includes(needle))
  }
}

function entry(overrides?: Partial<TicketLogEntry>): TicketLogEntry {
  return {
    uuid: 'log-001',
    ticketUuid: 'ticket-001',
    locationGroupUuid: 'lg-001',
    action: 'SET_TABLE',
    payload: {},
    timeStamp: 1700000000000,
    ...overrides,
  }
}


describe('normalizePhone', () => {
  it('strips non-digit characters', () => {
    expect(normalizePhone('(503) 555-1234', '503')).toBe('5035551234')
  })

  it('prepends country code when not present', () => {
    expect(normalizePhone('5551234', '503')).toBe('5035551234')
  })

  it('does not duplicate country code if already present', () => {
    expect(normalizePhone('5035551234', '503')).toBe('5035551234')
  })

  it('returns empty string for empty input', () => {
    expect(normalizePhone('', '503')).toBe('')
  })

  it('returns empty string for input with no digits', () => {
    expect(normalizePhone('abc', '503')).toBe('')
  })
})

describe('hasLogBeenApplied', () => {
  it('returns true when query returns a row', () => {
    const adapter = new MockAdapter()
    adapter.onQuery('SELECT 1 FROM ticketLogApplied', [{ uuid: 'x' }])
    expect(hasLogBeenApplied(adapter, 'some-uuid')).toBe(true)
  })

  it('returns false when query returns empty', () => {
    const adapter = new MockAdapter()
    expect(hasLogBeenApplied(adapter, 'some-uuid')).toBe(false)
  })
})

describe('handleAddPaymentLog', () => {
  let adapter: MockAdapter

  beforeEach(() => {
    adapter = new MockAdapter()
  })

  it('inserts ticket payment when payment exists', () => {
    adapter.onQuery('SELECT 1 FROM payment', [{ uuid: 'pay-001' }])
    handleAddPaymentLog(adapter, entry(), {
      paymentUuid: 'pay-001',
      priceWhole: 10,
      priceHundredths: 50,
      code: 'CASH',
      complete: true,
    })
    const ins = adapter.findRun('INSERT INTO "ticketPayment"')
    expect(ins).toBeDefined()
    expect(ins!.params).toContain('pay-001')
    expect(ins!.params).toContain(10)
    expect(ins!.params).toContain(50)
    expect(ins!.params).toContain('CASH')
  })

  it('skips insert if ticketPayment already exists', () => {
    adapter.onQuery('SELECT 1 FROM "ticketPayment"', [{ uuid: 'tp-001' }])
    handleAddPaymentLog(adapter, entry(), {
      paymentUuid: 'pay-001',
      priceWhole: 10,
      priceHundredths: 0,
      complete: false,
    })
    const ins = adapter.findRun('INSERT INTO "ticketPayment"')
    expect(ins).toBeUndefined()
  })

  it('throws MISSING_DEPENDENCY when payment not found', () => {
    adapter.onQuery('SELECT 1 FROM payment', [])
    expect(() =>
      handleAddPaymentLog(adapter, entry(), {
        paymentUuid: 'pay-missing',
        priceWhole: 10,
        priceHundredths: 0,
        complete: false,
      }),
    ).toThrow('MISSING_DEPENDENCY')
  })

  it('inserts payment without optional code', () => {
    adapter.onQuery('SELECT 1 FROM payment', [{ uuid: 'pay-001' }])
    handleAddPaymentLog(adapter, entry(), {
      paymentUuid: 'pay-001',
      priceWhole: 5,
      priceHundredths: 0,
      complete: true,
    })
    const ins = adapter.findRun('INSERT INTO "ticketPayment"')
    expect(ins!.params).toContain(null)
    expect(ins!.params).toContain(1)
  })

  it('ensures ticket exists before inserting payment', () => {
    adapter.onQuery('SELECT 1 FROM payment', [{ uuid: 'pay-001' }])
    handleAddPaymentLog(adapter, entry(), {
      paymentUuid: 'pay-001',
      priceWhole: 10,
      priceHundredths: 0,
      complete: true,
    })
    const ticketInsert = adapter.findRun('INSERT INTO "ticket"')
    expect(ticketInsert).toBeDefined()
  })
})

describe('applyTicketLog', () => {
  let adapter: MockAdapter

  beforeEach(() => {
    adapter = new MockAdapter()
  })

  describe('SET_TABLE', () => {
    it('ensures ticket exists and updates tableUuid', () => {
      adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
      adapter.onQuery('SELECT 1 FROM "table"', [{ uuid: 'table-001' }])
      applyTicketLog(adapter, entry({ payload: { tableUuid: 'table-001' } }))
      const update = adapter.findRun('UPDATE "ticket" SET "tableUuid"')
      expect(update).toBeDefined()
      expect(update!.params).toContain('table-001')
    })

    it('throws MISSING_DEPENDENCY when table uuid not found', () => {
      adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
      expect(() =>
        applyTicketLog(adapter, entry({ payload: { tableUuid: 'missing-table' } })),
      ).toThrow('MISSING_DEPENDENCY')
    })
  })

  describe('SET_GUEST', () => {
    it('creates guest with email when @ in username', () => {
      adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
      adapter.onQuery('SELECT uuid FROM guest', [{ uuid: 'guest-001' }])
      applyTicketLog(adapter, entry({ action: 'SET_GUEST', payload: { guestUserName: 'user@example.com' } }))
      const update = adapter.findRun('UPDATE ticket SET "guestUuid"')
      expect(update).toBeDefined()
      expect(update!.params).toContain('guest-001')
    })

    it('normalizes phone when digits in username', () => {
      adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
      adapter.onQuery('SELECT c."phonecode"', [{ phoneCode: '503' }])
      adapter.onQuery('SELECT uuid FROM guest', [{ uuid: 'guest-001' }])
      applyTicketLog(adapter, entry({ action: 'SET_GUEST', payload: { guestUserName: '5551234' } }))
      const insert = adapter.findRun('INSERT INTO guest')
      expect(insert).toBeDefined()
      expect(insert!.params).toContain('5035551234')
    })

    it('does nothing when guestUserName is empty', () => {
      applyTicketLog(adapter, entry({ action: 'SET_GUEST', payload: { guestUserName: '' } }))
      expect(adapter.runs.length).toBe(0)
    })

    it('falls back to country code 503 when no locationGroup found', () => {
      adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
      adapter.onQuery('SELECT uuid FROM guest', [{ uuid: 'guest-001' }])
      applyTicketLog(adapter, entry({ action: 'SET_GUEST', payload: { guestUserName: '5551234' } }))
      const insert = adapter.findRun('INSERT INTO guest')
      expect(insert!.params).toContain('5035551234')
    })
  })

  describe('SET_FULFILLMENT', () => {
    it('ensures ticket exists and updates fulfillmentUuid', () => {
      adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
      adapter.onQuery('SELECT 1 FROM fulfillment', [{ uuid: 'ful-001' }])
      applyTicketLog(adapter, entry({ action: 'SET_FULFILLMENT', payload: { fulfillmentUuid: 'ful-001' } }))
      const update = adapter.findRun('UPDATE ticket SET "fulfillmentUuid"')
      expect(update).toBeDefined()
      expect(update!.params).toContain('ful-001')
    })

    it('throws MISSING_DEPENDENCY when fulfillment not found', () => {
      adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
      expect(() =>
        applyTicketLog(adapter, entry({ action: 'SET_FULFILLMENT', payload: { fulfillmentUuid: 'missing' } })),
      ).toThrow('MISSING_DEPENDENCY')
    })
  })

  describe('SET_ANONYMOUS_ADDRESS', () => {
    it('updates anonymous address', () => {
      adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
      applyTicketLog(adapter, entry({ action: 'SET_ANONYMOUS_ADDRESS', payload: { address: '123 Main St' } }))
      const update = adapter.findRun('UPDATE "ticket" SET "anonymousAddress"')
      expect(update).toBeDefined()
      expect(update!.params).toContain('123 Main St')
    })
  })

  describe('ADD_ITEM', () => {
    it('inserts ticket menu item when menuItem exists', () => {
      adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
      adapter.onQuery('SELECT 1 FROM menuItem', [{ uuid: 'mi-001' }])
      applyTicketLog(adapter, entry({ action: 'ADD_ITEM', payload: { menuItemUuid: 'mi-001' } }))
      const insert = adapter.findRun('INSERT OR IGNORE INTO ticketMenuItem')
      expect(insert).toBeDefined()
      expect(insert!.params).toContain('mi-001')
    })

    it('throws MISSING_DEPENDENCY when menuItem not found', () => {
      adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
      expect(() =>
        applyTicketLog(adapter, entry({ action: 'ADD_ITEM', payload: { menuItemUuid: 'missing' } })),
      ).toThrow('MISSING_DEPENDENCY')
    })
  })

  describe('REMOVE_ITEM', () => {
    it('deletes ticketMenuItem and cascades', () => {
      adapter.onQuery('SELECT 1 FROM ticketMenuItem', [{ uuid: 'tmi-001' }])
      applyTicketLog(adapter, entry({ action: 'REMOVE_ITEM', payload: { ticketMenuItemUuid: 'tmi-001' } }))
      expect(adapter.findRun('DELETE FROM "ticketMenuItemModifier"')).toBeDefined()
      expect(adapter.findRun('DELETE FROM "ticketPromotion"')).toBeDefined()
      expect(adapter.findRun('DELETE FROM "ticketMenuItem" WHERE uuid')).toBeDefined()
    })

    it('no-ops when ticketMenuItem not found', () => {
      applyTicketLog(adapter, entry({ action: 'REMOVE_ITEM', payload: { ticketMenuItemUuid: 'missing' } }))
      expect(adapter.runs.length).toBe(0)
    })
  })

  describe('SET_ITEM_NOTE', () => {
    it('updates note when ticketMenuItem exists', () => {
      adapter.onQuery('SELECT 1 FROM ticketMenuItem', [{ uuid: 'tmi-001' }])
      applyTicketLog(adapter, entry({ action: 'SET_ITEM_NOTE', payload: { ticketMenuItemUuid: 'tmi-001', note: 'no onions' } }))
      const update = adapter.findRun('UPDATE ticketMenuItem SET note')
      expect(update).toBeDefined()
      expect(update!.params).toContain('no onions')
    })

    it('throws MISSING_DEPENDENCY when ticketMenuItem not found', () => {
      expect(() =>
        applyTicketLog(adapter, entry({ action: 'SET_ITEM_NOTE', payload: { ticketMenuItemUuid: 'missing', note: 'x' } })),
      ).toThrow('MISSING_DEPENDENCY')
    })
  })

  describe('ADD_MODIFIER', () => {
    it('inserts modifier when dependencies exist', () => {
      adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
      adapter.onQuery('SELECT 1 FROM ticketMenuItem', [{ uuid: 'tmi-001' }])
      adapter.onQuery('SELECT 1 FROM modifier', [{ uuid: 'mod-001' }])
      applyTicketLog(adapter, entry({ action: 'ADD_MODIFIER', payload: { ticketMenuItemUuid: 'tmi-001', modifierUuid: 'mod-001' } }))
      const insert = adapter.findRun('INSERT OR IGNORE INTO "ticketMenuItemModifier"')
      expect(insert).toBeDefined()
      expect(insert!.params).toContain('tmi-001')
      expect(insert!.params).toContain('mod-001')
    })

    it('throws when ticketMenuItem missing', () => {
      adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
      expect(() =>
        applyTicketLog(adapter, entry({ action: 'ADD_MODIFIER', payload: { ticketMenuItemUuid: 'missing', modifierUuid: 'mod-001' } })),
      ).toThrow('MISSING_DEPENDENCY')
    })

    it('throws when modifier missing', () => {
      adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
      adapter.onQuery('SELECT 1 FROM ticketMenuItem', [{ uuid: 'tmi-001' }])
      expect(() =>
        applyTicketLog(adapter, entry({ action: 'ADD_MODIFIER', payload: { ticketMenuItemUuid: 'tmi-001', modifierUuid: 'missing' } })),
      ).toThrow('MISSING_DEPENDENCY')
    })
  })

  describe('REMOVE_MODIFIER', () => {
    it('deletes ticketMenuItemModifier', () => {
      adapter.onQuery('SELECT 1 FROM ticketMenuItemModifier', [{ uuid: 'tmm-001' }])
      applyTicketLog(adapter, entry({ action: 'REMOVE_MODIFIER', payload: { ticketMenuItemModifierUuid: 'tmm-001' } }))
      const del = adapter.findRun('DELETE FROM "ticketMenuItemModifier"')
      expect(del).toBeDefined()
      expect(del!.params).toContain('tmm-001')
    })

    it('no-ops when modifier not found', () => {
      applyTicketLog(adapter, entry({ action: 'REMOVE_MODIFIER', payload: { ticketMenuItemModifierUuid: 'missing' } }))
      expect(adapter.runs.length).toBe(0)
    })
  })

  describe('APPLY_PROMOTION', () => {
    it('inserts item-level promotion and replaces existing', () => {
      adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
      adapter.onQuery('SELECT 1 FROM ticketMenuItem', [{ uuid: 'tmi-001' }])
      adapter.onQuery('SELECT 1 FROM promotion', [{ uuid: 'promo-001' }])
      applyTicketLog(adapter, entry({ action: 'APPLY_PROMOTION', payload: { promotionUuid: 'promo-001', ticketMenuItemUuid: 'tmi-001' } }))
      const del = adapter.findRun('DELETE FROM "ticketPromotion" WHERE "ticketUuid"')
      expect(del).toBeDefined()
      expect(del!.params).toContain('tmi-001')
      const insert = adapter.findRun('INSERT OR IGNORE INTO "ticketPromotion"')
      expect(insert).toBeDefined()
    })

    it('skips duplicate itemless promotion', () => {
      adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
      adapter.onQuery('SELECT 1 FROM promotion', [{ uuid: 'promo-001' }])
      adapter.onQuery('SELECT uuid FROM "ticketPromotion"', [{ uuid: 'existing-tp' }])
      applyTicketLog(adapter, entry({ action: 'APPLY_PROMOTION', payload: { promotionUuid: 'promo-001' } }))
      const insert = adapter.findRun('INSERT OR IGNORE INTO "ticketPromotion"')
      expect(insert).toBeUndefined()
    })

    it('throws when promotion not found', () => {
      adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
      expect(() =>
        applyTicketLog(adapter, entry({ action: 'APPLY_PROMOTION', payload: { promotionUuid: 'missing' } })),
      ).toThrow('MISSING_DEPENDENCY')
    })
  })

  describe('REMOVE_PROMOTION', () => {
    it('deletes ticketPromotion', () => {
      adapter.onQuery('SELECT 1 FROM promotion', [{ uuid: 'promo-001' }])
      applyTicketLog(adapter, entry({ action: 'REMOVE_PROMOTION', payload: { promotionUuid: 'promo-001' } }))
      const del = adapter.findRun('DELETE FROM "ticketPromotion"')
      expect(del).toBeDefined()
      expect(del!.params).toContain('promo-001')
    })

    it('throws when promotion not found', () => {
      expect(() =>
        applyTicketLog(adapter, entry({ action: 'REMOVE_PROMOTION', payload: { promotionUuid: 'missing' } })),
      ).toThrow('MISSING_DEPENDENCY')
    })
  })

  describe('ADD_PAYMENT', () => {
    it('delegates to handleAddPaymentLog', () => {
      adapter.onQuery('SELECT 1 FROM payment', [{ uuid: 'pay-001' }])
      applyTicketLog(adapter, entry({ action: 'ADD_PAYMENT', payload: { paymentUuid: 'pay-001', priceWhole: 10, priceHundredths: 0, complete: true } }))
      const insert = adapter.findRun('INSERT INTO "ticketPayment"')
      expect(insert).toBeDefined()
    })
  })

  describe('SET_STATUS', () => {
    it('SET_STATUS_COMPLETE updates status', () => {
      adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
      applyTicketLog(adapter, entry({ action: 'SET_STATUS_COMPLETE' }))
      const update = adapter.findRun("SET status = 'COMPLETE'")
      expect(update).toBeDefined()
    })

    it('SET_STATUS_ACCEPTED updates status', () => {
      adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
      applyTicketLog(adapter, entry({ action: 'SET_STATUS_ACCEPTED' }))
      const update = adapter.findRun("SET status = 'ACCEPTED'")
      expect(update).toBeDefined()
    })

    it('SET_STATUS_PAID updates status', () => {
      adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
      applyTicketLog(adapter, entry({ action: 'SET_STATUS_PAID' }))
      const update = adapter.findRun("SET status = 'PAID'")
      expect(update).toBeDefined()
    })
  })

  describe('unknown action', () => {
    it('does nothing for unknown action', () => {
      applyTicketLog(adapter, entry({ action: 'UNKNOWN_ACTION' }))
      expect(adapter.runs.length).toBe(0)
    })
  })
})

describe('applyLogsBatch', () => {
  let adapter: MockAdapter

  beforeEach(() => {
    adapter = new MockAdapter()
  })

  it('returns zeros for empty logs', () => {
    const result = applyLogsBatch(adapter, [])
    expect(result).toEqual({ applied: 0, skipped: 0, errors: [] })
  })

  it('applies sorted logs in priority order', () => {
    adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
    adapter.onQuery('SELECT 1 FROM menuItem', [{ uuid: 'mi-001' }])
    adapter.onQuery('SELECT 1 FROM payment', [{ uuid: 'pay-001' }])
    const logs: TicketLogEntry[] = [
      { uuid: 'log-3', ticketUuid: 'ticket-001', locationGroupUuid: 'lg-001', action: 'ADD_ITEM', payload: { menuItemUuid: 'mi-001' }, timeStamp: 1 },
      { uuid: 'log-1', ticketUuid: 'ticket-001', locationGroupUuid: 'lg-001', action: 'SET_TABLE', payload: { tableUuid: 'table-001' }, timeStamp: 2 },
      { uuid: 'log-5', ticketUuid: 'ticket-001', locationGroupUuid: 'lg-001', action: 'ADD_PAYMENT', payload: { paymentUuid: 'pay-001', priceWhole: 10, priceHundredths: 0, complete: true }, timeStamp: 3 },
    ]
    adapter.onQuery('SELECT 1 FROM "table"', [{ uuid: 'table-001' }])
    const result = applyLogsBatch(adapter, logs)
    expect(result.applied).toBe(3)
    expect(result.skipped).toBe(0)
    expect(result.errors).toHaveLength(0)
  })

  it('skips already-applied logs', () => {
    adapter.onQuery('SELECT 1 FROM ticketLogApplied', [{ uuid: 'log-001' }])
    const result = applyLogsBatch(adapter, [entry()])
    // hasLogBeenApplied returns true → skipped
    expect(result.applied).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it('skips logs that throw MISSING_DEPENDENCY', () => {
    adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
    const result = applyLogsBatch(adapter, [entry({ payload: { tableUuid: 'missing-table' } })])
    expect(result.applied).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it('catches errors and returns them', () => {
    adapter.onQuery('SELECT uuid FROM ticket', [{ uuid: 'ticket-001' }])
    // Force a non-MISSING_DEPENDENCY error by having adapter.query throw
    adapter.query = () => { throw new Error('DB_ERROR') }
    const result = applyLogsBatch(adapter, [entry()])
    expect(result.applied).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.entry.uuid).toBe('log-001')
  })
})
