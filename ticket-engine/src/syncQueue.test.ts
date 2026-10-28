import { describe, it, expect } from "vitest";
import {
  getPriority,
  sortTicketLogs,
  normalizeLogs,
  groupLogsByTicket,
  isPaidTicket,
  isForegroundTicket,
  filterTicketsByActivity,
  type SyncLogLike,
  type SyncSummary,
} from "./syncQueue.js";
import { CUTOFF_MS } from "./consts.js";

type Log = SyncLogLike & { payload?: unknown };

function makeLog(over: Partial<Log> = {}): Log {
  return {
    uuid: over.uuid ?? "log-1",
    ticket_uuid: over.ticket_uuid ?? "t-1",
    action: over.action ?? "ADD_ITEM",
    time_stamp: over.time_stamp ?? 1000,
    payload: over.payload ?? { menu_item_uuid: "m-1" },
  };
}

function makeSummary(over: Partial<SyncSummary> = {}): SyncSummary {
  return {
    ticketsTotal: 0,
    ticketsActive: 0,
    ticketsExpired: 0,
    incomingTickets: 0,
    bucketsOut: 0,
    pruned: 0,
    ticketsOutOfSync: 0,
    ...over,
  };
}

describe("getPriority", () => {
  it("returns ACTION_PRIORITY for known actions", () => {
    expect(getPriority({ action: "ADD_ITEM" })).toBe(1);
    expect(getPriority({ action: "SET_TABLE" })).toBe(0);
  });

  it("returns 999 for unknown actions", () => {
    expect(getPriority({ action: "NOPE" })).toBe(999);
  });
});

describe("sortTicketLogs", () => {
  it("sorts by priority, then time_stamp, then uuid", () => {
    const logs = [
      makeLog({ uuid: "c", action: "ADD_ITEM", time_stamp: 1 }),
      makeLog({ uuid: "a", action: "ADD_PAYMENT", time_stamp: 1 }),
      makeLog({ uuid: "b", action: "SET_TABLE", time_stamp: 9 }),
      makeLog({ uuid: "a", action: "ADD_ITEM", time_stamp: 5 }),
      makeLog({ uuid: "b", action: "ADD_ITEM", time_stamp: 5 }),
    ];
    const sorted = sortTicketLogs(logs);
    expect(sorted.map((l) => [l.action, l.time_stamp, l.uuid])).toEqual([
      ["SET_TABLE", 9, "b"],
      ["ADD_ITEM", 1, "c"],
      ["ADD_ITEM", 5, "a"],
      ["ADD_ITEM", 5, "b"],
      ["ADD_PAYMENT", 1, "a"],
    ]);
  });

  it("does not mutate the input array", () => {
    const logs = [
      makeLog({ uuid: "b", time_stamp: 2 }),
      makeLog({ uuid: "a", time_stamp: 1 }),
    ];
    sortTicketLogs(logs);
    expect(logs[0]!.uuid).toBe("b");
  });
});

describe("normalizeLogs", () => {
  it("parses JSON string payloads", () => {
    const [out] = normalizeLogs([makeLog({ payload: '{"a":1}' })]);
    expect(out!.payload).toEqual({ a: 1 });
  });

  it("passes through object payloads", () => {
    const obj = { a: 1 };
    const [out] = normalizeLogs([makeLog({ payload: obj })]);
    expect(out!.payload).toBe(obj);
  });

  it("sets payload to null on unparseable JSON", () => {
    const [out] = normalizeLogs([makeLog({ payload: "{bad" })]);
    expect(out!.payload).toBeNull();
  });
});

describe("groupLogsByTicket", () => {
  it("groups logs by ticket_uuid", () => {
    const grouped = groupLogsByTicket([
      makeLog({ uuid: "1", ticket_uuid: "t-1" }),
      makeLog({ uuid: "2", ticket_uuid: "t-2" }),
      makeLog({ uuid: "3", ticket_uuid: "t-1" }),
    ]);
    expect(Object.keys(grouped).sort()).toEqual(["t-1", "t-2"]);
    expect(grouped["t-1"]!.map((l) => l.uuid)).toEqual(["1", "3"]);
  });
});

describe("isPaidTicket", () => {
  it("detects SET_STATUS_PAID", () => {
    expect(isPaidTicket([makeLog({ action: "SET_STATUS_PAID" })])).toBe(true);
    expect(isPaidTicket([makeLog({ action: "ADD_ITEM" })])).toBe(false);
  });
});

describe("isForegroundTicket", () => {
  const log = { action: "ADD_ITEM" };

  it("keeps open and new tickets on the synchronous path", () => {
    expect(isForegroundTicket("INCOMPLETE", [log])).toBe(true);
    expect(isForegroundTicket(undefined, [log])).toBe(true);
  });

  it("defers settled tickets and incoming paid transitions", () => {
    expect(isForegroundTicket("PAID", [log])).toBe(false);
    expect(isForegroundTicket("CANCELLED", [log])).toBe(false);
    expect(isForegroundTicket("INCOMPLETE", [{ action: "SET_STATUS_PAID" }])).toBe(false);
  });
});

describe("filterTicketsByActivity (24h cutoff)", () => {
  const now = 1_000_000;

  it("drops tickets whose newest log is older than the cutoff", () => {
    const summary = makeSummary();
    const result = filterTicketsByActivity(
      { "t-old": [makeLog({ time_stamp: now - CUTOFF_MS - 1 })] },
      summary,
      now,
    );
    expect(result).toEqual({});
    expect(summary.pruned).toBe(1);
    expect(summary.ticketsExpired).toBe(1);
    expect(summary.ticketsTotal).toBe(1);
  });

  it("keeps a ticket when ANY log is within the cutoff (uses MAX time_stamp)", () => {
    const summary = makeSummary();
    const logs = [
      makeLog({ time_stamp: now - CUTOFF_MS - 1000 }),
      makeLog({ time_stamp: now - 1000 }),
    ];
    const result = filterTicketsByActivity({ "t-mixed": logs }, summary, now);
    expect(result["t-mixed"]).toBe(logs);
    expect(summary.ticketsActive).toBe(1);
    expect(summary.pruned).toBe(0);
  });

  it("skips tickets with no logs", () => {
    const summary = makeSummary();
    const result = filterTicketsByActivity({ "t-empty": [] }, summary, now);
    expect(result).toEqual({});
    expect(summary.ticketsTotal).toBe(0);
  });
});
