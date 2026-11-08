import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
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
import { PRINT_ALERT_MS, PRINT_SUCCESS, foldPrintBaton } from "./printProtocol.js";

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
) {
  const appendLog = vi.fn(async (_input: any) => {});
  const printTicket = vi.fn(async (_args: any) => true);
  const getPrintRows = vi.fn(async (_uuid: string): Promise<PrintRow[]> => []);
  const getChainSeedRow = vi.fn(async (_uuid: string): Promise<PrintRow | null> => null);
  const deps: BatonDeps<typeof TICKET, object, { uuid: string }> = {
    getPrintRows,
    getChainSeedRow,
    appendLog,
    getServerOffset: async () => 0,
    deviceUuid: () => deviceId,
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
  it("selects the four PRINT_* actions ordered by time_stamp, uuid", () => {
    expect(PRINT_ROWS_SQL).toContain("PRINT_SUCCESS");
    expect(PRINT_ROWS_SQL).toContain("PRINT_REASSIGN");
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
      },
      {
        action: "PRINT_REQUEST",
        author: null,
        time_stamp: 456,
        payload: {},
        device_id: null,
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

  it("send failure announces PRINT_PASS and returns (advanced via next round → waiting)", async () => {
    const { deps, appendLog, printTicket } = makeDeps(
      { getChainSeedRow: async () => seedCreatorRow(DEVICE_A) },
      DEVICE_A,
    );
    printTicket.mockResolvedValueOnce(false);
    const result = await runBatonPrint(deps, args);
    // pass appended once (passAuthors empty), then next iteration is still
    // holder+capable → send refused again … bounded by MAX_ITERATIONS →
    // outcome advanced (a log was written this run).
    expect(result.outcome).toBe("advanced");
    expect(appendLog.mock.calls[0]![0]).toMatchObject({
      action: "PRINT_PASS",
      payload: { reason: "print_failed" },
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
    const { deps } = makeDeps({
      isKitchenCapable: () => false,
      getPrintRows: async () => [
        { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { device_id: DEVICE_A } },
        { action: "PRINT_REQUEST", author: "admin-2", time_stamp: 2000, payload: { device_id: DEVICE_B } },
        { action: "PRINT_REASSIGN", author: "admin-1", time_stamp: 3000, payload: { to: DEVICE_B, device_id: DEVICE_A } },
      ],
          getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
});
    const createdAt = 100_000 - PRINT_ALERT_MS - 1; // >60s before now
    const result = await runBatonPrint(deps, {
      ...args,
      ticket: { ...TICKET, time_stamp: createdAt },
      admin: { uuid: "admin-1" },
    });
    expect(result.outcome).toBe("alert");
  });

  it("original device sees alert on local print failure alone (no reassign), >60 s, no success", async () => {
    // Creator admin-1 tried to print, transport refused (PRINT_PASS
    // print_failed). No other device requested, no reassign. After 60s
    // the original device should get the alert.
    const { deps } = makeDeps({
      isKitchenCapable: () => false,
      getPrintRows: async () => [
        { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { reason: "print_failed", device_id: DEVICE_A } },
      ],
          getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
});
    const createdAt = 100_000 - PRINT_ALERT_MS - 1;
    const result = await runBatonPrint(deps, {
      ...args,
      ticket: { ...TICKET, time_stamp: createdAt },
      admin: { uuid: "admin-1" },
    });
    expect(result.outcome).toBe("alert");
    expect(deps.appendLog).not.toHaveBeenCalled();
    expect(deps.printTicket).not.toHaveBeenCalled();
  });

  it("original device with local print failure <60 s arms alertInMs timer", async () => {
    const { deps } = makeDeps({
      isKitchenCapable: () => false,
      getPrintRows: async () => [
        { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { reason: "print_failed", device_id: DEVICE_A } },
      ],
          getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
});
    const createdAt = 100_000 - 30_000;
    // Distinct uuid: the send-failure cooldown from earlier tests is keyed by
    // ticket uuid (module state) and would otherwise win the `wait` branch.
    const result = await runBatonPrint(deps, {
      ...args,
      ticket: { ...TICKET, uuid: "t-alert-pf-pending", time_stamp: createdAt },
      admin: { uuid: "admin-1" },
    });
    expect(result.outcome).toBe("waiting");
    expect(result.alertInMs).toBeGreaterThan(0);
    expect(result.alertInMs).toBeLessThanOrEqual(PRINT_ALERT_MS);
  });

  it("original device arms alertInMs timer before the 60 s window fires", async () => {
    const { deps } = makeDeps({
      isKitchenCapable: () => false,
      getPrintRows: async () => [
        { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { device_id: DEVICE_A } },
        { action: "PRINT_REQUEST", author: "admin-2", time_stamp: 2000, payload: { device_id: DEVICE_B } },
        { action: "PRINT_REASSIGN", author: "admin-1", time_stamp: 3000, payload: { to: DEVICE_B, device_id: DEVICE_A } },
      ],
          getChainSeedRow: async () => seedCreatorRow(DEVICE_A),
});
    // Ticket created 30s ago — not yet 60s, so alert not yet active.
    const createdAt = 100_000 - 30_000;
    const result = await runBatonPrint(deps, {
      ...args,
      ticket: { ...TICKET, time_stamp: createdAt },
      admin: { uuid: "admin-1" },
    });
    expect(result.outcome).toBe("waiting");
    expect(result.alertInMs).toBeGreaterThan(0);
    expect(result.alertInMs).toBeLessThanOrEqual(PRINT_ALERT_MS);
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
