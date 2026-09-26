import { describe, it, expect } from 'vitest'
import {
  getPlanLabel,
  getActivePriceOnDate,
  generateMonthlyInvoices,
  buildTimeline,
  centsToDollar,
} from './billing.js'
import type { BillingResponse, PlanChange } from './billing.js'

const labels = {
  planActivated: 'plan activated',
  paymentReceived: 'Payment received',
  chargeMade: 'Charge made',
  invoiceFor: 'Invoice for',
  mo: 'mo',
}

function planChange(priceCents: number, effectiveAt: string): PlanChange {
  return {
    uuid: '00000000-0000-0000-0000-000000000001',
    location_group_uuid: '00000000-0000-0000-0000-000000000002',
    new_monthly_price_cents: priceCents,
    effective_at: effectiveAt,
  }
}

describe('getPlanLabel', () => {
  it('buckets standard plan prices', () => {
    expect(getPlanLabel(1499, 'en')).toBe('Starter')
    expect(getPlanLabel(1500, 'en')).toBe('Restaurant')
    expect(getPlanLabel(3999, 'en')).toBe('Restaurant')
    expect(getPlanLabel(4000, 'en')).toBe('Enterprise')
    expect(getPlanLabel(9999, 'es')).toBe('Empresarial')
  })

  it('returns No plan for zero or negative cents', () => {
    expect(getPlanLabel(0, 'en')).toBe('No plan')
    expect(getPlanLabel(-1, 'en')).toBe('No plan')
    expect(getPlanLabel(0, 'es')).toBe('Sin plan')
  })

  it('keeps custom super-admin prices in the bucketed label', () => {
    expect(getPlanLabel(2500, 'en')).toBe('Restaurant')
    expect(getPlanLabel(5000, 'en')).toBe('Enterprise')
  })
})

describe('getActivePriceOnDate', () => {
  it('applies the most recent plan change on or before the date', () => {
    const changes = [planChange(3999, '2026-01-01T00:00:00Z'), planChange(0, '2026-06-01T00:00:00Z')]
    expect(getActivePriceOnDate(changes, new Date('2025-12-31T23:59:59Z'))).toBe(1499)
    expect(getActivePriceOnDate(changes, new Date('2026-03-15T00:00:00Z'))).toBe(3999)
    expect(getActivePriceOnDate(changes, new Date('2026-07-01T00:00:00Z'))).toBe(0)
  })
})

describe('generateMonthlyInvoices', () => {
  it('returns no invoices when billing never started', () => {
    expect(generateMonthlyInvoices([], [], 'en', 'Invoice for', 'mo')).toEqual([])
  })

  it('returns no invoices for months where the price is zero', () => {
    const changes = [planChange(0, '2026-01-01T00:00:00Z')]
    expect(generateMonthlyInvoices(changes, [], 'en', 'Invoice for', 'mo')).toEqual([])
  })

  it('generates invoices while a price is active', () => {
    const changes = [planChange(1499, '2026-01-01T00:00:00Z')]
    const invoices = generateMonthlyInvoices(changes, [], 'en', 'Invoice for', 'mo')
    expect(invoices.length).toBeGreaterThan(0)
    expect(invoices.every((e) => e.type === 'invoice')).toBe(true)
    expect(invoices[0]?.description).toContain('Starter')
  })
})

describe('buildTimeline', () => {
  it('describes a plan change with plan name and exact price', () => {
    const billing: BillingResponse = {
      current_plan: 'restaurant',
      current_price_cents: 3999,
      balance_cents: 0,
      plan_changes: [planChange(3999, '2026-01-01T00:00:00Z')],
      balances: [],
    }
    const events = buildTimeline(billing, 'en', labels)
    const planEvent = events.find((e) => e.type === 'plan_change')
    expect(planEvent?.description).toBe('Restaurant plan activated ($39.99/mo)')
    expect(planEvent?.amountCents).toBe(3999)
  })

  it('describes zero cents as billing stopped', () => {
    const billing: BillingResponse = {
      current_plan: 'none',
      current_price_cents: 0,
      balance_cents: 0,
      plan_changes: [planChange(0, '2026-06-01T00:00:00Z')],
      balances: [],
    }
    const en = buildTimeline(billing, 'en', labels)
    expect(en.find((e) => e.type === 'plan_change')?.description).toBe('Billing stopped ($0.00/mo)')
    const es = buildTimeline(billing, 'es', labels)
    expect(es.find((e) => e.type === 'plan_change')?.description).toBe('Facturación detenida ($0.00/mo)')
  })

  it('shows arbitrary super-admin prices exactly', () => {
    const billing: BillingResponse = {
      current_plan: 'restaurant',
      current_price_cents: 2500,
      balance_cents: 0,
      plan_changes: [planChange(2500, '2026-01-01T00:00:00Z')],
      balances: [],
    }
    const events = buildTimeline(billing, 'en', labels)
    const planEvent = events.find((e) => e.type === 'plan_change')
    expect(planEvent?.description).toBe('Restaurant plan activated ($25.00/mo)')
    expect(centsToDollar(planEvent?.amountCents ?? 0)).toBe('$25.00')
  })

  it('sorts plan changes, invoices, and payments chronologically', () => {
    const billing: BillingResponse = {
      current_plan: 'starter',
      current_price_cents: 1499,
      balance_cents: 1499,
      plan_changes: [planChange(1499, '2026-02-01T00:00:00Z')],
      balances: [
        {
          balance_hundredths: 0,
          balance_whole: 20,
          add: true,
          location_group_uuid: '00000000-0000-0000-0000-000000000002',
          time_stamp: '2026-01-15T00:00:00Z',
          uuid: '00000000-0000-0000-0000-000000000003',
        },
      ],
    }
    const events = buildTimeline(billing, 'en', labels)
    const times = events.map((e) => e.date.getTime())
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    expect(events.some((e) => e.type === 'payment')).toBe(true)
    expect(events.some((e) => e.type === 'plan_change')).toBe(true)
  })
})
