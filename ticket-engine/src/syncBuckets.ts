/**
 * P2P bucket anti-entropy primitives.
 *
 * This is the SINGLE SOURCE OF TRUTH for bucket assignment + bucket hashing,
 * shared by the React Native app and the Next.js web client.
 *
 * The same hashes are used by P2P and backend anti-entropy sync.
 */

/** Number of anti-entropy buckets used by the P2P clients. */
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

/** Hash exchange request/response shared by both backend-sync clients. */
export interface TicketLogBucketSyncResponse<
  TLog extends { uuid: string } = { uuid: string },
> {
  bucket_hashes: BucketHashes;
  buckets: BucketMap<TLog & { uuid: string }>;
  server_timestamp: number;
}

/**
 * Copy a bucket map into the compact backend wire shape. The route supplies
 * location_group_uuid and each bucket's ticket key supplies ticket_uuid.
 */
export const stripBucketWireFields = <
  T extends {
    uuid: string;
    location_group_uuid?: string;
    ticket_uuid?: string;
  },
>(
  buckets: BucketMap<T>,
): BucketMap<Omit<T, "location_group_uuid" | "ticket_uuid">> => {
  const result: BucketMap<
    Omit<T, "location_group_uuid" | "ticket_uuid">
  > = {};

  for (const bucket in buckets) {
    const tickets = buckets[bucket];
    if (!tickets) continue;

    result[Number(bucket)] = {};
    for (const ticketUuid in tickets) {
      const logs = tickets[ticketUuid];
      if (!logs) continue;
      result[Number(bucket)]![ticketUuid] = logs.map((log) => {
        const wireLog = { ...log };
        delete wireLog.location_group_uuid;
        delete wireLog.ticket_uuid;
        return wireLog;
      });
    }
  }

  return result;
};

/**
 * Deterministic, non-cryptographic hash used ONLY for bucket diffing.
 * FNV-1a 32-bit. UUID input is ASCII. DO NOT use for security, ordering, or
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
 * integer: count in the high bits, xor in the low 32. Exact as a JS number
 * while count < 2^21 (2^53 ceiling) — buckets hold
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
 * Used to compare P2P peer snapshots.
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

/** Flatten a bucket map and restore ticket_uuid from its key when omitted. */
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
