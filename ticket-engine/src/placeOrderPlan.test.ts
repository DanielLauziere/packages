import { describe, expect, it } from 'vitest'
import { FULFILLMENT_UUID_EATIN } from './floorSprites.js'
import { planPlaceOrder } from './placeOrderPlan.js'

const FEATURE_EATIN = '0e97eefb-80ab-4185-b018-a96941b9f9d1'
const FEATURE_DELIVERY = '6ac646b5-b9bd-41ef-afe0-61e649de2e5d'
const FEATURE_CURBSIDE = '66f53a6e-6794-4fb5-bcc3-992b60edcbfe'

const TABLES_ONE = [{ uuid: 'tbl-1' }]
const TABLES_TWO = [
  { uuid: 'tbl-1' },
  { uuid: 'tbl-2' },
]

describe('planPlaceOrder — known type places directly', () => {
  it('a table-bound ticket with a known fulfillment completes as-is', () => {
    expect(
      planPlaceOrder({
        features: [FEATURE_EATIN],
        tables: TABLES_ONE,
        tableUuid: 'tbl-1',
        fulfillmentUuid: 'fu-eatin',
        fulfillmentType: 'EATIN',
      }),
    ).toEqual({ kind: 'complete' })
  })

  it('a bound table without fulfillment implies eat-in', () => {
    expect(
      planPlaceOrder({
        features: [FEATURE_EATIN],
        tables: TABLES_ONE,
        tableUuid: 'tbl-1',
        fulfillmentUuid: null,
        fulfillmentType: null,
      }),
    ).toEqual({ kind: 'set-fulfillment', fulfillment: 'EATIN' })
  })

  it('a bound table carrying the EATIN placeholder completes with no extra write', () => {
    expect(
      planPlaceOrder({
        features: [FEATURE_EATIN],
        tables: TABLES_ONE,
        tableUuid: 'tbl-1',
        fulfillmentUuid: FULFILLMENT_UUID_EATIN,
        fulfillmentType: 'EATIN',
      }),
    ).toEqual({ kind: 'complete' })
  })

  it('a known non-table fulfillment (delivery/curbside) bypasses the picker', () => {
    expect(
      planPlaceOrder({
        features: [FEATURE_EATIN, FEATURE_DELIVERY],
        tables: TABLES_TWO,
        fulfillmentUuid: 'fu-delivery',
        fulfillmentType: 'DELIVERY',
      }),
    ).toEqual({ kind: 'complete' })
  })
})

describe('planPlaceOrder — the fresh-draft EATIN placeholder never bypasses', () => {
  it('still opens the picker when neither table nor fulfillment is known', () => {
    expect(
      planPlaceOrder({
        features: [FEATURE_EATIN, FEATURE_DELIVERY],
        tables: TABLES_TWO,
        tableUuid: null,
        fulfillmentUuid: null,
        fulfillmentType: null,
      }),
    ).toEqual({ kind: 'pick' })
  })

  it('the placeholder alone still opens the picker', () => {
    expect(
      planPlaceOrder({
        features: [FEATURE_EATIN, FEATURE_DELIVERY],
        tables: TABLES_TWO,
        tableUuid: null,
        fulfillmentUuid: FULFILLMENT_UUID_EATIN,
        fulfillmentType: 'EATIN',
      }),
    ).toEqual({ kind: 'pick' })
  })
})

describe('planPlaceOrder — single-feature auto-picks', () => {
  it('eat-in with exactly one table auto-assigns the table', () => {
    expect(
      planPlaceOrder({
        features: [FEATURE_EATIN],
        tables: TABLES_ONE,
        tableUuid: null,
        fulfillmentUuid: null,
        fulfillmentType: null,
      }),
    ).toEqual({ kind: 'assign-single-table', table_uuid: 'tbl-1' })
  })

  it('eat-in with multiple tables auto-sets eat-in without a table', () => {
    expect(
      planPlaceOrder({
        features: [FEATURE_EATIN],
        tables: TABLES_TWO,
        tableUuid: null,
        fulfillmentUuid: null,
        fulfillmentType: null,
      }),
    ).toEqual({ kind: 'set-fulfillment', fulfillment: 'EATIN' })
  })

  it('eat-in with no tables auto-sets eat-in', () => {
    expect(
      planPlaceOrder({
        features: [FEATURE_EATIN],
        tables: [],
        tableUuid: null,
        fulfillmentUuid: null,
        fulfillmentType: null,
      }),
    ).toEqual({ kind: 'set-fulfillment', fulfillment: 'EATIN' })
  })

  it('delivery-only sets delivery', () => {
    expect(
      planPlaceOrder({
        features: [FEATURE_DELIVERY],
        tables: TABLES_TWO,
        tableUuid: null,
        fulfillmentUuid: null,
        fulfillmentType: null,
      }),
    ).toEqual({ kind: 'set-fulfillment', fulfillment: 'DELIVERY' })
  })

  it('curbside-only sets curbside', () => {
    expect(
      planPlaceOrder({
        features: [FEATURE_CURBSIDE],
        tables: [],
        tableUuid: null,
        fulfillmentUuid: null,
        fulfillmentType: null,
      }),
    ).toEqual({ kind: 'set-fulfillment', fulfillment: 'CURBSIDE' })
  })
})

describe('planPlaceOrder — everything else opens the picker', () => {
  it('multiple enabled features → pick', () => {
    expect(
      planPlaceOrder({
        features: [FEATURE_EATIN, FEATURE_DELIVERY],
        tables: TABLES_TWO,
        tableUuid: null,
        fulfillmentUuid: null,
        fulfillmentType: null,
      }),
    ).toEqual({ kind: 'pick' })
  })

  it('no features but tables to sit at → pick', () => {
    expect(
      planPlaceOrder({
        features: [],
        tables: TABLES_TWO,
        tableUuid: null,
        fulfillmentUuid: null,
        fulfillmentType: null,
      }),
    ).toEqual({ kind: 'pick' })
  })

  it('nothing enabled and no tables → complete as-is', () => {
    expect(
      planPlaceOrder({
        features: [],
        tables: [],
        tableUuid: null,
        fulfillmentUuid: null,
        fulfillmentType: null,
      }),
    ).toEqual({ kind: 'complete' })
  })
})
