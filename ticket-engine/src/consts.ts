// Cross-client sync constants. Single source of truth for the values both
// the web client and the RN app key ticket-sync behavior off
// (CORE-LOGIC-TICKET-LOGS.md — 24h cutoff, 30-minute active-cart window,
// server-clock offset meta key).

/** Cutoff: 24 hours — tickets whose newest log is older than this are pruned. */
export const CUTOFF_MS = 86400000;

/** Incomplete-ticket live window (30 minutes). */
export const THIRTY_MINUTES = 1800000;

/** key_value row holding the server-clock offset in ms (appendLog windows
 *  every minted log's time_stamp by it). */
export const SERVER_TIMESTAMP_OFFSET = 'server_timestamp_offset';

/** Retry backoff: next_retry_at = now + min(retry_count + 1, CAP) × 10s.
 *  The cap keeps a log whose dependency arrives late (or never) from parking
 *  itself for unbounded minutes — the apply loop must stay hot enough to pick
 *  the dependency up within ~60s of it landing. Mirrored in SQL by the
 *  MIN(..., 6) in ticketLogLedger.applyLog and applyTicketLog.failLog. */
export const RETRY_BACKOFF_CAP_STEPS = 6;
