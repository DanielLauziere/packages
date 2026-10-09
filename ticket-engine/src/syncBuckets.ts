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
 * Default max serialized size of a `ticket-log/sync-buckets` request body.
 * The server truncates bodies over 20MB and rejects them with 400 and no
 * partial accept (omni `bucketHandler.go`), which would loop forever while the
 * bucket stays dirty. Clients split oversized uploads into multiple requests,
 * each carrying the FULL `bucket_hashes` map — ingest is idempotent per log
 * uuid, so overlapping/repeated sends are safe.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Split an outgoing bucket map into request-sized chunks.
 *
 * Returns `[]` for an empty map — callers should send a single request with
 * `buckets: {}` so they still receive server hashes/timestamps. Every log is
 * preserved exactly once across chunks; chunk order is deterministic
 * (bucket asc, ticket asc). The per-unit size estimate over-counts structural
 * overhead so a chunk's real JSON never exceeds `maxBytes` in practice (the
 * 8MB default leaves ~12MB of slack against the server's 20MB cap).
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
        // "ticket-uuid":[  +  log json  +  comma/bracket slack
        const unit = JSON.stringify(log).length + t.length + 6;
        if (size > 2 && size + unit > maxBytes) flush();
        if (!current[b]) {
          current[b] = {};
          size += 8; // "0":{}
        }
        if (!current[b]![t]) current[b]![t] = [];
        current[b]![t]!.push(log);
        size += unit;
      }
    }
  }

  flush();
  return chunks;
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
