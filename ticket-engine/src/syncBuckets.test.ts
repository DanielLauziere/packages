import { describe, it, expect } from "vitest";
import {
  NUM_BUCKETS,
  fastHashUuid,
  packBucketHash,
  bucketForTicket,
  buildBuckets,
  buildBucketHashes,
  flattenBuckets,
  getDirtyBuckets,
  stripBucketWireFields,
  type BucketMap,
  type BucketHashes,
} from "./syncBuckets.js";

/** Log shape only needs `uuid` for bucket hashing. */
type Log = { uuid: string };

// Stable vectors retained for P2P bucket hashing.
const GOLDEN = {
  fast: {
    "550e8400-e29b-41d4-a716-446655440000": 2292069672,
    "6ba7b810-9dad-11d1-80b4-00c04fd430c8": 4043892016,
    "": 2166136261,
    "ffffffff-ffff-ffff-ffff-ffffffffffff": 654879633,
    // 2026-10-09 incident pair (SET_STATUS_COMPLETE / PRINT_SUCCESS) — the old
    // XOR-shift hash mapped both to 0x9a0 and hid the bucket for 7.5 minutes.
    "a4d24005-0d66-454d-a661-3141f155cc20": 2805344404,
    "606bd2a4-3885-41dc-9829-3cd4f4c80eef": 3243728997,
  },
  bucket: {
    "550e8400-e29b-41d4-a716-446655440000": 8,
    "6ba7b810-9dad-11d1-80b4-00c04fd430c8": 16,
    "": 5,
    "ffffffff-ffff-ffff-ffff-ffffffffffff": 17,
  },
  // 20,000-uuid safety corpus (splitmix32, seed 0x12345678).
  safety: {
    first: "b1fb5107-2c5f-4fd8-afaf-8367a78b935c",
    firstHash: 2178313897,
    last: "bffe71b0-0fab-4f38-bdcf-267b1c0081de",
    lastHash: 3703842988,
  },
};

/** Deterministic splitmix32 uuid stream for the hash safety check. */
const makeSafetyCorpus = (n: number): string[] => {
  let state = 0x12345678;
  const next = (): number => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
  const hex = (v: number, w: number): string =>
    (v >>> 0).toString(16).padStart(w, "0");

  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const w0 = next();
    const w1 = next();
    const w2 = next();
    const w3 = next();
    out.push(
      `${hex(w0, 8)}-${hex(w1 >>> 16, 4)}-${hex((w1 & 0x0fff) | 0x4000, 4)}-${hex((w2 & 0x3fff) | 0x8000, 4)}-${hex(w2 >>> 16, 4)}${hex(w3, 8)}`,
    );
  }
  return out;
};

describe("P2P bucket hash golden vectors", () => {
  it("fastHashUuid matches its stable vectors", () => {
    for (const [uuid, expected] of Object.entries(GOLDEN.fast)) {
      expect(fastHashUuid(uuid)).toBe(expected);
    }
  });

  it("bucketForTicket matches its stable vectors", () => {
    for (const [uuid, expected] of Object.entries(GOLDEN.bucket)) {
      expect(bucketForTicket(uuid)).toBe(expected);
    }
  });

  it("buildBucketHashes packs (count, xor) consistently", () => {
    // One log: packed = count<<32 | xor, never the raw folded hash.
    const u = "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz";
    const hashes = buildBucketHashes({ 0: { t: [{ uuid: u }] } });
    expect(hashes[0]).toBe(packBucketHash(1, fastHashUuid(u)));
    expect(hashes[0]).toBeGreaterThan(0xffffffff);
  });
});

describe("packBucketHash", () => {
  it("packs count into the high 32 bits and xor into the low 32", () => {
    expect(packBucketHash(0, 0)).toBe(0);
    expect(packBucketHash(1, 0)).toBe(4294967296);
    expect(packBucketHash(1, 0x1234)).toBe(4294967296 + 0x1234);
    expect(packBucketHash(5, 0xffffffff)).toBe(5 * 4294967296 + 0xffffffff);
  });

  it("never returns 0 for a non-empty bucket even when xor cancels", () => {
    expect(packBucketHash(1, 0)).not.toBe(0);
    expect(packBucketHash(7, 0)).not.toBe(0);
  });

  it("changes when count changes even if xor is unchanged (incident class)", () => {
    // The 2026-10-09 incident: two new logs XOR'd to 0, leaving the xor
    // component identical — the count component must still flip the value.
    expect(packBucketHash(7, 0x1234abcd)).not.toBe(
      packBucketHash(5, 0x1234abcd),
    );
  });

  it("stays an exact JS safe integer for realistic counts (< 2^21 logs)", () => {
    const v = packBucketHash(2 ** 21 - 1, 0xffffffff);
    expect(Number.isSafeInteger(v)).toBe(true);
  });
});

describe("20k hash safety", () => {
  it("hashes a 20,000-uuid corpus with no duplicate hashes", () => {
    const corpus = makeSafetyCorpus(20000);
    expect(corpus[0]).toBe(GOLDEN.safety.first);
    expect(corpus[19999]).toBe(GOLDEN.safety.last);

    const seen = new Set<number>();
    for (const uuid of corpus) seen.add(fastHashUuid(uuid));

    expect(fastHashUuid(corpus[0])).toBe(GOLDEN.safety.firstHash);
    expect(fastHashUuid(corpus[19999])).toBe(GOLDEN.safety.lastHash);
    expect(seen.size).toBe(20000);
  });

  it("every single-log append flips the packed bucket hash", () => {
    const corpus = makeSafetyCorpus(20000);
    let xor = 0;
    let count = 0;
    for (const uuid of corpus) {
      const h = fastHashUuid(uuid);
      const before = packBucketHash(count, xor);
      const after = packBucketHash(count + 1, xor ^ h);
      expect(after).not.toBe(before);
      xor ^= h;
      count++;
    }
    expect(count).toBe(20000);
  });

  it("incident pair no longer collides", () => {
    const complete = fastHashUuid("a4d24005-0d66-454d-a661-3141f155cc20");
    const print = fastHashUuid("606bd2a4-3885-41dc-9829-3cd4f4c80eef");
    expect(complete).not.toBe(print);
    // Adding both to a bucket changes it two ways: xor AND count.
    const before = packBucketHash(5, 0x9999);
    const after = packBucketHash(7, 0x9999 ^ complete ^ print);
    expect(after).not.toBe(before);
  });
});

describe("fastHashUuid", () => {
  it("is deterministic", () => {
    const u = "550e8400-e29b-41d4-a716-446655440000";
    expect(fastHashUuid(u)).toBe(fastHashUuid(u));
  });

  it("returns an unsigned 32-bit integer", () => {
    for (let i = 0; i < 50; i++) {
      const v = fastHashUuid(`uuid-${i}-${Math.random()}`);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("different uuids usually differ", () => {
    expect(fastHashUuid("a")).not.toBe(fastHashUuid("b"));
  });
});

describe("bucketForTicket", () => {
  it("stays within [0, NUM_BUCKETS)", () => {
    for (let i = 0; i < 200; i++) {
      const b = bucketForTicket(`ticket-${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(NUM_BUCKETS);
    }
  });

  it("is stable for the same uuid", () => {
    expect(bucketForTicket("abc")).toBe(bucketForTicket("abc"));
  });
});

describe("buildBuckets", () => {
  it("groups tickets by their bucket", () => {
    const tickets: Record<string, Log[]> = {
      t1: [{ uuid: "u1" }],
      t2: [{ uuid: "u2" }],
    };
    const buckets = buildBuckets(tickets);
    expect(buckets[bucketForTicket("t1")].t1).toEqual([{ uuid: "u1" }]);
    expect(buckets[bucketForTicket("t2")].t2).toEqual([{ uuid: "u2" }]);
  });

  it("skips tickets with no logs", () => {
    const buckets = buildBuckets({
      t1: [{ uuid: "u1" }],
      t2: undefined as any,
    });
    expect(buckets[bucketForTicket("t2")]).toBeUndefined();
  });
});

describe("buildBucketHashes", () => {
  it("omits empty buckets", () => {
    const hashes = buildBucketHashes({});
    expect(Object.keys(hashes)).toHaveLength(0);
  });

  it("omits buckets whose tickets carry no logs (0 stays reserved)", () => {
    const hashes = buildBucketHashes({ 1: { t: [] } });
    expect(hashes[1]).toBeUndefined();
  });

  it("never reports 0 for a non-empty bucket", () => {
    const buckets: BucketMap<Log> = { 1: { t: [{ uuid: "a" }] } };
    const hashes = buildBucketHashes(buckets);
    expect(hashes[1]).toBeGreaterThan(0);
  });

  it("includes the log count so colliding pairs still go dirty", () => {
    // Regression for the 2026-10-09 incident: two logs whose hashes cancel
    // must change the bucket because the count went 5 → 7.
    const base: BucketMap<Log> = {
      0: {
        t: [
          { uuid: "a" },
          { uuid: "b" },
          { uuid: "c" },
          { uuid: "d" },
          { uuid: "e" },
        ],
      },
    };
    const withPair: BucketMap<Log> = {
      0: {
        t: [
          { uuid: "a" },
          { uuid: "b" },
          { uuid: "c" },
          { uuid: "d" },
          { uuid: "e" },
          { uuid: "a4d24005-0d66-454d-a661-3141f155cc20" },
          { uuid: "606bd2a4-3885-41dc-9829-3cd4f4c80eef" },
        ],
      },
    };
    expect(buildBucketHashes(withPair)[0]).not.toBe(buildBucketHashes(base)[0]);
  });
});

describe("getDirtyBuckets", () => {
  it("detects changed buckets", () => {
    const current: BucketHashes = { 0: 1, 1: 2 };
    const previous: BucketHashes = { 0: 1, 1: 3 };
    expect(getDirtyBuckets(current, previous)).toEqual(new Set([1]));
  });

  it("detects appeared buckets", () => {
    const current: BucketHashes = { 0: 1, 1: 2 };
    const previous: BucketHashes = { 0: 1 };
    expect(getDirtyBuckets(current, previous)).toEqual(new Set([1]));
  });

  it("detects disappeared buckets", () => {
    const current: BucketHashes = { 0: 1 };
    const previous: BucketHashes = { 0: 1, 1: 2 };
    expect(getDirtyBuckets(current, previous)).toEqual(new Set([1]));
  });

  it("reports nothing when identical", () => {
    const a: BucketHashes = { 0: 1, 1: 2 };
    expect(getDirtyBuckets(a, a)).toEqual(new Set());
  });
});

describe("flattenBuckets", () => {
  it("restores ticket_uuid from the bucket map key when omitted", () => {
    const buckets: BucketMap<Log & { ticket_uuid?: string }> = {
      3: {
        "t-1": [
          { uuid: "a" },
          { uuid: "b", ticket_uuid: "t-1" },
        ],
      },
    };

    const flat = flattenBuckets(buckets);
    expect(Object.keys(flat)).toEqual(["t-1"]);
    expect(flat["t-1"]!.map((l) => (l as { ticket_uuid?: string }).ticket_uuid)).toEqual([
      "t-1",
      "t-1",
    ]);
    expect(flat["t-1"]![0]!.uuid).toBe("a");
  });

  describe("stripBucketWireFields", () => {
    it("omits redundant scope fields without mutating the local bucket", () => {
      const log = {
        uuid: "log-1",
        ticket_uuid: "ticket-1",
        location_group_uuid: "group-1",
        action: "ADD_ITEM",
      };
      const buckets = { 2: { "ticket-1": [log] } };

      expect(stripBucketWireFields(buckets)).toEqual({
        2: { "ticket-1": [{ uuid: "log-1", action: "ADD_ITEM" }] },
      });
      expect(buckets[2]!["ticket-1"]![0]).toBe(log);
    });
  });

  it("passes logs that already carry ticket_uuid through untouched", () => {
    const log: Log & { ticket_uuid?: string } = { uuid: "a", ticket_uuid: "t-1" };
    const flat = flattenBuckets({ 3: { "t-1": [log] } });
    expect(flat["t-1"]![0]).toBe(log);
  });
});
