import { describe, expect, it } from 'vitest'
import { FULFILLMENT_UUID_EATIN } from './floorSprites.js'
import { planPlaceOrder } from './placeOrderPlan.js'

describe('planPlaceOrder — known type places directly', () => {
  it('a table-bound ticket with a known fulfillment completes as-is', () => {
    expect(
      planPlaceOrder({
        tableUuid: 'tbl-1',
        fulfillmentUuid: 'fu-eatin',
        fulfillmentType: 'EATIN',
      }),
    ).toEqual({ kind: 'complete' })
  })

  it('a bound table without fulfillment implies eat-in', () => {
    expect(
      planPlaceOrder({
        tableUuid: 'tbl-1',
        fulfillmentUuid: null,
        fulfillmentType: null,
      }),
    ).toEqual({ kind: 'set-fulfillment', fulfillment: 'EATIN' })
  })

  it('a bound table carrying the EATIN placeholder completes with no extra write', () => {
    expect(
      planPlaceOrder({
        tableUuid: 'tbl-1',
        fulfillmentUuid: FULFILLMENT_UUID_EATIN,
        fulfillmentType: 'EATIN',
      }),
    ).toEqual({ kind: 'complete' })
  })

  it('a known non-table fulfillment (delivery/curbside) bypasses the picker', () => {
    expect(
      planPlaceOrder({
        tableUuid: null,
        fulfillmentUuid: 'fu-delivery',
        fulfillmentType: 'DELIVERY',
      }),
    ).toEqual({ kind: 'complete' })
  })
})

describe('planPlaceOrder — nothing set always opens the picker', () => {
  // The pick is what places the ticket, so no configuration may short-circuit
  // it: a single enabled fulfillment, a single table, or nothing enabled at
  // all still asks — the picker offers the choices and completes on selection.
  it('no table and no fulfillment → pick', () => {
    expect(
      planPlaceOrder({
        tableUuid: null,
        fulfillmentUuid: null,
        fulfillmentType: null,
      }),
    ).toEqual({ kind: 'pick' })
  })

  it('the fresh-draft EATIN placeholder is not a known type → pick', () => {
    /* Real drafts are INSERTed with fulfillment_uuid = EATIN (the placeholder)
       — that default must never count as a fulfillment pick. */
    expect(
      planPlaceOrder({
        tableUuid: null,
        fulfillmentUuid: FULFILLMENT_UUID_EATIN,
        fulfillmentType: 'EATIN',
      }),
    ).toEqual({ kind: 'pick' })
  })

  it('a bound table is the only thing that implies eat-in without a pick', () => {
    expect(planPlaceOrder({ tableUuid: 'tbl-1' })).toEqual({
      kind: 'set-fulfillment',
      fulfillment: 'EATIN',
    })
  })
})
