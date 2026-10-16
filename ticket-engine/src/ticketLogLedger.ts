/**
 * The ticket-log ledger: mint → insert → apply → mark (CORE-LOGIC-TICKET-LOGS.md
 * Flow 1 and section 2d). Single implementation shared by the web client and
 * the RN app — both previously kept drifted copies.
 *
 * Everything touching the DB, the clock, or the client's reactive layer is
 * injected (`LedgerDeps`), so this module is pure orchestration of the
 * documented contract:
 *
 *  - appendLog  mints a uuidv4, windows time_stamp by the server offset,
 *               sanitizes the payload, writes the row, applies it
 *               immediately (local-first), then marks the ledger.
 *  - insertLog  (sync delivery) skips only logs whose ledger row is actually
 *               applied — a mere claim row must not block re-insertion.
 *  - applyLog   claims, applies, marks; failures bump retry_count and
 *               schedule next_retry_at = now + retry_count × 10s.
 *               MISSING_DEPENDENCY backoffs without throwing (returns false).
 *
 * No function holds an outer transaction: if apply fails the ticket_log row
 * MUST persist (unapplied) so the apply loop can retry — a ROLLBACK would
 * erase it locally while peers/server keep it (permanent divergence).
 */

import { sanitizePayload } from './sanitizePayload.js';
import type { TicketLogEntry } from './applyTicketLog.js';

/** Log row as read from ticket_log / exchanged with peers (both clients'
 *  `TicketLog` satisfies it). */
export interface TicketLogRow {
  uuid: string;
  ticket_uuid: string;
  location_group_uuid: string;
  action: string;
  payload?: unknown;
  time_stamp?: number | string | null;
  admin_uuid?: string | null;
}

export interface LedgerLogger {
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

const consoleLogger: LedgerLogger = {
  warn: (msg, meta) => console.warn(msg, meta),
  error: (msg, meta) => console.error(msg, meta),
};

export interface LedgerDeps {
  /** Raw write against the real DB (NOT the apply adapter's write buffer). */
  run(sql: string, params?: any[]): Promise<void>;
  /** Raw read against the real DB (Tauri's adapter cache can be stale). */
  query(sql: string, params?: any[]): Promise<any[]>;
  /** Apply one entry — the client wraps engine applyTicketLog with its
   *  DbAdapter and (FE) its write lock. */
  applyEntry(entry: TicketLogEntry): Promise<void>;
  /** Server-clock offset in ms — every minted time_stamp is windowed by it. */
  serverOffsetMs(): Promise<number>;
  /** Fresh uuid for a minted log. */
  newUuid(): string;
  /** Notify the client's reactive layer (live queries / P2P push). */
  notify(): void;
  /** Optional whole-flow write lock (RN `withDbLock`). Default: identity.
   *  FE leaves this unset — its lock lives inside `applyEntry`. */
  lock?<T>(fn: () => Promise<T>): Promise<T>;
  /** Optional logger (RN routes to its file logger). Default: console. */
  logger?: LedgerLogger;
}

function fromSyncLog(log: TicketLogRow): TicketLogEntry {
  return {
    uuid: log.uuid,
    ticket_uuid: log.ticket_uuid,
    location_group_uuid: log.location_group_uuid,
    action: log.action,
    payload: sanitizePayload(log.payload),
    time_stamp: log.time_stamp as number,
    admin_uuid: log.admin_uuid ?? undefined,
  };
}

/** Local mutation → log: mint, insert, apply immediately, mark applied. */
export async function appendLog(
  deps: LedgerDeps,
  input: Omit<TicketLogEntry, 'uuid'>,
): Promise<TicketLogEntry> {
  const lock = deps.lock ?? ((fn: () => Promise<TicketLogEntry>) => fn());
  return lock(async () => {
    const offset = await deps.serverOffsetMs();
    const now = Date.now() + offset;

    const entry: TicketLogEntry = {
      uuid: deps.newUuid(),
      ticket_uuid: input.ticket_uuid,
      location_group_uuid: input.location_group_uuid,
      action: input.action,
      payload: sanitizePayload(input.payload),
      time_stamp: now,
      admin_uuid: input.admin_uuid,
    };

    await deps.run(
      `INSERT INTO ticket_log (uuid, ticket_uuid, location_group_uuid, action, payload, time_stamp, admin_uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uuid) DO NOTHING`,
      [
        entry.uuid,
        entry.ticket_uuid,
        entry.location_group_uuid,
        entry.action,
        JSON.stringify(entry.payload),
        entry.time_stamp,
        entry.admin_uuid ?? null,
      ],
    );

    await deps.applyEntry(entry);

    await deps.run(
      `INSERT OR IGNORE INTO ticket_log_applied (uuid, time_stamp) VALUES (?, ?)`,
      [entry.uuid, entry.time_stamp],
    );

    deps.notify();
    return entry;
  });
}

/** Sync delivery: park the row unless the log already ran. */
export async function insertLog(deps: LedgerDeps, log: TicketLogRow): Promise<void> {
  const entry = fromSyncLog(log);

  // Skip only when the log is actually applied (time_stamp set) — a mere
  // claim row must not block re-inserting the ticket_log row, or a log
  // whose ledger row outlives its ticket_log row (e.g. pre-fix prune) could
  // never be restored by re-delivery.
  const applied = await deps.query(
    `SELECT 1 FROM ticket_log_applied WHERE uuid = ? AND time_stamp IS NOT NULL LIMIT 1`,
    [entry.uuid],
  );
  if (applied.length > 0) return;

  const payloadString =
    entry.payload == null
      ? null
      : typeof entry.payload === 'string'
        ? entry.payload
        : JSON.stringify(entry.payload);

  await deps.run(
    `INSERT OR IGNORE INTO ticket_log (uuid, ticket_uuid, location_group_uuid, action, payload, time_stamp, admin_uuid)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uuid) DO NOTHING`,
    [
      entry.uuid,
      entry.ticket_uuid,
      entry.location_group_uuid,
      entry.action,
      payloadString,
      entry.time_stamp,
      entry.admin_uuid ?? null,
    ],
  );
}

/** Claim → apply → mark, with the documented backoff on failure.
 *  Returns false when the log was skipped (already applied) or backed off
 *  (MISSING_DEPENDENCY); rethrows every other apply error after recording
 *  the retry. */
export async function applyLog(deps: LedgerDeps, log: TicketLogRow): Promise<boolean> {
  const lock = deps.lock ?? ((fn: () => Promise<boolean>) => fn());
  return lock(async () => {
    const entry = fromSyncLog(log);
    const logger = deps.logger ?? consoleLogger;

    // Already-applied check reads the real DB, never the adapter cache —
    // on Tauri the cache can be stale after writes and would make logs
    // retry indefinitely even after being marked applied.
    const applied = await deps.query(
      `SELECT 1 FROM ticket_log_applied WHERE uuid = ? AND time_stamp IS NOT NULL LIMIT 1`,
      [entry.uuid],
    );
    if (applied.length > 0) return false;

    // No canApplyLog pre-flight — the engine's own FK checks are the single
    // source of truth. The claim row is written before apply (outside any
    // transaction): the engine buffers its own writes and flushes them as
    // one atomic batch; a manual BEGIN here would swallow other flows'
    // statements and ROLLBACK would erase them.
    await deps.run(
      `INSERT OR IGNORE INTO "ticket_log_applied" ("uuid", "time_stamp", "retry_count") VALUES (?, NULL, 0)`,
      [entry.uuid],
    );

    try {
      await deps.applyEntry(entry);

      await deps.run(
        `UPDATE "ticket_log_applied" SET "time_stamp" = ?, "retry_count" = NULL, "next_retry_at" = NULL, "last_error" = NULL WHERE "uuid" = ?`,
        [entry.time_stamp, entry.uuid],
      );
      return true;
    } catch (e) {
      const now = Date.now();
      const msg = e instanceof Error ? e.message : String(e);
      const isMissingDep = msg.includes('MISSING_DEPENDENCY');

      // Failure: bump retry_count, schedule now + retry_count × 10s.
      await deps.run(
        `UPDATE "ticket_log_applied" SET "retry_count" = COALESCE("retry_count", 0) + 1, "next_retry_at" = ? + (COALESCE("retry_count", 0) + 1) * 10000, "last_error" = ? WHERE "uuid" = ?`,
        [now, msg.slice(0, 255), entry.uuid],
      );

      if (isMissingDep) {
        // Dependency may arrive later via ref-data sync — backoff, don't throw.
        logger.warn('MISSING_DEPENDENCY (will retry)', {
          uuid: entry.uuid,
          action: entry.action,
        });
        return false;
      }

      logger.error('APPLY FAILED (will retry)', e);
      throw e;
    }
  });
}
