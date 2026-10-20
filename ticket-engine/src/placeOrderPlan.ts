/**
 * The Place Order decision — shared by the web ticket editor
 * (frontend AdminTicket.handlePlaceOrder) and the RN ticket editor
 * (rolonative AdminTickets.onPlaceOrder) so both clients place a ticket
 * identically:
 *
 * 1. A ticket that already knows its type places directly — no picker: the
 *    floor map's start-at-table plan writes SET_TABLE + SET_FULFILLMENT
 *    (EATIN) up front, and any earlier fulfillment pick counts too. A bound
 *    table with no fulfillment implies eat-in. NOTE: every fresh draft is
 *    inserted with the EATIN placeholder fulfillment_uuid — that placeholder
 *    is NOT a known type and must never bypass the picker.
 * 2. Nothing enabled and no tables → complete as-is.
 * 3. Exactly one enabled fulfillment → auto-pick it (eat-in with exactly one
 *    local table also auto-assigns that table).
 * 4. Otherwise → open the fulfillment/table picker (which completes the
 *    ticket after the pick when the caller set a pending-complete flag).
 *
 * This module only plans; each client executes the plan through its own
 * DB/sync layer (updateTicket / updateTicketTable / appendLog / runSync).
 */
import { FULFILLMENT_UUID_EATIN } from './floorSprites.js'

/** The three order-fulfillment features, in evaluation order: [feature uuid,
 *  fulfillment name]. Feature values are the server's Features enum uuids. */
export const PLACE_ORDER_FEATURES = [
  ['6ac646b5-b9bd-41ef-afe0-61e649de2e5d', 'DELIVERY'],
  ['66f53a6e-6794-4fb5-bcc3-992b60edcbfe', 'CURBSIDE'],
  ['0e97eefb-80ab-4185-b018-a96941b9f9d1', 'EATIN'],
] as const satisfies ReadonlyArray<readonly [string, PlaceOrderFulfillment]>

export type PlaceOrderFulfillment = 'DELIVERY' | 'CURBSIDE' | 'EATIN'

export type PlaceOrderPlan =
  /** Complete the ticket as-is (known type, or nothing to pick from). */
  | { kind: 'complete' }
  /** Set this fulfillment, then complete. */
  | { kind: 'set-fulfillment'; fulfillment: PlaceOrderFulfillment }
  /** Exactly one local table: assign it + EATIN, then complete. */
  | { kind: 'assign-single-table'; table_uuid: string }
  /** Unknown type with a choice to make: open the picker. */
  | { kind: 'pick' }

export interface PlaceOrderPlanInput {
  /** The location group's enabled features (Features enum values). */
  features: readonly string[]
  /** Local dining_table rows (for the single-table auto-assign). */
  tables: ReadonlyArray<{ uuid: string }>
  /** The ticket's bound table, if any. */
  tableUuid?: string | null
  /** The ticket's fulfillment_uuid, if any (EATIN may be the draft placeholder). */
  fulfillmentUuid?: string | null
  /** The ticket's resolved fulfillment_type, if any. */
  fulfillmentType?: string | null
}

export function planPlaceOrder(input: PlaceOrderPlanInput): PlaceOrderPlan {
  // Known type (set by the floor map or an earlier pick) → place directly.
  const knownFulfillment =
    !!input.fulfillmentUuid && input.fulfillmentUuid !== FULFILLMENT_UUID_EATIN
  if (knownFulfillment || input.tableUuid) {
    // A bound table with no fulfillment implies eat-in.
    if (!input.fulfillmentUuid && !input.fulfillmentType) {
      return { kind: 'set-fulfillment', fulfillment: 'EATIN' }
    }
    return { kind: 'complete' }
  }

  const enabled = PLACE_ORDER_FEATURES.filter(([featureUuid]) =>
    input.features.includes(featureUuid),
  ).map(([, fulfillment]) => fulfillment)
  const tableCount = input.tables.length

  if (enabled.length === 0 && tableCount === 0) {
    return { kind: 'complete' }
  }

  if (enabled.length === 1) {
    const only = enabled[0]
    if (only === 'EATIN') {
      if (tableCount === 1) {
        return { kind: 'assign-single-table', table_uuid: input.tables[0]!.uuid }
      }
      return { kind: 'set-fulfillment', fulfillment: 'EATIN' }
    }
    return { kind: 'set-fulfillment', fulfillment: only }
  }

  return { kind: 'pick' }
}
