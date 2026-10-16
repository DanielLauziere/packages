import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  appendLog,
  insertLog,
  applyLog,
  type LedgerDeps,
  type TicketLogRow,
} from "./ticketLogLedger.js";
import type { TicketLogEntry } from "./applyTicketLog.js";

type Recorded = { sql: string; params?: any[] };

function makeRow(over: Partial<TicketLogRow> = {}): TicketLogRow {
  return {
    uuid: over.uuid ?? "log-1",
    ticket_uuid: over.ticket_uuid ?? "t-1",
    location_group_uuid: over.location_group_uuid ?? "lg-1",
    action: over.action ?? "ADD_ITEM",
    payload: over.payload ?? { menu_item_uuid: "m-1" },
    time_stamp: over.time_stamp ?? 1000,
    admin_uuid: over.admin_uuid ?? "admin-1",
  };
}

function makeDeps() {
  const runs: Recorded[] = [];
  const queries: { sql: string; params?: any[] }[] = [];
  let queryResults: any[][] = [];
  const applyEntry = vi.fn(async (_entry: TicketLogEntry) => {});
  const notify = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  let uuidCounter = 0;

  const deps: LedgerDeps = {
    run: async (sql, params) => {
      runs.push({ sql, params });
    },
    query: async (sql, params) => {
      queries.push({ sql, params });
      return queryResults.length > 0 ? queryResults.shift()! : [];
    },
    applyEntry,
    serverOffsetMs: async () => 5000,
    newUuid: () => `uuid-${++uuidCounter}`,
    notify,
    logger: { warn, error },
  };

  return {
    deps,
    runs,
    queries,
    applyEntry,
    notify,
    warn,
    error,
    setQueryResults: (...results: any[][]) => {
      queryResults = results;
    },
  };
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(1_000_000);
});

describe("appendLog", () => {
  it("mints an entry windowed by the server offset, inserts, applies, marks, notifies", async () => {
    const ctx = makeDeps();
    const entry = await appendLog(ctx.deps, {
      ticket_uuid: "t-1",
      location_group_uuid: "lg-1",
      action: "ADD_ITEM",
      payload: { menu_item_uuid: "m-1" },
      time_stamp: 0 as any,
      admin_uuid: "admin-1",
    });

    expect(entry.uuid).toBe("uuid-1");
    expect(entry.time_stamp).toBe(1_005_000);

    const sqls = ctx.runs.map((r) => r.sql);
    expect(sqls).toHaveLength(2);
    expect(sqls[0]).toContain("INSERT INTO ticket_log");
    expect(sqls[0]).toContain("ON CONFLICT(uuid) DO NOTHING");
    expect(sqls[1]).toContain("INSERT OR IGNORE INTO ticket_log_applied");

    expect(ctx.applyEntry).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: "uuid-1", time_stamp: 1_005_000 }),
    );
    expect(ctx.notify).toHaveBeenCalledTimes(1);
  });

  it("sanitizes payload undefined → null before writing", async () => {
    const ctx = makeDeps();
    const entry = await appendLog(ctx.deps, {
      ticket_uuid: "t-1",
      location_group_uuid: "lg-1",
      action: "SET_ITEM_NOTE",
      payload: { note: undefined },
      time_stamp: 0 as any,
      admin_uuid: "admin-1",
    });
    expect(entry.payload).toEqual({ note: null });
    const insertParams = ctx.runs[0]!.params!;
    expect(insertParams[4]).toBe('{"note":null}');
  });

  it("keeps the log row when apply throws (no outer transaction, no mark)", async () => {
    const ctx = makeDeps();
    ctx.applyEntry.mockRejectedValueOnce(new Error("boom"));

    await expect(
      appendLog(ctx.deps, {
        ticket_uuid: "t-1",
        location_group_uuid: "lg-1",
        action: "ADD_ITEM",
        payload: {},
        time_stamp: 0 as any,
        admin_uuid: "admin-1",
      }),
    ).rejects.toThrow("boom");

    // insert ran, ledger mark did NOT, notify did NOT
    expect(ctx.runs).toHaveLength(1);
    expect(ctx.notify).not.toHaveBeenCalled();
  });

  it("wraps the whole flow in deps.lock when provided (RN withDbLock)", async () => {
    const ctx = makeDeps();
    const order: string[] = [];
    const lock = async <T>(fn: () => Promise<T>): Promise<T> => {
      order.push("lock-in");
      const out = await fn();
      order.push("lock-out");
      return out;
    };
    ctx.deps.lock = lock;
    ctx.applyEntry.mockImplementation(async () => {
      order.push("apply");
    });

    await appendLog(ctx.deps, {
      ticket_uuid: "t-1",
      location_group_uuid: "lg-1",
      action: "ADD_ITEM",
      payload: {},
      time_stamp: 0 as any,
      admin_uuid: "admin-1",
    });
    expect(order).toEqual(["lock-in", "apply", "lock-out"]);
  });
});

describe("insertLog", () => {
  it("skips when the ledger row is actually applied (time_stamp set)", async () => {
    const ctx = makeDeps();
    ctx.setQueryResults([[{ 1: 1 }]]);
    await insertLog(ctx.deps, makeRow());
    expect(ctx.runs).toHaveLength(0);
  });

  it("inserts when no ledger row exists (claim rows do not block)", async () => {
    const ctx = makeDeps();
    await insertLog(ctx.deps, makeRow({ payload: { a: 1 } }));
    expect(ctx.runs).toHaveLength(1);
    expect(ctx.runs[0]!.sql).toContain("INSERT OR IGNORE INTO ticket_log");
    expect(ctx.runs[0]!.params![4]).toBe('{"a":1}');
  });
});

describe("applyLog", () => {
  it("returns false without claiming when already applied", async () => {
    const ctx = makeDeps();
    ctx.setQueryResults([[{ 1: 1 }]]);
    const ok = await applyLog(ctx.deps, makeRow());
    expect(ok).toBe(false);
    expect(ctx.runs).toHaveLength(0);
    expect(ctx.applyEntry).not.toHaveBeenCalled();
  });

  it("claims, applies, marks, and returns true", async () => {
    const ctx = makeDeps();
    const ok = await applyLog(ctx.deps, makeRow({ time_stamp: 42 }));
    expect(ok).toBe(true);
    const sqls = ctx.runs.map((r) => r.sql);
    expect(sqls[0]).toContain('INSERT OR IGNORE INTO "ticket_log_applied"');
    expect(sqls[0]).toContain("VALUES (?, NULL, 0)");
    expect(ctx.applyEntry).toHaveBeenCalledTimes(1);
    expect(sqls[1]).toContain('SET "time_stamp" = ?');
    expect(ctx.runs[1]!.params).toEqual([42, "log-1"]);
  });

  it("backs off without throwing on MISSING_DEPENDENCY (returns false)", async () => {
    const ctx = makeDeps();
    ctx.applyEntry.mockRejectedValueOnce(new Error("MISSING_DEPENDENCY"));
    const ok = await applyLog(ctx.deps, makeRow());
    expect(ok).toBe(false);
    // claim + failLog bump
    expect(ctx.runs).toHaveLength(2);
    expect(ctx.runs[1]!.sql).toContain('"retry_count" = COALESCE("retry_count", 0) + 1');
    expect(ctx.warn).toHaveBeenCalledWith(
      "MISSING_DEPENDENCY (will retry)",
      expect.objectContaining({ uuid: "log-1" }),
    );
    expect(ctx.error).not.toHaveBeenCalled();
  });

  it("records the retry and rethrows other apply errors", async () => {
    const ctx = makeDeps();
    ctx.applyEntry.mockRejectedValueOnce(new Error("SQLITE_CORRUPT"));
    await expect(applyLog(ctx.deps, makeRow())).rejects.toThrow("SQLITE_CORRUPT");
    expect(ctx.runs).toHaveLength(2);
    expect(ctx.error).toHaveBeenCalled();
  });
});
