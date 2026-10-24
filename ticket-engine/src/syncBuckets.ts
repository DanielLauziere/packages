/**
 * P2P / server sync-buckets anti-entropy primitives.
 *
 * This is the SINGLE SOURCE OF TRUTH for bucket assignment + bucket hashing,
 * shared by the React Native app, the Next.js web client, and (by contract) the
 * Go server's `bucket` package (see `omni/src/services/bucket/hashing.go`).
 *
 * It MUST stay byte-for-byte compatible with the Go implementation:
 *   - `fastHashUuid` mirrors `FastHashUuid` (FNV-1a 32 over char codes).
 *   - `buildBucketHashes` packs (log count, XOR) exactly like
 *     `PackBucketHash` in Go — 0 stays reserved for "bucket has no logs".
 *   - `buildTicketDigests` is the same packing per ticket, mirroring the
 *     server's `ticket_digests` (Phase 2).
 *
 * Changing any of this INVALIDATES sync compatibility across every device.
 */

/** Number of anti-entropy buckets. Must equal `domain.NUM_BUCKETS` in Go (32). */
export const NUM_BUCKETS = 32;

/** Map of bucket index → packed (count ‖ xor) hash. Absent = 0 = "no logs". */
export type BucketHashes = Record<number, number>;

/**
 * Map of bucket index → (ticket_uuid → logs). Generic over the log shape so
 * both RN (`TicketLog`) and the web client can use it; only `uuid` is required.
 */
export type BucketMap<T extends { uuid: string } = { uuid: string }> = Record<
  number,
  Record<string, T[]>
>;

/**
 * Deterministic, non-cryptographic hash used ONLY for bucket diffing.
 * FNV-1a 32-bit — mirrors `FastHashUuid` in
 * `omni/src/services/bucket/hashing.go`. ASCII input only (uuids), so
 * `charCodeAt` equals Go's byte walk. DO NOT use for security, ordering, or
 * persistence logic.
 */
export const fastHashUuid = (uuid: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < uuid.length; i++) {
    hash ^= uuid.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/** 2^32 — high-word scale for packing (count, xor) into one exact number. */
export const BUCKET_HASH_SCALE = 4294967296;

/**
 * Pack a bucket's (log count, XOR of per-log hashes) into one JSON-safe
 * integer: count in the high bits, xor in the low 32. Mirrors `PackBucketHash`
 * in Go. Exact as a JS number while count < 2^21 (2^53 ceiling) — buckets hold
 * orders of magnitude fewer logs. The count component means ANY added or
 * removed log changes the value even when the XOR component cancels, so a pair
 * of colliding log hashes can never leave a bucket invisible to sync.
 */
export const packBucketHash = (count: number, xor: number): number =>
  count * BUCKET_HASH_SCALE + (xor >>> 0);

/** Deterministically assign a ticket to a bucket (stable across devices). */
export const bucketForTicket = (ticket_uuid: string): number =>
  fastHashUuid(ticket_uuid) % NUM_BUCKETS;

/** Group a tickets map by bucket index. */
export const buildBuckets = <T extends { uuid: string }>(
  tickets: Record<string, T[]>,
): BucketMap<T> => {
  const buckets: BucketMap<T> = {};

  for (const ticket_uuid in tickets) {
    const logs = tickets[ticket_uuid];
    if (!logs) continue;

    const b = bucketForTicket(ticket_uuid);

    if (!buckets[b]) buckets[b] = {};

    buckets[b]![ticket_uuid] = logs;
  }

  return buckets;
};

/**
 * Packed (log count, XOR) fingerprint of every log uuid within each bucket.
 * Empty buckets are omitted — 0 is reserved to mean "bucket has no logs".
 * Mirrors `PackBucketHash`/`computeServerBuckets` in Go.
 */
export const buildBucketHashes = (buckets: BucketMap<any>): BucketHashes => {
  const result: BucketHashes = {};

  for (const b in buckets) {
    let h = 0;
    let count = 0;
    const tickets = buckets[b];

    for (const t in tickets) {
      const logs = tickets[t];
      if (!logs) continue;

      for (const log of logs) {
        h ^= fastHashUuid(log.uuid);
        count++;
      }
    }

    if (count === 0) continue;
    result[Number(b)] = packBucketHash(count, h);
  }

  return result;
};

/**
 * Packed (log count, XOR of per-log hashes) fingerprint of every ticket's log
 * group across a bucket map, as `ticket_uuid → digest` — the wire value of
 * `ticket_digests` in SyncBucketsRequest (Phase 2 of
 * docs/features/sync-payload-reduction.md).
 *
 * This is the bucket-hash primitive one level down and must stay byte-for-byte
 * compatible with the server's per-ticket digests (the (count, xor)
 * accumulation in `computeServerBuckets`, omni/src/services/bucket/sync_service.go).
 * Build it from the SAME buckets map (same window scope) as the `bucket_hashes`
 * of that request: a narrower scope is still correct — a missing digest just
 * makes the server ship that ticket — but it gives up the skipping. Empty
 * groups are skipped: a server ticket always has >= 1 log, so a digest is
 * never 0.
 */
export type TicketDigests = Record<string, number>;

export const buildTicketDigests = <T extends { uuid: string }>(
  buckets: BucketMap<T>,
): TicketDigests => {
  const result: TicketDigests = {};

  for (const b in buckets) {
    const tickets = buckets[b];
    if (!tickets) continue;

    for (const t in tickets) {
      const logs = tickets[t];
      if (!logs?.length) continue;

      let h = 0;
      let count = 0;
      for (const log of logs) {
        h ^= fastHashUuid(log.uuid);
        count++;
      }
      result[t] = packBucketHash(count, h);
    }
  }

  return result;
};

/**
 * Default max serialized size of a `ticket-log/sync-buckets` request body.
 * The server truncates bodies over 20MB and rejects them with 400 and no
 * partial accept (omni `bucketHandler.go`), which would loop forever while the
 * bucket stays dirty. Clients split oversized uploads into multiple requests,
 * each carrying the FULL `bucket_hashes` map — ingest is idempotent per log
 * uuid, so overlapping/repeated sends are safe.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Phase 3 wire cut (docs/features/sync-payload-reduction.md): on the
 * sync-buckets wire these two fields are redundant — `location_group_uuid`
 * comes from the request route and `ticket_uuid` from the `buckets[b][ticket]`
 * map key — so uploads drop them and the server re-stamps both at ingest.
 * Returns the SAME object when there is nothing to strip. P2P/RTC transports
 * never route through `chunkBucketsForUpload` (they send flat log arrays) and
 * keep both fields unchanged.
 */
type WireStrip = { ticket_uuid?: unknown; location_group_uuid?: unknown };

const stripWireFields = <T extends { uuid: string }>(log: T): T => {
  const o = log as T & WireStrip;
  if (o.ticket_uuid === undefined && o.location_group_uuid === undefined) {
    return log;
  }
  const { ticket_uuid: _t, location_group_uuid: _l, ...rest } = o;
  return rest as T;
};

/**
 * Split an outgoing bucket map into request-sized chunks.
 *
 * Returns `[]` for an empty map — callers should send a single request with
 * `buckets: {}` so they still receive server hashes/timestamps. Every log is
 * preserved exactly once across chunks; chunk order is deterministic
 * (bucket asc, ticket asc). The per-unit size estimate over-counts structural
 * overhead so a chunk's real JSON never exceeds `maxBytes` in practice (the
 * 8MB default leaves ~12MB of slack against the server's 20MB cap).
 *
 * Every server-bound upload flows through here (sync loop, drains, venue
 * switch flush), so this is also the single strip point for the Phase 3 wire
 * cut: chunked logs are copies without `ticket_uuid`/`location_group_uuid`
 * (see stripWireFields), and the size estimate measures the stripped copy —
 * exactly what goes on the wire.
 */
export const chunkBucketsForUpload = <T extends { uuid: string }>(
  buckets: BucketMap<T>,
  maxBytes: number = MAX_UPLOAD_BYTES,
): BucketMap<T>[] => {
  const chunks: BucketMap<T>[] = [];
  let current: BucketMap<T> = {};
  // Running estimate of JSON.stringify(current).length; the outer {} pair.
  let size = 2;

  const flush = () => {
    if (Object.keys(current).length > 0) {
      chunks.push(current);
      current = {};
      size = 2;
    }
  };

  const bucketKeys = Object.keys(buckets)
    .map(Number)
    .sort((a, b) => a - b);

  for (const b of bucketKeys) {
    const tickets = buckets[b]!;
    for (const t of Object.keys(tickets).sort()) {
      for (const log of tickets[t]!) {
        const wireLog = stripWireFields(log);
        // "ticket-uuid":[  +  log json  +  comma/bracket slack
        const unit = JSON.stringify(wireLog).length + t.length + 6;
        if (size > 2 && size + unit > maxBytes) flush();
        if (!current[b]) {
          current[b] = {};
          size += 8; // "0":{}
        }
        if (!current[b]![t]) current[b]![t] = [];
        current[b]![t]!.push(wireLog);
        size += unit;
      }
    }
  }

  flush();
  return chunks;
};

/** Flatten a bucket map back into a tickets map (bucket identity is an
 *  implementation detail of the diff — callers exchange flat tickets).
 *
 *  Phase 3 wire cut: server buckets no longer carry `ticket_uuid` inside each
 *  log (it WAS the map key on the wire), so flatten re-injects it from the key
 *  — after this, every consumer (`filterTicketsByActivity` callers,
 *  `insertTicketsMap`, `groupLogsByTicket`, `fromSyncLog`) sees the full field
 *  again. Logs that already carry it are passed through untouched. The
 *  `location_group_uuid` stamp happens at the ingest boundary (each client's
 *  `insertTicketsMap`), where the sync route context lives. */
export const flattenBuckets = <T extends { uuid: string }>(
  buckets: BucketMap<T>,
): Record<string, T[]> => {
  const result: Record<string, T[]> = {};

  for (const b in buckets) {
    const bucket = buckets[b];
    if (!bucket) continue;

    for (const t in bucket) {
      const logs = bucket[t];
      if (!logs) continue;

      result[t] = logs.map((log) => {
        if ((log as T & { ticket_uuid?: string }).ticket_uuid) return log;
        return { ...log, ticket_uuid: t } as T;
      });
    }
  }

  return result;
};

/** Buckets whose hash changed, appeared, or disappeared between two snapshots. */
export const getDirtyBuckets = (
  current: BucketHashes,
  previous: BucketHashes,
): Set<number> => {
  const dirty = new Set<number>();

  for (const b in current) {
    if (current[b] !== previous[b]) dirty.add(Number(b));
  }

  for (const b in previous) {
    if (!(b in current) || current[b] !== previous[b]) {
      dirty.add(Number(b));
    }
  }

  return dirty;
};

// =====================================================
// PAGED PULL PROTOCOL (omni/docs/features/SYNC-PULL-PAGING.md)
// Client side of the `pull` request/response extension. Mirrors PullAfter /
// PullOptions / PullResult in Go (`omni/src/services/bucket/types.go`).
// =====================================================

/** Keyset resume cursor: last ticket unit delivered, in the protocol's stable
 *  (bucket asc, ticket_uuid asc) order. Pages are ticket-atomic. */
export interface PullAfter {
  bucket: number;
  ticket_uuid: string;
}

/** Client → server paged-pull options; every field optional (server clamps). */
export interface PullOptions {
  /** Narrow the window below the 36h cutoff (phase-1 recent-first sync). */
  max_age_ms?: number;
  /** Page byte budget — server default 32KB, clamped 8KB–512KB. */
  max_bytes?: number;
  /** Resume cursor; omit on the first page. */
  after?: PullAfter | null;
}

/** Server → client paged-pull metadata. ABSENT on legacy servers — response
 *  presence is the backcompat gate (no feature flag): absent → the response is
 *  the legacy monolithic payload and the client falls back to legacy handling. */
export interface PullResult {
  has_more: boolean;
  next_after?: PullAfter | null;
  /** Dirty buckets whose full ticket set this response carried — their entries
   *  in `bucket_hashes` are adoptable as the client baseline (see
   *  adoptDeliveredHashes). */
  delivered_buckets: number[];
  /** Which activity window the response's `bucket_hashes` describe. */
  window_ms: number;
}

/** Page budget for paged pulls — ~3s across a ~10KB/s metered link, safely
 *  inside the client HTTP timeout. Mirrors the server default. */
export const PULL_PAGE_BYTES = 32 * 1024;

/** Phase-1 window (SYNC-PULL-PAGING.md): hydrate the dashboard from tickets
 *  active in the last 6h before continuing the full 36h backfill. */
export const RECENT_SYNC_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * Per-bucket baseline adoption for the paged pull (SYNC-PULL-PAGING.md rules
 * 3–5). Adopt the server's hash for buckets fully delivered this response,
 * plus clean buckets where the client's current hash already matches the
 * server (a clean bucket that never adopts would re-dirty every cycle
 * forever). Undelivered dirty buckets keep their previous baseline and are
 * resumed via the cursor.
 *
 * `prev` is the client's existing baseline, `current` what the client sent
 * (its CURRENT local hashes), `server` the response hash map, `delivered` the
 * response's delivered_buckets. current/server must come from the SAME window
 * scope — never mix a narrowed-window response into a full-window baseline.
 * Absent keys mean 0 ("no logs") on every map.
 */
export const adoptDeliveredHashes = (
  prev: BucketHashes,
  current: BucketHashes,
  server: BucketHashes,
  delivered: number[],
): BucketHashes => {
  const next: BucketHashes = { ...prev };
  const deliveredSet = new Set(delivered);

  const keys = new Set([
    ...Object.keys(server).map(Number),
    ...Object.keys(prev).map(Number),
  ]);

  for (const b of keys) {
    const serverHash = server[b] ?? 0;
    const currentHash = current[b] ?? 0;
    if (deliveredSet.has(b) || currentHash === serverHash) {
      if (serverHash === 0) {
        delete next[b];
      } else {
        next[b] = serverHash;
      }
    }
  }

  return next;
};
