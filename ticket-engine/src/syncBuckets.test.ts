import { describe, it, expect } from "vitest";
import {
  NUM_BUCKETS,
  fastHashUuid,
  packBucketHash,
  bucketForTicket,
  buildBuckets,
  buildBucketHashes,
  buildTicketDigests,
  chunkBucketsForUpload,
  flattenBuckets,
  getDirtyBuckets,
  adoptDeliveredHashes,
  type BucketMap,
  type BucketHashes,
} from "./syncBuckets.js";

/** Log shape only needs `uuid` for bucket hashing. */
type Log = { uuid: string };

// Golden values computed from the Go implementation
// (`omni/src/services/bucket/hashing_test.go`) so the TS clients can never
// silently drift from the server's `FastHashUuid` / `PackBucketHash` /
// `bucketForTicket`. Both files pin the same numbers.
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
  // 20,000-uuid safety corpus (splitmix32, seed 0x12345678 — mirrors Go
  // makeSafetyCorpus). Identical stream in both languages.
  safety: {
    first: "b1fb5107-2c5f-4fd8-afaf-8367a78b935c",
    firstHash: 2178313897,
    last: "bffe71b0-0fab-4f38-bdcf-267b1c0081de",
    lastHash: 3703842988,
  },
  // Per-ticket digests — PackBucketHash(log count, XOR of fastHashUuid over
  // the group's log uuids), Phase 2 of sync-payload-reduction.md. Pinned in
  // BOTH languages: this table and `omni/src/services/bucket/ticket_digest_test.go`.
  digest: {
    // pack(1, h(550e…))
    one: 6587036968,
    // pack(2, h(550e…)^h(6ba7…))
    two: 10629861400,
    // pack(3, h(550e…)^h(6ba7…)^h(a4d2…))
    three: 16619993228,
    // pack(4, …^h(606b…))
    four: 17716189417,
    // pack(2, h(a4d2…)^h(606b…)) — the 2026-10-09 incident pair
    incidentPair: 10307586289,
  },
};

/** splitmix32 uuid stream — must equal Go's makeSafetyCorpus byte for byte. */
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

describe("parity with Go bucket hashing", () => {
  it("fastHashUuid matches Go FastHashUuid golden values", () => {
    for (const [uuid, expected] of Object.entries(GOLDEN.fast)) {
      expect(fastHashUuid(uuid)).toBe(expected);
    }
  });

  it("bucketForTicket matches Go bucketForTicket golden values", () => {
    for (const [uuid, expected] of Object.entries(GOLDEN.bucket)) {
      expect(bucketForTicket(uuid)).toBe(expected);
    }
  });

  it("buildBucketHashes packs (count, xor) exactly like Go PackBucketHash", () => {
    // One log: packed = count<<32 | xor, never the raw folded hash.
    const u = "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz";
    const hashes = buildBucketHashes({ 0: { t: [{ uuid: u }] } });
    expect(hashes[0]).toBe(packBucketHash(1, fastHashUuid(u)));
    expect(hashes[0]).toBeGreaterThan(0xffffffff);
  });
});

describe("buildTicketDigests (Phase 2 ticket_digests parity with Go)", () => {
  const U1 = "550e8400-e29b-41d4-a716-446655440000";
  const U2 = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
  const U3 = "a4d24005-0d66-454d-a661-3141f155cc20";
  const U4 = "606bd2a4-3885-41dc-9829-3cd4f4c80eef";

  /** Group logs into a bucket map the way buildBuckets does. */
  const group = (logs: Log[], bucket = 0): BucketMap<Log> => ({
    [bucket]: { "ticket-1": logs },
  });

  it("matches the Go golden vectors (ticket_digest_test.go)", () => {
    expect(buildTicketDigests(group([{ uuid: U1 }]))["ticket-1"]).toBe(
      GOLDEN.digest.one,
    );
    expect(
      buildTicketDigests(group([{ uuid: U1 }, { uuid: U2 }]))["ticket-1"],
    ).toBe(GOLDEN.digest.two);
    expect(
      buildTicketDigests(group([{ uuid: U1 }, { uuid: U2 }, { uuid: U3 }]))[
        "ticket-1"
      ],
    ).toBe(GOLDEN.digest.three);
    expect(
      buildTicketDigests(
        group([{ uuid: U1 }, { uuid: U2 }, { uuid: U3 }, { uuid: U4 }]),
      )["ticket-1"],
    ).toBe(GOLDEN.digest.four);
    expect(
      buildTicketDigests(group([{ uuid: U3 }, { uuid: U4 }]))["ticket-1"],
    ).toBe(GOLDEN.digest.incidentPair);
  });

  it("is order-independent and count-sensitive", () => {
    const forward = buildTicketDigests(
      group([{ uuid: U1 }, { uuid: U2 }, { uuid: U3 }]),
    );
    const reverse = buildTicketDigests(
      group([{ uuid: U3 }, { uuid: U2 }, { uuid: U1 }]),
    );
    expect(forward).toEqual(reverse);

    // h ^ h cancels in the XOR — the count component must still flip the
    // digest so a divergent ticket can never look identical (the incident
    // class, one level down).
    const base = buildTicketDigests(group([{ uuid: U1 }, { uuid: U2 }]));
    const withPair = buildTicketDigests(
      group([{ uuid: U1 }, { uuid: U2 }, { uuid: U3 }, { uuid: U3 }]),
    );
    expect(withPair["ticket-1"]).not.toBe(base["ticket-1"]);
  });

  it("covers every non-empty ticket across all buckets and never emits 0", () => {
    const buckets: BucketMap<Log> = {
      3: { a: [{ uuid: U1 }], b: [] },
      9: { c: [{ uuid: U2 }, { uuid: U3 }] },
      12: {},
    };
    const digests = buildTicketDigests(buckets);

    expect(Object.keys(digests).sort()).toEqual(["a", "c"]);
    expect(digests["a"]).toBe(GOLDEN.digest.one);
    expect(digests["c"]).toBe(
      packBucketHash(2, fastHashUuid(U2) ^ fastHashUuid(U3)),
    );
    for (const v of Object.values(digests)) expect(v).toBeGreaterThan(0);
  });

  it("empty buckets and empty groups contribute nothing (absent ⇒ server ships)", () => {
    expect(buildTicketDigests({})).toEqual({});
    expect(buildTicketDigests({ 0: { t: [] } })).toEqual({});
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

describe("chunkBucketsForUpload", () => {
  it("returns [] for an empty map (caller sends one buckets:{} request)", () => {
    expect(chunkBucketsForUpload({})).toEqual([]);
  });

  it("returns a single chunk equal to the input when under maxBytes", () => {
    const buckets: BucketMap<Log> = {
      0: { t1: [{ uuid: "a" }, { uuid: "b" }] },
    };
    const chunks = chunkBucketsForUpload(buckets, 8 * 1024 * 1024);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(buckets);
  });

  it("splits oversized maps into chunks that each fit maxBytes", () => {
    const logs = Array.from({ length: 200 }, (_, i) => ({
      uuid: `uuid-${String(i).padStart(6, "0")}-${"x".repeat(60)}`,
    }));
    const buckets: BucketMap<Log> = { 3: { "ticket-0001": logs } };

    const maxBytes = 2048;
    const chunks = chunkBucketsForUpload(buckets, maxBytes);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(JSON.stringify(chunk).length).toBeLessThanOrEqual(maxBytes);
    }
  });

  it("preserves every log exactly once across chunks", () => {
    const buckets: BucketMap<Log> = {
      1: { t1: [{ uuid: "a" }, { uuid: "b" }] },
      7: { t2: [{ uuid: "c" }], t3: [{ uuid: "d" }, { uuid: "e" }] },
    };

    const chunks = chunkBucketsForUpload(buckets, 60);
    const seen = chunks
      .flatMap((c) => Object.values(c))
      .flatMap((ticketMap) => Object.values(ticketMap))
      .flatMap((logs) => logs)
      .map((l) => l.uuid)
      .sort();

    expect(seen).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("is deterministic — same input produces identical chunks", () => {
    const buckets: BucketMap<Log> = {
      2: { t1: [{ uuid: "x" }] },
      5: { t2: [{ uuid: "y" }] },
    };
    expect(chunkBucketsForUpload(buckets, 40)).toEqual(
      chunkBucketsForUpload(buckets, 40),
    );
  });

  it("strips ticket_uuid + location_group_uuid (Phase 3 wire cut) without mutating the input", () => {
    type WireLog = Log & {
      ticket_uuid?: string;
      location_group_uuid?: string;
      action?: string;
    };
    const log: WireLog = {
      uuid: "a",
      ticket_uuid: "t1",
      location_group_uuid: "lg-1",
      action: "ADD_ITEM",
    };
    const buckets: BucketMap<WireLog> = { 0: { t1: [log] } };

    const chunks = chunkBucketsForUpload(buckets);
    expect(chunks).toHaveLength(1);
    const sent = chunks[0]![0]!["t1"]![0]!;
    expect(sent).toEqual({ uuid: "a", action: "ADD_ITEM" });
    expect("ticket_uuid" in sent).toBe(false);
    expect("location_group_uuid" in sent).toBe(false);
    // The caller's copy keeps both fields (hashes/digests already computed,
    // and the same rows may feed a P2P send later).
    expect(log.ticket_uuid).toBe("t1");
    expect(log.location_group_uuid).toBe("lg-1");
    expect(buckets[0]!["t1"]![0]).toBe(log);
  });

  it("passes logs that already lack the fields through unchanged (same object)", () => {
    const log: Log = { uuid: "a" };
    const chunks = chunkBucketsForUpload({ 0: { t1: [log] } });
    expect(chunks[0]![0]!["t1"]![0]).toBe(log);
  });
});

describe("flattenBuckets (Phase 3: ticket_uuid re-injected from the map key)", () => {
  it("re-injects ticket_uuid when the wire log omits it", () => {
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

  it("passes logs that already carry ticket_uuid through untouched", () => {
    const log: Log & { ticket_uuid?: string } = { uuid: "a", ticket_uuid: "t-1" };
    const flat = flattenBuckets({ 3: { "t-1": [log] } });
    expect(flat["t-1"]![0]).toBe(log);
  });
});

describe("adoptDeliveredHashes (SYNC-PULL-PAGING.md rules 3–5)", () => {
  // Packed-style stand-in hashes (any distinct numbers work — adoption is
  // equality logic, not hashing).
  const H = { a: 9001, b: 9002, c: 9003, z: 9009 };

  it("adopts delivered buckets and clean (equal) buckets, keeps the rest", () => {
    const prev: BucketHashes = { 0: 111, 1: 222, 2: 333 };
    const current: BucketHashes = { 0: 111, 1: 555, 2: 666, 3: H.b };
    const server: BucketHashes = { 0: 111, 1: H.a, 2: H.c, 3: H.b };

    const next = adoptDeliveredHashes(prev, current, server, [1]);

    // 0: clean (current === server) → adopt (same value).
    expect(next[0]).toBe(111);
    // 1: delivered → server's hash wins over the stale baseline.
    expect(next[1]).toBe(H.a);
    // 2: dirty (current ≠ server) and undelivered → previous baseline
    //    preserved so the bucket stays dirty and resumes via the cursor.
    expect(next[2]).toBe(333);
    // 3: NOT delivered but current === server → clean, self-adopts.
    expect(next[3]).toBe(H.b);
  });

  it("keeps a dirty undelivered bucket's baseline so the cursor can resume", () => {
    const prev: BucketHashes = { 5: 42 };
    const next = adoptDeliveredHashes(prev, { 5: 777 }, { 5: H.c }, []);
    expect(next[5]).toBe(42);
  });

  it("deletes baseline entries when the server reports a bucket as empty (0)", () => {
    const prev: BucketHashes = { 4: 1234 };
    // Delivered but server hash 0 (e.g. dirty-only-client-logs bucket) →
    // adopt "server has nothing" by dropping the entry.
    const next = adoptDeliveredHashes(prev, { 4: 1234 }, {}, [4]);
    expect(4 in next).toBe(false);
  });

  it("treats absent keys as 0 on every map (clean empty bucket self-adopts)", () => {
    const prev: BucketHashes = { 9: 55 };
    // Client pruned its last bucket-9 log → current 0; server also 0 → clean.
    const next = adoptDeliveredHashes(prev, {}, {}, []);
    expect(9 in next).toBe(false);
  });

  it("never mutates the inputs", () => {
    const prev: BucketHashes = { 0: 1 };
    const current: BucketHashes = { 0: 2 };
    const server: BucketHashes = { 0: 3 };
    adoptDeliveredHashes(prev, current, server, [0]);
    expect(prev).toEqual({ 0: 1 });
    expect(current).toEqual({ 0: 2 });
    expect(server).toEqual({ 0: 3 });
  });
});
