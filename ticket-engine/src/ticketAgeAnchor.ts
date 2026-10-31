/**
 * Age-badge anchor (CORE-LOGIC-TICKET-LOGS Flow 5) — one rule, shared by the
 * RN app and the web client: the badge on a completed ticket counts from its
 * newest SET_STATUS_COMPLETE's `p.timeStamp`, and a ticket that has never
 * completed counts from its first log (creation).
 *
 * Why the payload, not the row's `time_stamp`: the compact ticket-log wire
 * carries no per-row timestamp (`CompactTicketLog` is `{u, a, p}` only), so a
 * decoder stamps every row with the group's last-adjustment time. After a
 * logout → login the device's DB is wiped and rebuilt purely from the wire —
 * the row `time_stamp` of a SET_STATUS_COMPLETE row is then meaningless, and
 * the badge reads "0 minutes" for everything. The completion time must ride
 * the payload: `encodeTicketLogGroup` backfills `p.timeStamp` from the row's
 * own (correct, pre-wire) time, and this query reads it back with
 * `json_extract`. `json_extract` is inside the SQLite 3.39.4 dialect floor —
 * the engine's own apply SQL already depends on it.
 *
 * Legacy rows (no `p.timeStamp` yet) fall back to their stored `time_stamp`,
 * which is the best value available for rows created before this field.
 */
export const TICKET_AGE_ANCHOR_SQL = `
  SELECT COALESCE(
    MAX(CASE WHEN "action" = 'SET_STATUS_COMPLETE'
             THEN COALESCE(json_extract("payload", '$.timeStamp'), "time_stamp") END),
    MIN("time_stamp")
  ) AS "time_stamp"
  FROM "ticket_log" WHERE "ticket_uuid" = ?
`
