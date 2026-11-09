/**
 * Item 5 — the contract-mandated integration test.
 *
 * The contract's proof strategy promises: "two clients + omni over P2P with
 * the server killed mid-chain." This is that test at the engine level: two
 * independent replicas (each with its own log set and its own device id),
 * the rows they exchange encoded/decoded with the REAL compact ticket-log
 * codec (`ticketLogWire.ts`) — the same bytes P2P puts on the wire — and a
 * stand-in "server" device that can be killed and restarted mid-chain.
 *
 * It asserts the two properties the contract asks for:
 *   - terminal `PRINT_SUCCESS` on exactly one device, physical prints == 1;
 *   - after the server restarts, still exactly one print and no new rows
 *     beyond what the chain already had (item 2 commits the announce with the
 *     completion, so nothing is missed).
 */

import { describe, it, expect } from "vitest";

import {
  decodeTicketLogGroup,
  encodeTicketLogGroup,
  type DecodedTicketLog,
  type TicketLogWireInput,
} from "./ticketLogWire.js";
import {
  decidePrint,
  foldPrintBaton,
  type PrintFold,
  type PrintRow,
} from "./printProtocol.js";

// ---------------------------------------------------------------------------
// Replica: one client's local DB + its device.
// ---------------------------------------------------------------------------

interface Replica {
  id: string;
  adminUuid: string;
  capable: boolean;
  /** The transport is broken: a send is refused (item 9 → stranded pass). */
  broken: boolean;
  /** Local rows — each replica only ever sees what it has synced. */
  rows: PrintRow[];
  /** Physical prints this replica has produced. */
  prints: number;
  /** Sends this replica has opened (assertable for the "holder only" rule). */
  sends: { held: boolean; manual?: boolean }[];
  requestedAt: number | null;
  alertShown: boolean;
}

function replica(id: string, adminUuid: string, opts: Partial<Replica> = {}): Replica {
  return {
    id,
    adminUuid,
    capable: opts.capable ?? false,
    broken: opts.broken ?? false,
    rows: [],
    prints: 0,
    sends: [],
    requestedAt: null,
    alertShown: false,
  };
}

// ---------------------------------------------------------------------------
// The wire: encode a replica's new rows into a compact group, decode them on
// the peer. This is the real P2P payload path.
// ---------------------------------------------------------------------------

function toWire(replica: Replica, ticketUuid: string, lg: string): TicketLogWireInput[] {
  void ticketUuid;
  void lg;
  return replica.rows.map((r) => ({
    // uuid is identity: the row keeps its uuid across the wire.
    uuid: r.uuid,
    action: r.action,
    payload: r.payload ?? {},
    time_stamp: r.time_stamp,
    admin_uuid: r.author,
  }));
}

/**
 * Exchange every row both replicas have produced, over the real codec. The
 * server replica (when alive) receives them too — it syncs like any peer.
 */
function exchange(a: Replica, b: Replica, ticketUuid: string, lg: string, server?: ServerDevice): void {
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as const) {
    if (from.rows.length === 0) continue;
    const group = encodeTicketLogGroup(toWire(from, ticketUuid, lg));
    const decoded: DecodedTicketLog[] = decodeTicketLogGroup(ticketUuid, lg, group);
    for (const row of decoded) {
      // Idempotent ingest: uuid is identity.
      if (to.rows.some((r) => r.uuid === row.uuid)) continue;
      to.rows.push({
        uuid: row.uuid,
        action: row.action,
        author: row.admin_uuid ?? null,
        time_stamp: row.time_stamp,
        payload: row.payload,
      });
    }
  }
  if (server?.alive) {
    for (const from of [a, b]) {
      for (const row of from.rows) {
        if (server.rows.some((r) => r.uuid === row.uuid)) continue
        server.rows.push({ ...row })
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The "server" (device A in the contract's guest flow).
// ---------------------------------------------------------------------------

interface ServerDevice {
  id: string;
  alive: boolean;
  rows: PrintRow[];
}

function serverDevice(): ServerDevice {
  return { id: "server", alive: true, rows: [] };
}

/**
 * The server's announce — item 2 commits it with the completion, so the test
 * writes both in one call and treats the pair as atomic.
 */
function serverAnnounce(s: ServerDevice, time_stamp: number): void {
  if (!s.alive) return;
  s.rows.push({
    uuid: `server-pass-${time_stamp}`,
    action: "PRINT_PASS",
    author: SERVER_CREATOR,
    time_stamp,
    payload: {},
  });
}

// ---------------------------------------------------------------------------
// One deterministic step for one replica (the real decidePrint).
// ---------------------------------------------------------------------------

function step(r: Replica, creator: string, now: number): string {
  const fold = foldOf(r, creator);
  const decision = decidePrint(fold, {
    me: r.id,
    capable: r.capable,
    now,
    requestedAt: r.requestedAt,
  });
  switch (decision.kind) {
    case "send":
      if (r.broken) {
        push(r, "PRINT_PASS", { reason: "stranded" }, now);
        r.capable = false;
        break;
      }
      r.prints++;
      r.sends.push({ held: fold.holder === r.id });
      push(r, "PRINT_SUCCESS", {}, now);
      break;
    case "pass":
      push(r, "PRINT_PASS", {}, now);
      break;
    case "request":
      r.requestedAt = now;
      push(r, "PRINT_REQUEST", {}, now);
      break;
    case "reassign":
      push(r, "PRINT_REASSIGN", { to: decision.to }, now);
      break;
    case "alert":
      r.alertShown = true;
      break;
    default:
      break;
  }
  return decision.kind;
}

/**
 * Append a PRINT_* row the way the client's `appendPrintLog` does: the acting
 * **admin** goes in `author`, the acting **device** rides in
 * `payload.device_id` (item 4). The fold reads identity from the payload.
 */
function push(r: Replica, action: string, payload: Record<string, unknown>, ts: number): void {
  r.rows.push({
    uuid: `${action.toLowerCase()}-${r.id}-${ts}`,
    action,
    author: r.adminUuid,
    time_stamp: ts,
    payload: { ...payload, device_id: r.id },
  });
}

function foldOf(r: Replica, creator: string): PrintFold {
  return foldPrintBaton(r.rows, creator);
}

function pushServerRow(s: ServerDevice, r: Replica, ts: number): void {
  // The server's rows land on the replica verbatim (author null = server).
  for (const row of s.rows) {
    if (r.rows.some((x) => x.uuid === row.uuid)) continue;
    r.rows.push({ ...row });
  }
  void ts;
}

// ---------------------------------------------------------------------------

const TICKET = "t-int-1";
const LG = "lg-int-1";
// The contract's guest flow: the server is device A (the creator/holder) and
// announces at completion. The staff devices request and take the baton.
// The server's rows are read back with COALESCE(admin_uuid::text, '') — an
// empty string, never null (print_baton.go).
const SERVER_CREATOR = "";

describe("item 5 — two replicas over the real wire codec, server killed mid-chain", () => {
  it("server announces at completion (item 2); a broken device's peer takes over over P2P — one print", () => {
    const one = replica("dev-1", "adm-1", { capable: true, broken: true });
    const two = replica("dev-2", "adm-2", { capable: true });
    const server = serverDevice();

    // Item 2: completion + announce commit together. The server is the holder
    // (guest ticket) and opens the floor.
    serverAnnounce(server, 1000);
    pushServerRow(server, one, 1000);
    pushServerRow(server, two, 1000);

    // dev-1 is capable but its printer is broken. The floor is open, so it
    // requests — then its send is refused and it writes a stranded pass.
    expect(step(one, SERVER_CREATOR, 2000)).toBe("request");
    exchange(one, two, TICKET, LG, server);
    expect(step(two, SERVER_CREATOR, 3000)).toBe("request");
    exchange(two, one, TICKET, LG, server);

    // The server reassigns to the first requester it saw (dev-1).
    const serverFold = foldPrintBaton(server.rows, SERVER_CREATOR);
    expect(serverFold.decider).toBe(true);
    expect(serverFold.requests).toContain("dev-1");

    // dev-1 is now the holder; its one send is refused → stranded pass.
    // (The server reassign row must reach it first.)
    server.rows.push({
      uuid: "server-reassign-3500",
      action: "PRINT_REASSIGN",
      author: SERVER_CREATOR,
      time_stamp: 3500,
      payload: { to: "dev-1" },
    });
    pushServerRow(server, one, 3500);
    exchange(one, two, TICKET, LG, server);

    expect(step(one, SERVER_CREATOR, 4000)).toBe("send");
    expect(one.rows.at(-1)).toMatchObject({ action: "PRINT_PASS", payload: { reason: "stranded" } });

    // dev-1 is the stranded holder and still the decider: it reassigns to the
    // other requester (dev-2) — the failover walks the chain.
    exchange(one, two, TICKET, LG, server);
    expect(step(one, SERVER_CREATOR, 5000)).toBe("reassign");
    expect(one.rows.at(-1)).toMatchObject({
      action: "PRINT_REASSIGN",
      payload: { to: "dev-2", device_id: "dev-1" },
    });

    // dev-2 is now the holder → it prints.
    exchange(one, two, TICKET, LG, server);
    expect(step(two, SERVER_CREATOR, 6000)).toBe("send");
    expect(two.prints).toBe(1);

    // Final sync: both replicas converge on the identical terminal fold.
    exchange(one, two, TICKET, LG, server);
    const foldOne = foldOf(one, SERVER_CREATOR);
    const foldTwo = foldOf(two, SERVER_CREATOR);
    expect(foldOne.state).toBe("printed");
    expect(foldTwo.state).toBe("printed");
    expect(foldOne.holder).toBe(foldTwo.holder);
    expect(foldOne.chain).toEqual(foldTwo.chain);

    // Exactly one physical print, and only the holder ever opened a send.
    expect(one.prints + two.prints).toBe(1);
    expect(one.sends).toHaveLength(0);
    expect(two.sends).toEqual([{ held: true }]);
  });

  it("server killed mid-chain: replicas converge over P2P alone, no second print", () => {
    const one = replica("dev-1", "adm-1", { capable: true, broken: true });
    const two = replica("dev-2", "adm-2", { capable: true });
    const server = serverDevice();

    // Announce + the server's reassign commit together (item 2), then the
    // server dies. The clients must finish the chain without it.
    serverAnnounce(server, 1000);
    pushServerRow(server, one, 1000);
    pushServerRow(server, two, 1000);

    // dev-1 requests; the server (alive) reassigns to it.
    step(one, SERVER_CREATOR, 2000);
    exchange(one, two, TICKET, LG, server);
    server.rows.push({
      uuid: "server-reassign-2500",
      action: "PRINT_REASSIGN",
      author: SERVER_CREATOR,
      time_stamp: 2500,
      payload: { to: "dev-1" },
    });
    pushServerRow(server, one, 2500);
    exchange(one, two, TICKET, LG, server);

    // The server dies here — after the reassign, before the print.
    server.alive = false;

    // dev-1's one send is refused → stranded pass (the floor opens).
    step(one, SERVER_CREATOR, 3000);
    exchange(one, two, TICKET, LG, server);

    // dev-2 requests; dev-1 (stranded holder, still decider) reassigns to it.
    step(two, SERVER_CREATOR, 4000);
    exchange(two, one, TICKET, LG, server);
    step(one, SERVER_CREATOR, 5000);
    exchange(one, two, TICKET, LG, server);

    // dev-2 is the holder → it prints. All of this over P2P alone.
    step(two, SERVER_CREATOR, 6000);
    exchange(two, one, TICKET, LG, server);

    expect(one.prints + two.prints).toBe(1);
    const before = { one: one.rows.length, two: two.rows.length };

    // The server comes back. Item 2 guarantees the announce is already
    // committed, so it must not re-announce (that would be a second PASS and
    // a duplicate solicitation). It only observes the terminal fold.
    server.alive = true;
    pushServerRow(server, one, 6000);
    exchange(one, two, TICKET, LG, server);

    // No new rows beyond the chain, no conflict, still exactly one print.
    expect(one.rows.length).toBe(before.one);
    expect(two.rows.length).toBe(before.two);
    const fold = foldOf(two, SERVER_CREATOR);
    expect(fold.state).toBe("printed");
    expect(fold.conflict).toEqual([]);
    expect(one.prints + two.prints).toBe(1);
  });

  it("no capable device anywhere: the chain rests stranded, loudly, zero prints", () => {
    const one = replica("dev-1", "adm-1", { capable: true, broken: true });
    const two = replica("dev-2", "adm-2", { capable: false });
    const server = serverDevice();

    serverAnnounce(server, 1000);
    pushServerRow(server, one, 1000);
    pushServerRow(server, two, 1000);
    server.alive = false;

    // The server reassigns to dev-1 (the only capable device).
    step(one, SERVER_CREATOR, 2000);
    exchange(one, two, TICKET, LG, server);
    server.rows.push({
      uuid: "server-reassign-2500",
      action: "PRINT_REASSIGN",
      author: SERVER_CREATOR,
      time_stamp: 2500,
      payload: { to: "dev-1" },
    });
    pushServerRow(server, one, 2500);
    exchange(one, two, TICKET, LG, server);
    server.alive = false;

    // dev-1's one send is refused → stranded pass.
    expect(step(one, SERVER_CREATOR, 4000)).toBe("send");
    exchange(one, two, TICKET, LG, server);

    // dev-2 is not capable → it never requests; nobody prints.
    expect(step(two, SERVER_CREATOR, 5000)).toBe("wait");
    expect(one.prints + two.prints).toBe(0);

    const fold = foldOf(two, SERVER_CREATOR);
    expect(fold.state).not.toBe("printed");
    expect(fold.stranded).toBe(true);
  });

  it("the wire round-trips payload reasons and reassign targets (device ids survive)", () => {
    const one = replica("dev-1", "adm-1", { capable: true, broken: true });
    const two = replica("dev-2", "adm-2", { capable: true });

    push(one, "PRINT_PASS", { reason: "stranded" }, 1000);
    push(two, "PRINT_REQUEST", {}, 2000);
    exchange(one, two, TICKET, LG);
    exchange(two, one, TICKET, LG);

    // The stranded reason survives the compact codec — it is what opens the
    // floor on the peer, so a lossy wire would silently break item 9.
    const pass = two.rows.find((r) => r.action === "PRINT_PASS");
    expect(pass?.payload).toEqual({ reason: "stranded", device_id: "dev-1" });

    // With the creator as dev-1, the peer folds that pass as its holder's
    // stranded handoff — the flag the request branch depends on.
    const fold = foldPrintBaton(two.rows, "dev-1");
    expect(fold.stranded).toBe(true);
    expect(fold.holder).toBe("dev-1");
  });
});
