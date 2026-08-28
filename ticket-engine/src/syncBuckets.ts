/**
 * P2P / server sync-buckets anti-entropy primitives.
 *
 * This is the SINGLE SOURCE OF TRUTH for bucket assignment + bucket hashing,
 * shared by the React Native app, the Next.js web client, and (by contract) the
 * Go server's `bucket` package (see `omni/src/services/bucket/hashing.go`).
 *
 * It MUST stay byte-for-byte compatible with the Go implementation:
 *   - `fastHashUuid` mirrors `FastHashUuid` (XOR-fold over char codes).
 *   - `buildBucketHashes` folds a 0 result to 1, matching `FoldBucketHash`,
 *     because 0 is reserved to mean "bucket has no logs" on lookup.
 *
 * Changing any of this INVALIDATES sync compatibility across every device.
 */

/** Number of anti-entropy buckets. Must equal `domain.NUM_BUCKETS` in Go (32). */
export const NUM_BUCKETS = 32

/** Map of bucket index → folded hash. A bucket absent here is treated as 0. */
export type BucketHashes = Record<number, number>

/**
 * Map of bucket index → (ticket_uuid → logs). Generic over the log shape so
 * both RN (`TicketLog`) and the web client can use it; only `uuid` is required.
 */
export type BucketMap<T extends { uuid: string } = { uuid: string }> = Record<
  number,
  Record<string, T[]>
>

/**
 * Deterministic, non-cryptographic hash used ONLY for bucket diffing.
 * Mirrors `FastHashUuid` in `omni/src/services/bucket/hashing.go`.
 * DO NOT use for security, ordering, or persistence logic.
 */
export const fastHashUuid = (uuid: string): number => {
  let hash = 0
  for (let i = 0; i < uuid.length; i++) {
    hash ^= uuid.charCodeAt(i) << (i % 8)
  }
  return hash >>> 0
}

/** Deterministically assign a ticket to a bucket (stable across devices). */
export const bucketForTicket = (ticket_uuid: string): number =>
  fastHashUuid(ticket_uuid) % NUM_BUCKETS

/** Group a tickets map by bucket index. */
export const buildBuckets = <T extends { uuid: string }>(
  tickets: Record<string, T[]>,
): BucketMap<T> => {
  const buckets: BucketMap<T> = {}

  for (const ticket_uuid in tickets) {
    const logs = tickets[ticket_uuid]
    if (!logs) continue

    const b = bucketForTicket(ticket_uuid)

    if (!buckets[b]) buckets[b] = {}

    buckets[b]![ticket_uuid] = logs
  }

  return buckets
}

/**
 * Folded XOR hash of every log uuid within each bucket. A non-empty bucket must
 * never hash to 0 — empty buckets are omitted from the sync request (0 = "no
 * logs"). Mirrors `FoldBucketHash` in Go: a 0 fold is forced to 1.
 */
export const buildBucketHashes = (buckets: BucketMap<any>): BucketHashes => {
  const result: BucketHashes = {}

  for (const b in buckets) {
    let h = 0
    const tickets = buckets[b]

    for (const t in tickets) {
      const logs = tickets[t]
      if (!logs) continue

      for (const log of logs) {
        h ^= fastHashUuid(log.uuid)
      }
    }

    const folded = (h >>> 0) === 0 ? 1 : h >>> 0
    result[Number(b)] = folded
  }

  return result
}

/** Buckets whose hash changed, appeared, or disappeared between two snapshots. */
export const getDirtyBuckets = (
  current: BucketHashes,
  previous: BucketHashes,
): Set<number> => {
  const dirty = new Set<number>()

  for (const b in current) {
    if (current[b] !== previous[b]) dirty.add(Number(b))
  }

  for (const b in previous) {
    if (!(b in current) || current[b] !== previous[b]) {
      dirty.add(Number(b))
    }
  }

  return dirty
}
