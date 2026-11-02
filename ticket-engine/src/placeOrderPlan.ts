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
 * 2. Anything else opens the fulfillment/table picker — always, even when a
 *    single fulfillment is enabled or nothing is enabled at all. Nothing is
 *    set until staff picks, and the picker completes the ticket after the
 *    pick (the caller sets a pending-complete flag).
 *
 * This module only plans; each client executes the plan through its own
 * DB/sync layer (updateTicket / appendLog / runSync).
 */
import { FULFILLMENT_UUID_EATIN } from './floorSprites.js'

export type PlaceOrderFulfillment = 'DELIVERY' | 'CURBSIDE' | 'EATIN'

export type PlaceOrderPlan =
  /** Complete the ticket as-is (known type). */
  | { kind: 'complete' }
  /** Set this fulfillment, then complete. */
  | { kind: 'set-fulfillment'; fulfillment: PlaceOrderFulfillment }
  /** Nothing set yet: open the picker, which completes after the pick. */
  | { kind: 'pick' }

export interface PlaceOrderPlanInput {
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

  // Nothing set yet → always ask. The pick is what places the ticket, so even
  // a single enabled fulfillment (or none at all) goes through the picker.
  return { kind: 'pick' }
}
