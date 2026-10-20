/**
 * Multi-location-group (multi-venue) switch orchestration, shared by the web
 * client and the RN app (byte-parity: identical input → identical state).
 *
 * The web feature added `/gerentes` + `/tablero-multi` (venue picker + floating
 * switcher); this module owns the decision logic BOTH clients run so the guard
 * order and flush-or-block rule can never drift:
 *
 *   no_session → same_venue → blocked_offline → flush → wipe → writeMeta → reload
 *
 * Everything platform-specific (DB wipe, session-meta persistence, the reload /
 * boot restart, HTTP upload, connectivity) is injected, so this file stays
 * side-effect free and testable without a device, browser, or server.
 *
 * Rules encoded here (see omni/docs/CORE-LOGIC-*):
 *  - Switching is ONLINE-ONLY: no server round-trip is possible offline, so a
 *    switch would drop unsynced local ticket logs.
 *  - Flush-or-block: ALL local ticket logs for the CURRENT venue are pushed to
 *    the server first; any failure blocks the switch and leaves the DB untouched.
 *  - After a successful flush the local DB is wiped and the new venue's
 *    session-meta is written; the caller then reloads/reboots so the new venue
 *    reseeds from scratch (a wiped venue's data can never leak into another).
 */

import { buildBuckets, chunkBucketsForUpload } from './syncBuckets.js';
import type { BucketMap } from './syncBuckets.js';
import { filterTicketsByActivity } from './syncQueue.js';
import type { SyncLogLike, SyncSummary, TicketsMapLike } from './syncQueue.js';

/** Minimal venue reference a switch needs. Both clients' `LocationGroup`
 *  satisfies it (only `uuid` + `url_name` are used). */
export interface VenueRef {
  uuid: string;
  url_name?: string | null;
}

/** Outcome of a switch attempt. `'switched'` means the caller must now
 *  reload/reboot — nothing after that point runs in the old session. */
export type SwitchResult =
  | 'switched'
  | 'same_venue'
  | 'no_session'
  | 'blocked_offline'
  | 'blocked_flush';

/** Everything platform-specific a switch needs. All fields required — the
 *  engine never guesses a default; each client binds its own (see web
 *  `lgSwitch.ts` and RN `src/core/venue/lgSwitch.ts`). */
export interface SwitchDeps {
  /** Current bound admin uuid, or null when signed out. */
  getAdminUuid: () => Promise<string | null | undefined>;
  /** Currently bound venue uuid, or null (fresh picker / pre-login). */
  getCurrentLocationGroupUuid: () => Promise<string | null | undefined>;
  /** Connectivity probe. Offline short-circuits before any local mutation. */
  isOnline: () => boolean;
  /** Push every local ticket log for `locationGroupUuid` to the server.
   *  Resolves true only when the flush fully succeeded. */
  flush: (locationGroupUuid: string) => Promise<boolean>;
  /** Wipe the local DB (and re-apply the baseline DDL so the meta writes
   *  below have a `key_value` home). */
  wipe: () => Promise<void>;
  /** Persist the new venue's session meta (must be durable before reload). */
  writeSessionMeta: (target: {
    adminUuid: string;
    locationGroupUuid: string;
    restGroup: string;
  }) => Promise<void>;
  /** Reload/reboot onto the new venue (web: hard navigation; RN: restartBoot). */
  onSwitched: () => void;
}

const emptySummary = (): SyncSummary => ({
  ticketsTotal: 0,
  ticketsActive: 0,
  ticketsExpired: 0,
  incomingTickets: 0,
  bucketsOut: 0,
  pruned: 0,
  ticketsOutOfSync: 0,
});

/**
 * Venue switch — the ONLY supported way to change the active location_group
 * while keeping the same admin session. See the module doc for the invariants.
 *
 * `deps` is fully injectable so both clients supply their own wipe / meta /
 * reload while sharing this exact decision order.
 */
export async function switchLocationGroup(
  target: VenueRef,
  deps: SwitchDeps,
): Promise<SwitchResult> {
  const currentLg = await deps.getCurrentLocationGroupUuid();
  const adminUuid = await deps.getAdminUuid();
  if (!adminUuid) return 'no_session';
  if (currentLg === target.uuid) return 'same_venue';

  if (!deps.isOnline()) return 'blocked_offline';

  if (currentLg) {
    const flushed = await deps.flush(currentLg);
    if (!flushed) return 'blocked_flush';
  }

  await deps.wipe();
  await deps.writeSessionMeta({
    adminUuid,
    locationGroupUuid: target.uuid,
    restGroup: target.url_name ?? '',
  });
  deps.onSwitched();
  return 'switched';
}

/** IO a venue flush needs. `getLocalTicketsMap` throws on a wiped/empty DB
 *  (no ticket tables yet) — treated as a successful no-op flush. */
export interface VenueFlushDeps<T extends SyncLogLike> {
  /** Every local ticket log for the venue, keyed by ticket uuid. */
  getLocalTicketsMap: (
    locationGroupUuid: string,
  ) => Promise<TicketsMapLike<T>>;
  /** Offset-aware server clock (ms). Defaults to local `Date.now()`. */
  now?: () => number;
  /** Upload a bucket chunk. Resolve `{ ok }`; falsy/`ok:false` fails the flush. */
  syncTicketLogs: (
    locationGroupUuid: string,
    body: { bucket_hashes: Record<number, number>; buckets: BucketMap<T> },
  ) => Promise<{ ok?: boolean } | null | undefined>;
  /** Optional error sink (web logs to console; RN to its logger). */
  logError?: (message: string, error?: unknown) => void;
}

/**
 * Push every local ticket log for `locationGroupUuid` to the server before a
 * venue switch wipes the local DB. Sending the FULL bucket map with an empty
 * baseline (`bucket_hashes: {}`) forces the server to ingest all our logs
 * idempotently — the response is discarded (we're about to wipe). Chunking is
 * the engine's shared `chunkBucketsForUpload`. Returns true only when every
 * chunk was accepted; a wiped/empty DB is a successful no-op.
 */
export async function flushVenueLogs<T extends SyncLogLike>(
  locationGroupUuid: string,
  deps: VenueFlushDeps<T>,
): Promise<boolean> {
  try {
    let buckets: BucketMap<T>;
    try {
      const raw = await deps.getLocalTicketsMap(locationGroupUuid);
      const tickets = filterTicketsByActivity(
        raw,
        emptySummary(),
        deps.now?.() ?? Date.now(),
      );
      buckets = buildBuckets(tickets);
    } catch {
      // Wiped/empty DB (no ticket tables yet) — nothing to push.
      return true;
    }

    const chunks = Object.keys(buckets).length
      ? chunkBucketsForUpload(buckets)
      : [];
    for (const chunk of chunks) {
      const res = await deps.syncTicketLogs(locationGroupUuid, {
        bucket_hashes: {},
        buckets: chunk,
      });
      if (!res?.ok) return false;
    }
    return true;
  } catch (e) {
    deps.logError?.('flushVenueLogs failed', e);
    return false;
  }
}
