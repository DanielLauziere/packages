import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PRINT_ROWS_SQL,
  parsePrintPayload,
  mapPrintRows,
  readPrintFold,
  runBatonPrint,
  manualTakeover,
  type BatonDeps,
} from "./batonLoop.js";
import type { PrintRow } from "./printProtocol.js";
import { PRINT_ALERT_MS, PRINT_SUCCESS } from "./printProtocol.js";

const TICKET = {
  uuid: "t-1",
  admin_uuid: "admin-1",
  location_group_uuid: "lg-1",
  time_stamp: 0,
};

function makeDeps(over: Partial<BatonDeps<typeof TICKET, object, { uuid: string }>> = {}) {
  const appendLog = vi.fn(async (_input: any) => {});
  const printTicket = vi.fn(async (_args: any) => true);
  const getPrintRows = vi.fn(async (_uuid: string): Promise<PrintRow[]> => []);
  const deps: BatonDeps<typeof TICKET, object, { uuid: string }> = {
    getPrintRows,
    appendLog,
    getServerOffset: async () => 0,
    isKitchenCapable: () => true,
    printTicket,
    ...over,
  };
  return { deps, appendLog, printTicket, getPrintRows };
}

const args = {
  ticket: TICKET,
  locationGroup: {},
  admin: { uuid: "admin-1" },
  translations: [],
};

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(100_000);
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

  it("maps raw rows: author from admin_uuid, numeric time_stamp, parsed payload", () => {
    const rows = mapPrintRows([
      {
        action: "PRINT_PASS",
        payload: '{"reason":"print_failed"}',
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
        payload: { reason: "print_failed" },
      },
      { action: "PRINT_REQUEST", author: null, time_stamp: 456, payload: {} },
    ]);
  });

  it("parsePrintPayload tolerates null / object / invalid", () => {
    expect(parsePrintPayload(null)).toEqual({});
    const obj = { a: 1 };
    expect(parsePrintPayload(obj as any)).toBe(obj);
    expect(parsePrintPayload("{bad")).toEqual({});
  });

  it("readPrintFold folds the injected rows with the ticket creator", async () => {
    const rows: PrintRow[] = [
      { action: PRINT_SUCCESS, author: "admin-1", time_stamp: 1, payload: {} },
    ];
    const { fold, rows: out } = await readPrintFold(async () => rows, TICKET);
    expect(out).toBe(rows);
    expect(fold.terminal).toBe(true);
    expect(fold.holder).toBe("admin-1");
  });
});

describe("runBatonPrint", () => {
  it("creator + capable + no rows → send → printed", async () => {
    const { deps, appendLog, printTicket } = makeDeps();
    const result = await runBatonPrint(deps, args);
    expect(result).toEqual({ outcome: "printed" });
    expect(printTicket).toHaveBeenCalledTimes(1);
    expect(appendLog).toHaveBeenCalledTimes(1);
    expect(appendLog.mock.calls[0]![0]).toMatchObject({
      action: PRINT_SUCCESS,
      admin_uuid: "admin-1",
      ticket_uuid: "t-1",
      location_group_uuid: "lg-1",
    });
  });

  it("send failure announces PRINT_PASS and returns (advanced via next round → waiting)", async () => {
    const { deps, appendLog, printTicket } = makeDeps();
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
        { action: PRINT_SUCCESS, author: "admin-1", time_stamp: 1, payload: {} },
      ],
    });
    const result = await runBatonPrint(deps, args);
    expect(result).toEqual({ outcome: "printed" });
    expect(printTicket).not.toHaveBeenCalled();
    expect(appendLog).not.toHaveBeenCalled();
  });

  it("waiter past its own request's alert window gets outcome alert", async () => {
    const { deps } = makeDeps({
      getPrintRows: async () => [
        { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: {} },
        { action: "PRINT_REQUEST", author: "admin-2", time_stamp: 2000, payload: {} },
      ],
      isKitchenCapable: () => true,
    });
    const result = await runBatonPrint(deps, {
      ...args,
      admin: { uuid: "admin-2" },
    });
    expect(result).toEqual({ outcome: "alert" });
  });

  it("non-capable creator passes the baton", async () => {
    const { deps, appendLog, printTicket } = makeDeps({
      isKitchenCapable: () => false,
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
    // Creator admin-1 is not capable (silent_print false), passes, then
    // reassigns to admin-2 who also can't print. Ticket created >60s ago.
    // The original device (admin-1) should get outcome 'alert'.
    const { deps } = makeDeps({
      isKitchenCapable: () => false,
      getPrintRows: async () => [
        { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: {} },
        { action: "PRINT_REQUEST", author: "admin-2", time_stamp: 2000, payload: {} },
        { action: "PRINT_REASSIGN", author: "admin-1", time_stamp: 3000, payload: { to: "admin-2" } },
      ],
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
        { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { reason: "print_failed" } },
      ],
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
        { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: { reason: "print_failed" } },
      ],
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
        { action: "PRINT_PASS", author: "admin-1", time_stamp: 1000, payload: {} },
        { action: "PRINT_REQUEST", author: "admin-2", time_stamp: 2000, payload: {} },
        { action: "PRINT_REASSIGN", author: "admin-1", time_stamp: 3000, payload: { to: "admin-2" } },
      ],
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
        { action: PRINT_SUCCESS, author: "admin-1", time_stamp: 1, payload: {} },
      ],
    });
    const ok = await manualTakeover(deps, TICKET, { uuid: "admin-1" });
    expect(ok).toBe(false);
    expect(appendLog).not.toHaveBeenCalled();
  });
});
