import { describe, it, expect } from 'vitest'
import {
  NUM_BUCKETS,
  fastHashUuid,
  bucketForTicket,
  buildBuckets,
  buildBucketHashes,
  getDirtyBuckets,
  type BucketMap,
  type BucketHashes,
} from './syncBuckets.js'

/** Log shape only needs `uuid` for bucket hashing. */
type Log = { uuid: string }

// Golden values computed from the Go implementation
// (`omni/src/services/bucket/hashing.go`) so the TS clients can never silently
// drift from the server's `FastHashUuid` / `FoldBucketHash` / `bucketForTicket`.
const GOLDEN = {
  fast: {
    '550e8400-e29b-41d4-a716-446655440000': 2660,
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8': 6456,
    '': 0,
    'ffffffff-ffff-ffff-ffff-ffffffffffff': 12165,
  },
  bucket: {
    '550e8400-e29b-41d4-a716-446655440000': 4,
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8': 24,
    '': 0,
    'ffffffff-ffff-ffff-ffff-ffffffffffff': 5,
  },
  // FoldBucketHash(0) -> 1; everything else unchanged.
  fold: [
    [0, 1],
    [1, 1],
    [2, 2],
    [4294967295, 4294967295],
    [2147483648, 2147483648],
    [2863311530, 2863311530],
  ] as Array<[number, number]>,
}

describe('parity with Go bucket hashing', () => {
  it('fastHashUuid matches Go FastHashUuid golden values', () => {
    for (const [uuid, expected] of Object.entries(GOLDEN.fast)) {
      expect(fastHashUuid(uuid)).toBe(expected)
    }
  })

  it('bucketForTicket matches Go bucketForTicket golden values', () => {
    for (const [uuid, expected] of Object.entries(GOLDEN.bucket)) {
      expect(bucketForTicket(uuid)).toBe(expected)
    }
  })

  it('buildBucketHashes folds a 0 XOR to 1 (matches FoldBucketHash)', () => {
    // An empty-string uuid hashes to 0, so a single-log bucket XORs to 0 and
    // must be folded to 1 (0 is reserved for "no logs").
    const hashes = buildBucketHashes({ 0: { t: [{ uuid: '' }] } })
    expect(hashes[0]).toBe(1)
  })
})

describe('fastHashUuid', () => {
  it('is deterministic', () => {
    const u = '550e8400-e29b-41d4-a716-446655440000'
    expect(fastHashUuid(u)).toBe(fastHashUuid(u))
  })

  it('returns an unsigned 32-bit integer', () => {
    for (let i = 0; i < 50; i++) {
      const v = fastHashUuid(`uuid-${i}-${Math.random()}`)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(0xffffffff)
    }
  })

  it('different uuids usually differ', () => {
    expect(fastHashUuid('a')).not.toBe(fastHashUuid('b'))
  })
})

describe('bucketForTicket', () => {
  it('stays within [0, NUM_BUCKETS)', () => {
    for (let i = 0; i < 200; i++) {
      const b = bucketForTicket(`ticket-${i}`)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(NUM_BUCKETS)
    }
  })

  it('is stable for the same uuid', () => {
    expect(bucketForTicket('abc')).toBe(bucketForTicket('abc'))
  })
})

describe('buildBuckets', () => {
  it('groups tickets by their bucket', () => {
    const tickets: Record<string, Log[]> = {
      t1: [{ uuid: 'u1' }],
      t2: [{ uuid: 'u2' }],
    }
    const buckets = buildBuckets(tickets)
    expect(buckets[bucketForTicket('t1')].t1).toEqual([{ uuid: 'u1' }])
    expect(buckets[bucketForTicket('t2')].t2).toEqual([{ uuid: 'u2' }])
  })

  it('skips tickets with no logs', () => {
    const buckets = buildBuckets({ t1: [{ uuid: 'u1' }], t2: undefined as any })
    expect(buckets[bucketForTicket('t2')]).toBeUndefined()
  })
})

describe('buildBucketHashes', () => {
  it('omits empty buckets', () => {
    const hashes = buildBucketHashes({})
    expect(Object.keys(hashes)).toHaveLength(0)
  })

  it('never reports 0 for a non-empty bucket', () => {
    const buckets: BucketMap<Log> = { 1: { t: [{ uuid: 'a' }] } }
    const hashes = buildBucketHashes(buckets)
    expect(hashes[1]).toBeGreaterThan(0)
  })

  it('matches the Go fold contract (0 -> 1, else unchanged for a single log)', () => {
    // Single non-zero-hash log: folded value equals its hash.
    const u = 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz'
    const single = buildBucketHashes({ 0: { a: [{ uuid: u }] } })[0]
    const h = fastHashUuid(u)
    expect(single).toBe(h === 0 ? 1 : h)
  })
})

describe('getDirtyBuckets', () => {
  it('detects changed buckets', () => {
    const current: BucketHashes = { 0: 1, 1: 2 }
    const previous: BucketHashes = { 0: 1, 1: 3 }
    expect(getDirtyBuckets(current, previous)).toEqual(new Set([1]))
  })

  it('detects appeared buckets', () => {
    const current: BucketHashes = { 0: 1, 1: 2 }
    const previous: BucketHashes = { 0: 1 }
    expect(getDirtyBuckets(current, previous)).toEqual(new Set([1]))
  })

  it('detects disappeared buckets', () => {
    const current: BucketHashes = { 0: 1 }
    const previous: BucketHashes = { 0: 1, 1: 2 }
    expect(getDirtyBuckets(current, previous)).toEqual(new Set([1]))
  })

  it('reports nothing when identical', () => {
    const a: BucketHashes = { 0: 1, 1: 2 }
    expect(getDirtyBuckets(a, a)).toEqual(new Set())
  })
})
