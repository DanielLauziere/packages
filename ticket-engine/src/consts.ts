// Cross-client sync constants. Single source of truth for the values both
// the web client and the RN app key ticket-sync behavior off
// (CORE-LOGIC-TICKET-LOGS.md — 36h cutoff, 30-minute active-cart window,
// server-clock offset meta key).

/** Cutoff: 36 hours — tickets whose newest log is older than this are pruned. */
export const CUTOFF_MS = 129600000;

/** Incomplete-ticket live window (30 minutes). */
export const THIRTY_MINUTES = 1800000;

/** key_value row holding the server-clock offset in ms (appendLog windows
 *  every minted log's time_stamp by it). */
export const SERVER_TIMESTAMP_OFFSET = 'server_timestamp_offset';
