// Reactive-query scope maps shared by both clients: which local tables a
// live query must re-run when ticket-log actions land (ticketChangeScope),
// and the canned table sets for full vs scoped views.

export const TICKET_VIEW_TABLES = [
  'ticket',
  'ticket_log',
  'ticket_payment',
  'ticket_promotion',
  'ticket_menu_item',
  'ticket_menu_item_modifier',
  'guest',
  'guest_address',
  'guest_location_group',
  'fulfillment',
  'menu_item',
  'menu_item_modifier_group',
  'modifier_group',
  'modifier_group_modifier',
  'modifier',
  'promotion',
  'bogo_menu_item',
  'dining_table',
  'combo',
  'combo_menu_item',
  'location_group',
] as const;

export const TICKET_SCOPED_CHANGE_TABLES = [
  'ticket',
  'ticket_log',
  'ticket_log_applied',
  'ticket_payment',
  'ticket_promotion',
  'ticket_menu_item',
  'ticket_menu_item_modifier',
] as const;

const ticketLocalActions = new Set([
  'SET_TABLE',
  'SET_FULFILLMENT',
  'SET_ANONYMOUS_ADDRESS',
  'ADD_ITEM',
  'REMOVE_ITEM',
  'SET_ITEM_NOTE',
  'ADD_MODIFIER',
  'REMOVE_MODIFIER',
  'APPLY_PROMOTION',
  'REMOVE_PROMOTION',
  'ADD_PAYMENT',
  'SET_STATUS_COMPLETE',
  'SET_STATUS_ACCEPTED',
  'SET_STATUS_READY',
  'SET_STATUS_PAID',
  'PRINT_SUCCESS',
  'PRINT_PASS',
  'PRINT_REQUEST',
  'PRINT_REASSIGN',
  'PRINT_FAILED',
]);

export const FLOOR_VIEW_TABLES = ['floor_room', 'floor_item'] as const;
export const DINING_TABLE_VIEW_TABLES = ['dining_table'] as const;
export const TICKET_LOG_VIEW_TABLES = ['ticket_log'] as const;
export const TICKET_STATUS_VIEW_TABLES = ['ticket'] as const;

export function ticketChangeScope(
  ticketUuids: readonly string[],
  actions: readonly string[],
): { tables: readonly string[]; ticketUuids?: readonly string[] } {
  const uniqueUuids = [...new Set(ticketUuids)];
  if (
    uniqueUuids.length > 0 &&
    uniqueUuids.length <= 500 &&
    actions.length > 0 &&
    actions.every((action) => ticketLocalActions.has(action))
  ) {
    return { tables: TICKET_SCOPED_CHANGE_TABLES, ticketUuids: uniqueUuids };
  }
  return { tables: TICKET_VIEW_TABLES };
}
