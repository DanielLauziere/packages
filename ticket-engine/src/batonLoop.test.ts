import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  CHAIN_SEED_SQL,
  PRINT_ROWS_SQL,
  parsePrintPayload,
  mapPrintRows,
  readPrintFold,
  runBatonPrint,
  manualTakeover,
  seedDeviceOf,
  _resetBatonSendStateForTests,
  type BatonDeps,
} from "./batonLoop.js";
import type { PrintRow } from "./printProtocol.js";
import { PRINT_ALERT_MS, PRINT_FAILED, PRINT_REASON_STRANDED, PRINT_SPINNER_FAIL_MS, PRINT_SUCCESS, foldPrintBaton } from "./printProtocol.js";

// The ticket's creating device comes from its FIRST log row (any action) —
// the chain[0] seed
// (backlog item 4). `admin-1` is the acting admin on every row; `dev-1` /
// `dev-2` are the distinct devices signed in on that same admin.
const DEVICE_A = "dev-1";
const DEVICE_B = "dev-2";

const TICKET = {
  uuid: "t-1",
  admin_uuid: "admin-1",
  location_group_uuid: "lg-1",
  time_stamp: 0,
};

function makeDeps(
  over: Partial<BatonDeps<typeof TICKET, object, { uuid: string }>> = {},
  deviceId: string = DEVICE_A,
  observedAt?: number,
) {
  const appendLog = vi.fn(async (_input: any) => {});
  const printTicket = vi.fn(async (_args: any) => true);
  const getPrintRows = vi.fn(async (_uuid: string): Promise<PrintRow[]> => []);
  const getChainSeedRow = vi.fn(async (_uuid: string): Promise<PrintRow | null> => null);
  // Per-device ordinal (Phase 2): a fresh counter per makeDeps, mirroring a
  // device's persisted `print_seq` key.
  let seq = 0;
  // Phase 3: local observation times — a map keyed by ticket, set once. When
  // `observedAt` is given, the FIRST observation of any ticket returns that
  // pinned value (the caller is pinning when this device first saw the state);
  // otherwise the first observation is `Date.now()`.
  const observed = new Map<string, number>();
  const observe = (ticket_uuid: string) => {
    const existing = observed.get(ticket_uuid);
    if (existing) return existing;
    const now = observedAt ?? Date.now();
    observed.set(ticket_uuid, now);
    return now;
  };
  const deps: BatonDeps<typeof TICKET, object, { uuid: string }> = {
    getPrintRows,
    getChainSeedRow,
    appendLog,
    getServerOffset: async () => 0,
    deviceUuid: () => deviceId,
    nextPrintSeq: async () => ++seq,
    observeRequest: (ticket_uuid: string) => observe(ticket_uuid),
    observeCreatorStrand: (ticket_uuid: string) => observe(ticket_uuid),
    isKitchenCapable: () => true,
    printTicket,
    ...over,
  };
  return { deps, appendLog, printTicket, getPrintRows, getChainSeedRow };
}

// The ticket's first log row (any action) is the chain[0] seed. Callers set
// it explicitly because getPrintRows in these tests is the full row set.
function seedCreatorRow(device: string, timeStamp = 1) {
  return { action: "ADD_ITEM", author: "admin-1", time_stamp: timeStamp, payload: { device_id: device } };
}

const args = {
  ticket: TICKET,
  locationGroup: {},
  admin: { uuid: "admin-1" },
  translations: [],
};

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(100_000);
  // The loop keeps per-ticket send-failure state in module Maps; a prior
  // test's cooldown would otherwise leak into later ones.
  _resetBatonSendStateForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PRINT_ROWS_SQL / mapPrintRows / parsePrintPayload", () => {
  it("selects the five PRINT_* actions ordered by time_stamp, uuid", () => {
    expect(PRINT_ROWS_SQL).toContain("PRINT_SUCCESS");
    expect(PRINT_ROWS_SQL).toContain("PRINT_REASSIGN");
    expect(PRINT_ROWS_SQL).toContain("PRINT_FAILED");
    expect(PRINT_ROWS_SQL).toContain('ORDER BY "time_stamp", uuid');
  });

  it("maps raw rows: author from admin_uuid, device from payload, parsed payload", () => {
    const rows = mapPrintRows([
      {
        action: "PRINT_PASS",
        payload: '{"reason":"print_failed","device_id":"dev-1"}',
        time_stamp: "123",
        admin_uuid: "admin-1",
      },
      {
        action: "PRINT_REQUEST",
        payload: null,
        time_stamp: 456,
        admin_uuid: null,
      },
    ]);
    expect(rows).toEqual([
      {
        action: "PRINT_PASS",
        author: "admin-1",
        time_stamp: 123,
        payload: { reason: "print_failed", device_id: "dev-1" },
        device_id: "dev-1",
        seq: null,
      },
      {
        action: "PRINT_REQUEST",
        author: null,
        time_stamp: 456,
        payload: {},
        device_id: null,
        seq: null,
      },
    ]);
  });

  it("parsePrintPayload tolerates null / object / invalid", () => {
    expect(parsePrintPayload(null)).toEqual({});
    const obj = { a: 1 };
    expect(parsePrintPayload(obj as any)).toBe(obj);
    expect(parsePrintPayload("{bad")).toEqual({});
  });

  it("readPrintFold seeds chain[0] from the first row's device, not the admin", async () => {
    const rows: PrintRow[] = [
      { action: PRINT_SUCCESS, author: "admin-1", time_stamp: 1, payload: { device_id: DEVICE_A } },
    ];
    const { fold, rows: out } = await readPrintFold(
      async () => rows,
      TICKET,
      async () => rows[0]!,
    );
    expect(out).toBe(rows);
    expect(fold.terminal).toBe(true);
    // The holder is the acting device, not the admin.
    expect(fold.holder).toBe(DEVICE_A);
  });

  it("readPrintFold: a ticket with no rows (guest/legacy) seeds null", async () => {
    const rows: PrintRow[] = [
      { action: "PRINT_PASS", author: null, time_stamp: 1, payload: {} },
    ];
    const { fold } = await readPrintFold(
      async () => rows,
      TICKET,
      async () => null,
    );
    expect(fold.holder).toBeNull();
  });

  it("mapPrintRows(null) maps to an empty list", () => {
    // Defensive null tolerance on the driver result (rows ?? []).
    expect(mapPrintRows(null as any)).toEqual([]);
  });

  it("seedDeviceOf prefers the row's device, then payload.device_id, then the author", () => {
    expect(seedDeviceOf(null)).toBeNull();
    // Legacy rows (pre device-identity change) carry no device at all.
    expect(
      seedDeviceOf({ action: "ADD_ITEM", author: "admin-1", time_stamp: 1, payload: {} }),
    ).toBe("admin-1");
    expect(
      seedDeviceOf({
        action: "ADD_ITEM",
        author: "admin-1",
        time_stamp: 1,
        payload: { device_id: DEVICE_B },
      }),
    ).toBe(DEVICE_B);
    expect(
      seedDeviceOf({
        action: "ADD_ITEM",
        author: "admin-1",
        time_stamp: 1,
        device_id: DEVICE_A,
        payload: { device_id: DEVICE_B },
      }),
    ).toBe(DEVICE_A);
  });
});

describe("CHAIN_SEED_SQL — the chain[0] seed row", () => {
  function makeDb() {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE ticket_log (
        uuid TEXT PRIMARY KEY,
        ticket_uuid TEXT,
        action TEXT,
        payload TEXT,
        time_stamp INTEGER,
        admin_uuid TEXT
      )
    `);
    return db;
  }

  it("returns the first row of ANY action (a non-print seed with device_id)", () => {
    const db = makeDb();
    const insert = db.prepare(
      `INSERT INTO ticket_log (uuid, ticket_uuid, action, payload, time_stamp, admin_uuid)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    // The ticket's first log row is a status completion carrying the creating
    // device; the PRINT_* rows only arrive later.
    insert.run(
      "r-1",
      "t-1",
      "SET_STATUS_COMPLETE",
      JSON.stringify({ device_id: DEVICE_A }),
      100,
      "admin-1",
    );
    insert.run(
      "r-2",
      "t-1",
      "PRINT_PASS",
      JSON.stringify({ reason: "stranded", device_id: DEVICE_B }),
      200,
      "admin-1",
    );
    insert.run(
      "r-3",
      "t-1",
      "PRINT_FAILED",
      JSON.stringify({ device_id: DEVICE_B }),
      300,
      "admin-1",
    );

    const seed = db.prepare(CHAIN_SEED_SQL).get("t-1");
    expect(seed.action).toBe("SET_STATUS_COMPLETE");
    // …and it maps straight into the fold's seed device.
    const mapped = mapPrintRows([seed]);
    expect(mapped[0]).toEqual({
      action: "SET_STATUS_COMPLETE",
      author: "admin-1",
      time_stamp: 100,
      payload: { device_id: DEVICE_A },
      device_id: DEVICE_A,
      seq: null,
    });
    expect(seedDeviceOf(mapped[0]!)).toBe(DEVICE_A);

    // PRINT_ROWS_SQL filters to the print actions (incl. PRINT_FAILED): it
    // cannot see the seed.
    const printRows = db.prepare(PRINT_ROWS_SQL).all("t-1");
    expect(printRows.map((r: any) => r.action)).toEqual([
      "PRINT_PASS",
      "PRINT_FAILED",
    ]);
    db.close();
  });

  it("selects one row ordered by time_stamp,uuid with no action filter", () => {
    expect(CHAIN_SEED_SQL).not.toContain("action IN");
    expect(CHAIN_SEED_SQL).toContain('ORDER BY "time_stamp", uuid');
    expect(CHAIN_SEED_SQL).toContain("LIMIT 1");
  });
});

describe("runBatonPrint", () => {
  it("creator + capable + no rows → send → printed", async () => {
    // The ticket's first log row (ADD_ITEM) carries the creating device —
    // that is the chain[0] seed.
    const { deps, appendLog, printTicket } = makeDeps(
      { getChainSeedRow: async () => seedCreatorRow(DEVICE_A) },
      DEVICE_A,
    );
    const result = await runBatonPrint(deps, args);
    expect(result).toEqual({ outcome: "printed" });
    expect(printTicket).toHaveBeenCalledTimes(1);
    // The baton's idempotent-retry marker is the ticket uuid — the relay
    // dedupes a retried send after a lost response (backlog item 3).
    expect(printTicket.mock.calls[0]![0]).toMatchObject({ job_id: "t-1" });
    expect(appendLog).toHaveBeenCalledTimes(1);
    expect(appendLog.mock.calls[0]![0]).toMatchObject({
      action: PRINT_SUCCESS,
      admin_uuid: "admin-1",
      ticket_uuid: "t-1",
      location_group_uuid: "lg-1",
    });
  });

  it("send failure hands over immediately: PRINT_PASS stranded, no retry", async () => {
    const { deps, appendLog, printTicket } = makeDeps(
      { getChainSeedRow: async () => seedCreatorRow(DEVICE_A) },
      DEVICE_A,
    );
    printTicket.mockResolvedValueOnce(false);
    const result = await runBatonPrint(deps, args);
    // Failover (item 9): one refused send → a `stranded` pass that opens the
    // floor. The device does not retry itself.
    expect(result.outcome).toBe("advanced");
    expect(printTicket).toHaveBeenCalledTimes(1);
    expect(appendLog).toHaveBeenCalledTimes(1);
    expect(appendLog.mock.calls[0]![0]).toMatchObject({
      action: "PRINT_PASS",
      payload: { reason: PRINT_REASON_STRANDED },
    });
  });

  it("terminal fold stand-downs as printed without sending", async () => {
    const { deps, appendLog, printTicket } = makeDeps({
      getPrintRows: async () => [
        { action: PRINT_SUCCESS, author: "admin-1", time_stamp: 1, payload: { device_id: DEVICE_A } },
      ],
    });
    const result = await runBatonPrint(deps, args);
    expect(result).toEqual({ outcome: "printed" });
    expect(printTicket).not.toHaveBeenCalled();
    expect(appendLog).not.toHaveBeenCalled();
  });

  it("waiter past its own request's alert window gets outcome alert", async () => {
    // Phase 3: the window is measured from THIS device's first local
    // observation of its own request — pinned here 61 s ago — never from the
    // request row's foreign `time_stamp`.
    const { deps } = makeDeps(
      {
        getPrintRows: async () => [
          { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { device_id: DEVICE_A } },
          { action: "PRINT_REQUEST", author: "admin-2", time_stamp: 2000, payload: { device_id: DEVICE_B } },
        ],
        getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
        isKitchenCapable: () => true,
      },
      DEVICE_B,
      100_000 - PRINT_ALERT_MS - 1,
    );
    const result = await runBatonPrint(deps, {
      ...args,
      admin: { uuid: "admin-2" },
    });
    expect(result).toEqual({ outcome: "alert" });
  });

  it("non-capable creator passes the baton", async () => {
    const { deps, appendLog, printTicket } = makeDeps({
      isKitchenCapable: () => false,
      getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
    });
    const result = await runBatonPrint(deps, args);
    expect(printTicket).not.toHaveBeenCalled();
    expect(appendLog.mock.calls[0]![0]).toMatchObject({
      action: "PRINT_PASS",
      payload: { reason: "not_capable" },
    });
    expect(result.outcome).toBe("advanced");
  });

  it("original device (creator) sees alert when >60 s, reassign attempted, no success", async () => {
    // Creator admin-1 is not capable (location group silent_print off → the
    // client reports capable=false), passes, then reassigns to admin-2 who
    // also can't print. Ticket created >60s ago. The original device
    // (admin-1) should get outcome 'alert'.
    const observedAt = 100_000 - PRINT_ALERT_MS - 1; // >60s before now
    const { deps } = makeDeps({
      isKitchenCapable: () => false,
      getPrintRows: async () => [
        { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { device_id: DEVICE_A } },
        { action: "PRINT_REQUEST", author: "admin-2", time_stamp: 2000, payload: { device_id: DEVICE_B } },
        { action: "PRINT_REASSIGN", author: "admin-1", time_stamp: 3000, payload: { to: DEVICE_B, device_id: DEVICE_A } },
      ],
      getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
    }, DEVICE_A, observedAt);
    const result = await runBatonPrint(deps, {
      ...args,
      admin: { uuid: "admin-1" },
    });
    expect(result.outcome).toBe("alert");
  });

  it("original device sees alert on local print failure alone (no reassign), >60 s, no success", async () => {
    // Creator admin-1 tried to print, transport refused (PRINT_PASS
    // print_failed). No other device requested, no reassign. After 60s
    // the original device should get the alert.
    const observedAt = 100_000 - PRINT_ALERT_MS - 1;
    const { deps } = makeDeps({
      isKitchenCapable: () => false,
      getPrintRows: async () => [
        { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { reason: "print_failed", device_id: DEVICE_A } },
      ],
      getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
    }, DEVICE_A, observedAt);
    const result = await runBatonPrint(deps, {
      ...args,
      admin: { uuid: "admin-1" },
    });
    expect(result.outcome).toBe("alert");
    expect(deps.appendLog).not.toHaveBeenCalled();
    expect(deps.printTicket).not.toHaveBeenCalled();
  });

  it("original device sees alert after its one failed send wrote a stranded pass", async () => {
    // Failover (item 9): the creator's send was refused, so it wrote a
    // `stranded` pass (not print_failed). With no peer capable the fold ends
    // stranded; after 60 s the creator must still get the alert.
    const observedAt = 100_000 - PRINT_ALERT_MS - 1;
    const { deps } = makeDeps({
      isKitchenCapable: () => false,
      getPrintRows: async () => [
        { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { reason: PRINT_REASON_STRANDED, device_id: DEVICE_A } },
      ],
      getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
    }, DEVICE_A, observedAt);
    const result = await runBatonPrint(deps, {
      ...args,
      admin: { uuid: "admin-1" },
    });
    expect(result.outcome).toBe("alert");
    expect(deps.appendLog).not.toHaveBeenCalled();
    expect(deps.printTicket).not.toHaveBeenCalled();
  });

  it("creator reassigns to a waiting requester even when its strand window already elapsed", async () => {
    // Never-print regression: the creator's send was refused (stranded pass)
    // and a capable peer's PRINT_REQUEST arrived ≥60 s after the creator's
    // first observation (slow sync round trip). The alert must not block the
    // chain: the loop appends PRINT_REASSIGN{to: requester} first — only
    // afterwards, as the ex-holder, does the creator surface its alert.
    const observedAt = 100_000 - PRINT_ALERT_MS - 1;
    const passRow = { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { reason: PRINT_REASON_STRANDED, device_id: DEVICE_A } };
    const requestRow = { action: "PRINT_REQUEST", author: "admin-2", time_stamp: 2000, payload: { device_id: DEVICE_B } };
    const reassignRow = { action: "PRINT_REASSIGN", author: "admin-1", time_stamp: 3000, payload: { to: DEVICE_B, device_id: DEVICE_A } };
    const appended: any[] = [];
    const appendLog = vi.fn(async (input: any) => {
      appended.push(input);
    });
    const { deps, printTicket } = makeDeps({
      isKitchenCapable: () => true,
      appendLog,
      // Mirror the real DB: rows this device appends become visible to the
      // loop's next iteration.
      getPrintRows: async () =>
        appended.some((i) => i.action === "PRINT_REASSIGN")
          ? [passRow, requestRow, reassignRow]
          : [passRow, requestRow],
      getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
    }, DEVICE_A, observedAt);
    const result = await runBatonPrint(deps, {
      ...args,
      admin: { uuid: "admin-1" },
    });
    // The handoff happened: exactly one REASSIGN to the waiting requester.
    expect(appendLog).toHaveBeenCalledTimes(1);
    expect(appendLog.mock.calls[0][0]).toMatchObject({
      action: "PRINT_REASSIGN",
      payload: expect.objectContaining({ to: DEVICE_B, device_id: DEVICE_A }),
    });
    expect(printTicket).not.toHaveBeenCalled();
    // Post-handoff the creator is the ex-holder: its (!) surface shows until
    // a SUCCESS lands (pinned by decidePrint's creator-alert rule).
    expect(result.outcome).toBe("alert");
  });

  it("original device with local print failure <60 s arms alertInMs timer", async () => {
    const observedAt = 100_000 - 30_000;
    const { deps } = makeDeps({
      isKitchenCapable: () => false,
      getPrintRows: async () => [
        { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { reason: "print_failed", device_id: DEVICE_A } },
      ],
      getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
    }, DEVICE_A, observedAt);
    const result = await runBatonPrint(deps, {
      ...args,
      admin: { uuid: "admin-1" },
    });
    expect(result.outcome).toBe("waiting");
    expect(result.alertInMs).toBeGreaterThan(0);
    expect(result.alertInMs).toBeLessThanOrEqual(PRINT_ALERT_MS);
  });

  it("original device arms alertInMs timer before the 60 s window fires", async () => {
    // Phase 3: the strand window starts at this device's first local
    // observation (pinned 30 s ago) — not at any row's stamp.
    const observedAt = 100_000 - 30_000;
    const { deps } = makeDeps(
      {
        isKitchenCapable: () => false,
        getPrintRows: async () => [
          { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { device_id: DEVICE_A } },
          { action: "PRINT_REQUEST", author: "admin-2", time_stamp: 2000, payload: { device_id: DEVICE_B } },
          { action: "PRINT_REASSIGN", author: "admin-1", time_stamp: 3000, payload: { to: DEVICE_B, device_id: DEVICE_A } },
        ],
        getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
      },
      DEVICE_A,
      observedAt,
    );
    const result = await runBatonPrint(deps, {
      ...args,
      admin: { uuid: "admin-1" },
    });
    expect(result.outcome).toBe("waiting");
    expect(result.alertInMs).toBe(30_000); // armed from local observation, not the row stamps
  });

  it("conflicted fold → outcome conflict, nothing appended", async () => {
    // A PRINT_PASS authored by a non-holder (DEVICE_B) folds to
    // PASS_FROM_NON_HOLDER → decidePrint 'attention' → 'conflict'.
    const { deps, appendLog, printTicket } = makeDeps(
      {
        getPrintRows: async () => [
          { action: "PRINT_PASS", author: "admin-2", time_stamp: 1000, payload: { device_id: DEVICE_B } },
        ],
        getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
      },
      DEVICE_A,
    );
    const result = await runBatonPrint(deps, args);
    expect(result).toEqual({ outcome: "conflict" });
    // A conflict must never mutate the log — the row that fixes the divergence
    // is written by a human, not by the loop.
    expect(appendLog).not.toHaveBeenCalled();
    expect(printTicket).not.toHaveBeenCalled();
  });

  describe("appendPrintLog stamps payload.device_id on every baton row (item 4)", () => {
    it("PRINT_SUCCESS", async () => {
      const { deps, appendLog } = makeDeps(
        { getChainSeedRow: async () => seedCreatorRow(DEVICE_A) },
        DEVICE_A,
      );
      const result = await runBatonPrint(deps, args);
      expect(result).toEqual({ outcome: "printed" });
      expect(appendLog).toHaveBeenCalledTimes(1);
      const written = appendLog.mock.calls[0]![0];
      expect(written.action).toBe(PRINT_SUCCESS);
      // Phase 2: the per-device ordinal rides the payload beside device_id.
      expect(written.payload).toEqual({ device_id: DEVICE_A, seq: 1 });
      expect(written.admin_uuid).toBe("admin-1"); // admin stays the admin
    });

    it("PRINT_PASS", async () => {
      const { deps, appendLog } = makeDeps(
        { isKitchenCapable: () => false, getChainSeedRow: async () => seedCreatorRow(DEVICE_A) },
        DEVICE_A,
      );
      await runBatonPrint(deps, args);
      expect(appendLog.mock.calls[0]![0]).toMatchObject({
        action: "PRINT_PASS",
        payload: { reason: "not_capable", device_id: DEVICE_A, seq: 1 },
      });
      for (const [written] of appendLog.mock.calls) {
        expect(written.payload.device_id).toBe(DEVICE_A);
      }
    });

    it("PRINT_REQUEST", async () => {
      const { deps, appendLog } = makeDeps(
        {
          getPrintRows: async () => [
            { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { reason: PRINT_REASON_STRANDED, device_id: DEVICE_A } },
          ],
          getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
        },
        DEVICE_B,
      );
      await runBatonPrint(deps, { ...args, admin: { uuid: "admin-2" } });
      expect(appendLog.mock.calls[0]![0]).toMatchObject({
        action: "PRINT_REQUEST",
        payload: { device_id: DEVICE_B },
      });
      for (const [written] of appendLog.mock.calls) {
        expect(written.payload.device_id).toBe(DEVICE_B);
      }
    });

    it("PRINT_REASSIGN", async () => {
      const { deps, appendLog } = makeDeps(
        {
          getPrintRows: async () => [
            { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { reason: PRINT_REASON_STRANDED, device_id: DEVICE_A } },
            { action: "PRINT_REQUEST", author: "admin-2", time_stamp: 2000, payload: { device_id: DEVICE_B } },
          ],
          getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
        },
        DEVICE_A,
      );
      await runBatonPrint(deps, args);
      expect(appendLog.mock.calls[0]![0]).toMatchObject({
        action: "PRINT_REASSIGN",
        payload: { to: DEVICE_B, device_id: DEVICE_A },
      });
      for (const [written] of appendLog.mock.calls) {
        expect(written.payload.device_id).toBe(DEVICE_A);
      }
    });

    it("the manualTakeover PRINT_SUCCESS", async () => {
      const { deps, appendLog } = makeDeps({}, DEVICE_A);
      const ok = await manualTakeover(deps, TICKET, { uuid: "admin-1" });
      expect(ok).toBe(true);
      expect(appendLog).toHaveBeenCalledTimes(1);
      expect(appendLog.mock.calls[0]![0]).toMatchObject({
        action: PRINT_SUCCESS,
        payload: { manual: true, device_id: DEVICE_A },
      });
    });
  });

  it("a throwing transport logs the error and writes a stranded pass — no retry", async () => {
    const logError = vi.fn();
    const { deps, appendLog, printTicket } = makeDeps(
      { getChainSeedRow: async () => seedCreatorRow(DEVICE_A), logError },
      DEVICE_A,
    );
    printTicket.mockRejectedValueOnce(new Error("transport down"));
    const result = await runBatonPrint(deps, args);
    // Same failover as a refused send: caught, logged, stranded pass, done.
    expect(result).toEqual({ outcome: "advanced" });
    expect(printTicket).toHaveBeenCalledTimes(1); // never retried
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith("❌ Print failed t-1", expect.any(Error));
    expect(appendLog).toHaveBeenCalledTimes(1);
    expect(appendLog.mock.calls[0]![0]).toMatchObject({
      action: "PRINT_PASS",
      payload: { reason: PRINT_REASON_STRANDED, device_id: DEVICE_A },
    });
  });

  it("without a custom logError the default console.error sink receives the failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = makeDeps(
      {
        getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
        printTicket: vi.fn(async () => {
          throw new Error("transport down");
        }),
      },
      DEVICE_A,
    );
    const result = await runBatonPrint(deps, args);
    expect(result.outcome).toBe("advanced");
    expect(spy).toHaveBeenCalledWith("❌ Print failed t-1", expect.any(Error));
    spy.mockRestore();
  });

  it("a pending PRINT_REQUEST inside its 60 s window arms alertInMs from my request time", async () => {
    // Phase 3: "my request time" is this device's first local observation of
    // its own request (pinned 5 s ago), never the request row's stamp.
    const { deps, appendLog } = makeDeps(
      {
        getPrintRows: async () => [
          { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { device_id: DEVICE_A } },
          { action: "PRINT_REQUEST", author: "admin-2", time_stamp: 95_000, payload: { device_id: DEVICE_B } },
        ],
        getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
      },
      DEVICE_B,
      95_000,
    );
    const result = await runBatonPrint(deps, { ...args, admin: { uuid: "admin-2" } });
    // now = Date.now() = 100_000; observed 5 s ago → 55 s until it strands.
    expect(result).toEqual({ outcome: "waiting", alertInMs: 55_000 });
    expect(appendLog).not.toHaveBeenCalled();
  });

  it("a non-zero getServerOffset shifts the pending-request alert window", async () => {
    const { deps } = makeDeps(
      {
        getServerOffset: async () => 10_000,
        getPrintRows: async () => [
          { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { device_id: DEVICE_A } },
          { action: "PRINT_REQUEST", author: "admin-2", time_stamp: 60_000, payload: { device_id: DEVICE_B } },
        ],
        getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
      },
      DEVICE_B,
      60_000,
    );
    const result = await runBatonPrint(deps, { ...args, admin: { uuid: "admin-2" } });
    // Observed 60 s ago (local); now = Date.now() + 10_000 = 110_000 →
    // alertInMs = 60_000 + 60_000 − 110_000. With offset 0 it would be 20_000.
    expect(result).toEqual({ outcome: "waiting", alertInMs: 10_000 });
  });

  it("a positive server offset can tip a pending request over the alert window", async () => {
    const { deps } = makeDeps(
      {
        getServerOffset: async () => 10_000,
        getPrintRows: async () => [
          { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { device_id: DEVICE_A } },
          { action: "PRINT_REQUEST", author: "admin-2", time_stamp: 45_000, payload: { device_id: DEVICE_B } },
        ],
        getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
      },
      DEVICE_B,
      45_000,
    );
    const result = await runBatonPrint(deps, { ...args, admin: { uuid: "admin-2" } });
    // Observed 45 s ago (local); server clock adds 10 s → 65 s elapsed
    // (≥ 60 s) → alert; the local clock alone would only see 55 s and keep
    // waiting.
    expect(result).toEqual({ outcome: "alert" });
  });

  it("foreign/falsy ticket stamps never arm the creator-strand alert — local observation alone decides", async () => {
    // Phase 3: the window is measured ONLY from this device's local
    // observation (pinned 30 s ago below). A falsy, garbage, or hours-ahead
    // `ticket.time_stamp` — another device's clock — can neither arm nor
    // suppress it.
    const rows: PrintRow[] = [
      { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { device_id: DEVICE_A } },
      { action: "PRINT_REQUEST", author: "admin-2", time_stamp: 2000, payload: { device_id: DEVICE_B } },
      { action: "PRINT_REASSIGN", author: "admin-1", time_stamp: 3000, payload: { to: DEVICE_B, device_id: DEVICE_A } },
    ];
    for (const time_stamp of [0, "abc", 9_999_999_999] as const) {
      const { deps, appendLog } = makeDeps(
        {
          isKitchenCapable: () => false,
          getPrintRows: async () => rows,
          getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
        },
        DEVICE_A,
        100_000 - 30_000,
      );
      const result = await runBatonPrint(deps, {
        ...args,
        ticket: { ...TICKET, time_stamp },
      });
      // Window open (30 s of 60 s elapsed from local observation): a timer,
      // never an immediate alert — and never armed by the stamp.
      expect(result).toEqual({ outcome: "waiting", alertInMs: 30_000 });
      expect(appendLog).not.toHaveBeenCalled();
    }
  });

  it("a foreign row stamp hours in the past cannot fire the requester alert early", async () => {
    // The request row claims it was made 10 hours ago (slow-clock device),
    // but this device first observed it 5 s ago → still waiting, timer armed.
    const { deps } = makeDeps(
      {
        getPrintRows: async () => [
          { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { device_id: DEVICE_A } },
          { action: "PRINT_REQUEST", author: "admin-2", time_stamp: 100_000 - 36_000_000, payload: { device_id: DEVICE_B } },
        ],
        getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
      },
      DEVICE_B,
      100_000 - 5_000,
    );
    const result = await runBatonPrint(deps, { ...args, admin: { uuid: "admin-2" } });
    expect(result).toEqual({ outcome: "waiting", alertInMs: 55_000 });
  });

  it("server device (deviceUuid null): stand-down before 60 s arms alertInMs", async () => {
    // The server is chain[0] and has reassigned away; its creator-strand
    // window (local observation pinned 30 s ago) has not expired yet → the
    // stand-down arm returns the remaining time instead of a bare waiting.
    const { deps, appendLog } = makeDeps(
      {
        isKitchenCapable: () => false,
        getPrintRows: async () => [
          { action: "PRINT_PASS", author: null, time_stamp: 1000, payload: { device_id: null } },
          { action: "PRINT_REQUEST", author: "admin-2", time_stamp: 2000, payload: { device_id: DEVICE_B } },
          { action: "PRINT_REASSIGN", author: null, time_stamp: 3000, payload: { to: DEVICE_B, device_id: null } },
        ],
        getChainSeedRow: async () => ({ action: "ADD_ITEM", author: null, time_stamp: 1, payload: { device_id: null } }),
        deviceUuid: () => null as any,
      },
      DEVICE_A,
      100_000 - 30_000,
    );
    const result = await runBatonPrint(deps, {
      ...args,
      ticket: { ...TICKET, uuid: "t-server-alert" },
    });
    // me === null === chain[0], reassignAuthors includes null, window open.
    expect(result).toEqual({ outcome: "waiting", alertInMs: 30_000 });
    expect(appendLog).not.toHaveBeenCalled();
  });
});

describe("manualTakeover", () => {
  it("appends a manual PRINT_SUCCESS on a live fold", async () => {
    const { deps, appendLog } = makeDeps();
    const ok = await manualTakeover(deps, TICKET, { uuid: "admin-1" });
    expect(ok).toBe(true);
    expect(appendLog.mock.calls[0]![0]).toMatchObject({
      action: PRINT_SUCCESS,
      payload: { manual: true },
    });
  });

  it("refuses once the ticket is terminal", async () => {
    const { deps, appendLog } = makeDeps({
      getPrintRows: async () => [
        { action: PRINT_SUCCESS, author: "admin-1", time_stamp: 1, payload: { device_id: DEVICE_A } },
      ],
    });
    const ok = await manualTakeover(deps, TICKET, { uuid: "admin-1" });
    expect(ok).toBe(false);
    expect(appendLog).not.toHaveBeenCalled();
  });

  it("allows takeover from a failed strand (Phase 4) — never a dead ticket", async () => {
    const { deps, appendLog } = makeDeps({
      getPrintRows: async () => [
        { action: PRINT_FAILED, author: "admin-2", time_stamp: 1, payload: { device_id: DEVICE_B } },
      ],
    });
    const ok = await manualTakeover(deps, TICKET, { uuid: "admin-1" });
    expect(ok).toBe(true);
    expect(appendLog.mock.calls[0]![0]).toMatchObject({
      action: PRINT_SUCCESS,
      payload: { manual: true },
    });
  });
});

// ---------------------------------------------------------------------------
// Item 4 — the same-admin two-device scenario. Both devices are signed in on
// the SAME admin; only the device differs. Before device identity, both
// computed `holder === me` and both printed. The chain[0] seed is
// the ticket's first log row — the creating device.
// ---------------------------------------------------------------------------
describe("same admin, two devices", () => {
  const rows: PrintRow[] = [
    // Ticket created on DEVICE_A (its first ADD_ITEM row carries device_id).
    { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { device_id: DEVICE_A } },
    { action: "PRINT_REQUEST", author: "admin-1", time_stamp: 2000, payload: { device_id: DEVICE_B } },
    { action: "PRINT_REASSIGN", author: "admin-1", time_stamp: 3000, payload: { to: DEVICE_B, device_id: DEVICE_A } },
  ];

  it("only the reassigned device sends — exactly one physical print", async () => {
    // DEVICE_B is the printer of record: it sends.
    const holder = makeDeps(
      { getPrintRows: async () => rows, getChainSeedRow: async () => seedCreatorRow(DEVICE_A) },
      DEVICE_B,
    );
    const holderResult = await runBatonPrint(holder.deps, {
      ...args,
      admin: { uuid: "admin-1" },
    });
    expect(holder.printTicket).toHaveBeenCalledTimes(1);
    expect(holderResult).toEqual({ outcome: "printed" });

    // DEVICE_A (same admin, different device) must stand down — no send.
    const other = makeDeps(
      { getPrintRows: async () => rows, getChainSeedRow: async () => seedCreatorRow(DEVICE_B) },
      DEVICE_A,
    );
    const otherResult = await runBatonPrint(other.deps, {
      ...args,
      admin: { uuid: "admin-1" },
    });
    expect(other.printTicket).not.toHaveBeenCalled();
    expect(otherResult.outcome).not.toBe("printed");
  });

  it("creator device does not hold the ticket for a same-admin peer", async () => {
    // DEVICE_A created the ticket but already reassigned to DEVICE_B: it must
    // not treat itself as the holder just because it is chain[0].
    const { deps, printTicket } = makeDeps(
      { getPrintRows: async () => rows, getChainSeedRow: async () => seedCreatorRow(DEVICE_A) },
      DEVICE_A,
    );
    await runBatonPrint(deps, { ...args, admin: { uuid: "admin-1" } });
    expect(printTicket).not.toHaveBeenCalled();
  });

  it("a same-admin peer does not send on a fresh ticket it did not create", async () => {
    // The seed row is the ticket's first log row (ADD_ITEM) → DEVICE_A is
    // chain[0] even though DEVICE_B shares its admin_uuid. Before device
    // identity both devices computed holder === me and both printed.
    const { deps, printTicket } = makeDeps(
      { getChainSeedRow: async () => seedCreatorRow(DEVICE_A) },
      DEVICE_B,
    );
    const result = await runBatonPrint(deps, { ...args, admin: { uuid: "admin-1" } });
    expect(printTicket).not.toHaveBeenCalled();
    expect(result.outcome).not.toBe("printed");
  });

  it("the fold's holder is the reassigned device, not the admin", () => {
    const fold = foldPrintBaton(rows, seedDeviceOf(rows[0]!));
    expect(fold.chain[0]).toBe(DEVICE_A);
    expect(fold.holder).toBe(DEVICE_B);
  });

  it("a dead holder is not inherited by a same-admin peer", async () => {
    // chain[0] = DEVICE_B (its ADD_ITEM row), and DEVICE_B's device is gone.
    // DEVICE_A (same admin) must NOT inherit the hold — it waits, never sends.
    const deadCreatorRows: PrintRow[] = [
      { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { reason: "print_failed", device_id: DEVICE_B } },
      { action: "PRINT_REQUEST", author: "admin-1", time_stamp: 2000, payload: { device_id: DEVICE_A } },
    ];
    const { deps, printTicket } = makeDeps(
      {
        getPrintRows: async () => deadCreatorRows,
        getChainSeedRow: async () => seedCreatorRow(DEVICE_B),
      },
      DEVICE_A,
    );
    const result = await runBatonPrint(deps, {
      ...args,
      admin: { uuid: "admin-1" },
    });
    expect(printTicket).not.toHaveBeenCalled();
    expect(result.outcome).not.toBe("printed");
  });

  it("a ticket with no rows yet (guest/legacy) never makes a device the holder", async () => {
    const { deps, printTicket } = makeDeps({}, DEVICE_A);
    const result = await runBatonPrint(deps, {
      ...args,
      admin: { uuid: "admin-1" },
    });
    expect(printTicket).not.toHaveBeenCalled();
    expect(result.outcome).not.toBe("printed");
  });
});

describe("failover — a refused holder hands the baton off (item 9)", () => {
  const strandedRows: PrintRow[] = [
    { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { reason: PRINT_REASON_STRANDED, device_id: DEVICE_A } },
  ];

  it("a capable peer requests over a stranded pass (the old assigned-fold lock-out)", async () => {
    // Before item 9 T3 could never request: the fold was `assigned` and the
    // request branch required `solicit`. Now the stranded pass opens the floor.
    const { deps, appendLog, printTicket } = makeDeps(
      { getPrintRows: async () => strandedRows, getChainSeedRow: async () => seedCreatorRow(DEVICE_A) },
      DEVICE_B,
    );
    const result = await runBatonPrint(deps, { ...args, admin: { uuid: "admin-1" } });
    expect(result.outcome).toBe("advanced");
    expect(printTicket).not.toHaveBeenCalled();
    expect(appendLog.mock.calls[0]![0]).toMatchObject({ action: "PRINT_REQUEST" });
  });

  it("the stranded holder reassigns to the first requester and is out", async () => {
    const rows: PrintRow[] = [
      ...strandedRows,
      { action: "PRINT_REQUEST", author: "admin-2", time_stamp: 2000, payload: { device_id: DEVICE_B } },
    ];
    const { deps, appendLog, printTicket } = makeDeps(
      { getPrintRows: async () => rows, getChainSeedRow: async () => seedCreatorRow(DEVICE_A) },
      DEVICE_A,
    );
    const result = await runBatonPrint(deps, { ...args, admin: { uuid: "admin-1" } });
    expect(result.outcome).toBe("advanced");
    expect(printTicket).not.toHaveBeenCalled();
    expect(appendLog.mock.calls[0]![0]).toMatchObject({
      action: "PRINT_REASSIGN",
      payload: { to: DEVICE_B },
    });
  });

  it("a non-capable peer stays out of a stranded fold", async () => {
    const { deps, appendLog, printTicket } = makeDeps(
      {
        isKitchenCapable: () => false,
        getPrintRows: async () => strandedRows,
        getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
      },
      DEVICE_B,
    );
    const result = await runBatonPrint(deps, { ...args, admin: { uuid: "admin-1" } });
    expect(printTicket).not.toHaveBeenCalled();
    expect(appendLog).not.toHaveBeenCalled();
    expect(result.outcome).not.toBe("printed");
  });

  it("fold.stranded is false for a not_capable pass and true only for a stranded one", () => {
    const notCapable = foldPrintBaton(
      [{ action: "PRINT_PASS", author: "admin-1", time_stamp: 1, payload: { reason: "not_capable", device_id: DEVICE_A } }],
      DEVICE_A,
    );
    expect(notCapable.stranded).toBe(false);
    expect(notCapable.state).toBe("solicit");

    const stranded = foldPrintBaton(strandedRows, DEVICE_A);
    expect(stranded.stranded).toBe(true);
    expect(stranded.holder).toBe(DEVICE_A);
    expect(stranded.decider).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — PRINT_FAILED: the durable 5-minute give-up. The window runs from
// THIS device's own read-only spinner observation (the UI arms it); the publish
// happens before decidePrint so no send/pass/request slips past an elapsed
// window, and the re-read fold then stands every device down.
// ---------------------------------------------------------------------------
describe("Phase 4 — PRINT_FAILED publisher", () => {
  const WINDOW_MS = PRINT_SPINNER_FAIL_MS; // 300_000
  // Date.now is mocked to 100_000: observed 1 s past the window / 60 s in.
  const elapsedObs = () => 100_000 - WINDOW_MS - 1;
  const freshObs = () => 100_000 - 60_000;

  // appendLog feeds getPrintRows back in, so the loop's re-read sees the row
  // it just wrote (the real client persists every append).
  function makePersistedDeps(
    over: Partial<BatonDeps<typeof TICKET, object, { uuid: string }>>,
    deviceId: string = DEVICE_A,
  ) {
    const rows: PrintRow[] = [];
    const appendLog = vi.fn(async (input: any) => {
      rows.push({
        action: input.action,
        author: input.admin_uuid,
        time_stamp: input.time_stamp,
        payload: input.payload,
        device_id: input.payload?.device_id ?? null,
        seq: input.payload?.seq ?? null,
      });
    });
    const base = makeDeps(
      { getPrintRows: async () => [...rows], appendLog, ...over },
      deviceId,
    );
    return { ...base, appendLog, rows };
  }

  it("publishes PRINT_FAILED once the local 5:00 window elapses with no success", async () => {
    // The strand is stuck: another device created it, nothing has printed.
    const { deps, appendLog, printTicket } = makePersistedDeps({
      getChainSeedRow: async () => seedCreatorRow(DEVICE_B),
      getPrintPendingObservedAt: elapsedObs,
    });
    const result = await runBatonPrint(deps, args);
    expect(result).toEqual({ outcome: "failed" });
    expect(printTicket).not.toHaveBeenCalled();
    expect(appendLog).toHaveBeenCalledTimes(1);
    expect(appendLog.mock.calls[0]![0]).toMatchObject({ action: PRINT_FAILED });
  });

  it("before 5:00: no declaration — arms failInMs for the remaining window", async () => {
    const { deps, appendLog } = makePersistedDeps({
      getChainSeedRow: async () => seedCreatorRow(DEVICE_B),
      getPrintPendingObservedAt: freshObs,
    });
    const result = await runBatonPrint(deps, args);
    expect(result.outcome).toBe("waiting");
    expect(result.failInMs).toBe(WINDOW_MS - 60_000);
    expect(appendLog).not.toHaveBeenCalled();
  });

  it("no local observation → this device never declares (and arms nothing)", async () => {
    const { deps, appendLog } = makePersistedDeps({
      getChainSeedRow: async () => seedCreatorRow(DEVICE_B),
      getPrintPendingObservedAt: () => null,
    });
    const result = await runBatonPrint(deps, args);
    expect(result.outcome).toBe("waiting");
    expect(result.failInMs).toBeUndefined();
    expect(appendLog).not.toHaveBeenCalled();
  });

  it("pre-success non-publication: a PRINT_SUCCESS suppresses the declaration", async () => {
    const { deps, appendLog } = makePersistedDeps({
      getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
      getPrintRows: async () => [
        { action: PRINT_SUCCESS, author: "admin-1", time_stamp: 1, payload: { device_id: DEVICE_A } },
      ],
      getPrintPendingObservedAt: elapsedObs,
    });
    const result = await runBatonPrint(deps, args);
    expect(result).toEqual({ outcome: "printed" });
    expect(appendLog).not.toHaveBeenCalled();
  });

  it("a conflicted strand keeps the attention verdict — no declaration over it", async () => {
    // REASSIGN without a pass → REASSIGN_WITHOUT_PASS conflict.
    const { deps, appendLog } = makePersistedDeps({
      getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
      getPrintRows: async () => [
        { action: "PRINT_REASSIGN", author: "admin-1", time_stamp: 1, payload: { to: DEVICE_B, device_id: DEVICE_A } },
      ],
      getPrintPendingObservedAt: elapsedObs,
    });
    const result = await runBatonPrint(deps, args);
    expect(result).toEqual({ outcome: "conflict" });
    expect(appendLog).not.toHaveBeenCalled();
  });

  it("a peer's PRINT_FAILED already landed → outcome failed, no duplicate row", async () => {
    const { deps, appendLog } = makePersistedDeps({
      getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
      getPrintRows: async () => [
        { action: PRINT_FAILED, author: "admin-2", time_stamp: 1, payload: { device_id: DEVICE_B } },
      ],
      getPrintPendingObservedAt: elapsedObs,
    });
    const result = await runBatonPrint(deps, args);
    expect(result).toEqual({ outcome: "failed" });
    expect(appendLog).not.toHaveBeenCalled();
  });
});
