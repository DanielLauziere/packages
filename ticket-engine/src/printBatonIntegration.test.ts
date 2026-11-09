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

  it("a manual takeover crosses the wire and is terminal on the peer's fold", () => {
    const one = replica("dev-1", "adm-1", { capable: false });
    const two = replica("dev-2", "adm-2", { capable: false });

    // Replica A takes the human override — exactly the row manualTakeover
    // appends: PRINT_SUCCESS {manual:true} stamped with the acting device.
    push(one, "PRINT_SUCCESS", { manual: true }, 3000);
    exchange(one, two, TICKET, LG);

    // The payload survives the codec byte-for-byte.
    const received = two.rows.find((r) => r.action === "PRINT_SUCCESS");
    expect(received?.payload).toEqual({ manual: true, device_id: "dev-1" });

    // B's fold is terminal and printed — the takeover resolves for everyone,
    // with no AUTO_SUCCESS conflict against the non-holder.
    const foldOne = foldOf(one, "dev-1");
    const foldTwo = foldOf(two, "dev-1");
    expect(foldOne.terminal).toBe(true);
    expect(foldTwo.terminal).toBe(true);
    expect(foldTwo.state).toBe("printed");
    expect(foldTwo.conflict).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The fleet-convergence scenarios: N admin apps, one capable non-broken
// printer, repeated. Each scenario runs REPEATS times with a different seed
// so the interleaving race is exercised, not just one lucky order.
//
// Every replica keeps its own row set and its own device id; rows travel
// through the real compact codec. A "print" is a real transport call in the
// sense the loop makes it: the device decided `send` and its transport
// accepted. The assertion per repeat: exactly one physical print, by the
// device that actually has a working printer, terminal fold, identical chain
// on every replica (I4), and only the holder ever opens a send (I3).
// ---------------------------------------------------------------------------

const REPEATS = 20;

/** A PRINT_* row as the wire carries it: PrintRow plus the row uuid (identity). */
interface FleetRow extends PrintRow {
  uuid: string;
}

interface FleetDevice {
  id: string;
  admin: string;
  /** No kitchen printer configured → never capable, announces and exits. */
  configured: boolean;
  /** Printer configured but broken → the one send is refused (stranded). */
  broken: boolean;
  rows: FleetRow[];
  prints: number;
  sends: { held: boolean }[];
  requestedAt: number | null;
  /** True once this device has written a PRINT_REASSIGN (staleness probe). */
  reassigned: boolean;
}

function fleetDevice(id: string, admin: string, opts: Partial<FleetDevice> = {}): FleetDevice {
  return {
    id,
    admin,
    configured: opts.configured ?? true,
    broken: opts.broken ?? false,
    rows: [],
    prints: 0,
    sends: [],
    requestedAt: null,
    reassigned: false,
  };
}

const capableOf = (d: FleetDevice) => d.configured && !d.broken;

/** Append a PRINT_* row the way the client does: admin in author, device in payload. */
function fleetPush(
  d: FleetDevice,
  action: string,
  payload: Record<string, unknown>,
  ts: number,
): void {
  d.rows.push({
    uuid: `${action}-${d.id}-${ts}`,
    action,
    author: d.admin,
    time_stamp: ts,
    payload: { ...payload, device_id: d.id },
  });
}

/** Move every row both replicas have produced, over the real compact codec. */
function fleetExchange(
  a: FleetDevice,
  b: FleetDevice,
  ticketUuid: string,
  lg: string,
): void {
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as const) {
    if (from.rows.length === 0) continue;
    const group = encodeTicketLogGroup(
      from.rows.map((r) => ({
        uuid: r.uuid,
        action: r.action,
        payload: r.payload ?? {},
        time_stamp: r.time_stamp,
        admin_uuid: r.author,
      })),
    );
    for (const row of decodeTicketLogGroup(ticketUuid, lg, group)) {
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
}

/** Converge a whole fleet: every pair exchanges until no row count changes. */
function fleetConverge(fleet: FleetDevice[], ticketUuid: string, lg: string): void {
  for (let pass = 0; pass < fleet.length; pass++) {
    const before = fleet.map((d) => d.rows.length).join(",");
    for (let i = 0; i < fleet.length; i++) {
      for (let j = i + 1; j < fleet.length; j++) {
        fleetExchange(fleet[i]!, fleet[j]!, ticketUuid, lg);
      }
    }
    if (fleet.map((d) => d.rows.length).join(",") === before) return;
  }
}

/**
 * One step for one device, mirroring `runBatonPrint`'s decision→effect. A
 * fresh `now` (no createdAt) keeps the 60 s strand alerts out of the
 * scenario's path — these scenarios must resolve in milliseconds.
 */
function fleetStep(d: FleetDevice, creator: string, now: number): string {
  const fold = foldPrintBaton(d.rows, creator);
  const myRequest = d.rows.find(
    (r) =>
      r.action === "PRINT_REQUEST" &&
      (r.payload?.device_id as string | undefined) === d.id,
  );
  const decision = decidePrint(fold, {
    me: d.id,
    capable: capableOf(d),
    now,
    requestedAt: myRequest ? myRequest.time_stamp : null,
  });
  switch (decision.kind) {
    case "send":
      if (d.broken) {
        fleetPush(d, "PRINT_PASS", { reason: "stranded" }, now);
        break;
      }
      d.prints++;
      d.sends.push({ held: fold.holder === d.id });
      fleetPush(d, "PRINT_SUCCESS", {}, now);
      break;
    case "pass":
      fleetPush(d, "PRINT_PASS", {}, now);
      break;
    case "request":
      d.requestedAt = now;
      fleetPush(d, "PRINT_REQUEST", {}, now);
      break;
    case "reassign":
      d.reassigned = true;
      fleetPush(d, "PRINT_REASSIGN", { to: decision.to }, now);
      break;
    default:
      break;
  }
  return decision.kind;
}

/**
 * Run one scenario to resolution: shuffle the fleet each round (seeded),
 * step every device, converge. Stops when the fold is terminal or a round
 * produces no new rows and no print.
 *
 * `partialViews` additionally runs a pass where devices step WITHOUT a full
 * converge between them — so a stale holder can act on a chain that is in
 * flight (the guard `reassignAuthors.includes(me)` is only reachable when a
 * holder observes its own reassign after the fact). Without this pass the
 * tests would never execute that branch.
 */
function runFleet(
  fleet: FleetDevice[],
  creator: string,
  rng: () => number,
  ticketUuid: string,
  lg: string,
  opts: { partialViews?: boolean } = {},
): void {
  let now = 1_000_000;
  for (let round = 0; round < 200; round++) {
    const order = fleet.map((d) => d.id);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const beforeRows = fleet.map((d) => d.rows.length).join(",");
    const beforePrints = fleet.reduce((n, d) => n + d.prints, 0);
    for (const id of order) {
      fleetStep(fleet.find((d) => d.id === id)!, creator, now);
    }
    if (opts.partialViews) {
      // Only the creator/holder pair exchanges — a partial view, not a
      // converge. The stale holder can now see its own reassign in flight.
      fleetPairExchange(fleet, creator, ticketUuid, lg);
    } else {
      fleetConverge(fleet, ticketUuid, lg);
    }
    now += 1000;
    const fold = foldPrintBaton(fleet[0]!.rows, creator);
    if (fold.terminal) return;
    const afterRows = fleet.map((d) => d.rows.length).join(",");
    const afterPrints = fleet.reduce((n, d) => n + d.prints, 0);
    if (afterRows === beforeRows && afterPrints === beforePrints) return;
  }
}

/** Exchange only the rows of the device that currently holds (partial view). */
function fleetPairExchange(
  fleet: FleetDevice[],
  creator: string,
  ticketUuid: string,
  lg: string,
): void {
  const fold = foldPrintBaton(fleet[0]!.rows, creator);
  const holder = fleet.find((d) => d.id === fold.holder);
  if (!holder) return;
  for (const other of fleet) {
    if (other === holder) continue;
    fleetExchange(holder, other, ticketUuid, lg);
  }
}

function expectFleetResolved(fleet: FleetDevice[], creator: string): void {
  const total = fleet.reduce((n, d) => n + d.prints, 0);
  expect(total, "physical prints").toBe(1);
  const printers = fleet.filter((d) => d.prints > 0);
  expect(printers).toHaveLength(1);
  expect(printers[0]!.broken, "the printer that printed must not be broken").toBe(false);
  expect(printers[0]!.configured, "the printer that printed must be configured").toBe(true);

  // Only the holder ever opens a send (I3).
  for (const d of fleet) {
    for (const s of d.sends) {
      expect(s.held, `device ${d.id} opened a send without holding the baton`).toBe(true);
    }
  }

  // Every replica folds to the identical terminal chain (I4).
  const folds = fleet.map((d) => foldPrintBaton(d.rows, creator));
  for (const f of folds) {
    expect(f.state).toBe("printed");
    expect(f.terminal).toBe(true);
    expect(f.conflict).toEqual([]);
  }
  const chain = JSON.stringify(folds[0]!.chain);
  for (const f of folds) {
    expect(JSON.stringify(f.chain)).toBe(chain);
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Scenario 1 — guest ticket, 3 admin apps. The server is device A (the
// holder): no printer, so it announces. Admin #2's printer is broken,
// admin #3's works.
// ---------------------------------------------------------------------------

describe("fleet scenario 1 — guest ticket, 3 admins, one working printer", () => {
  for (let i = 0; i < REPEATS; i++) {
    it(`repeat ${i + 1}/${REPEATS}`, () => {
      const lg = `lg-s1-${i}`;
      const ticket = `t-s1-${i}`;
      const rng = mulberry32(1000 + i);

      // The server replica (device A) is the creator/holder — it has no
      // printer, so it announces and reassigns like any non-capable holder.
      const server = fleetDevice("server", "", { configured: false });
      const admin1 = fleetDevice("dev-1", "adm-1", { configured: false });
      const admin2 = fleetDevice("dev-2", "adm-2", { configured: true, broken: true });
      const admin3 = fleetDevice("dev-3", "adm-3", { configured: true });
      const fleet = [server, admin1, admin2, admin3];

      // The server announces at completion (guest ticket → server is holder).
      fleetPush(server, "PRINT_PASS", {}, 1000);
      fleetConverge(fleet, ticket, lg);

      // Two passes: a clean converge, then a partial-view pass where a stale
      // holder can observe its own reassign in flight (the stand-down guard).
      runFleet(fleet, "server", rng, ticket, lg);
      if (!foldPrintBaton(fleet[0]!.rows, "server").terminal) {
        runFleet(fleet, "server", rng, ticket, lg, { partialViews: true });
      }
      expectFleetResolved(fleet, "server");
      // The stand-down guard was actually reachable in this run.
      expect(fleet.some((d) => d.reassigned), "no device reassigned — guard not exercised").toBe(
        true,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Scenario 2 — admin ticket created on admin account #1, 3 apps. Admin #1
// has no printer, #2's is broken, #3's works. This is NOT a guest ticket:
// the creator's device is chain[0], so the server never participates.
// ---------------------------------------------------------------------------

describe("fleet scenario 2 — admin ticket (creator admin #1), 3 apps", () => {
  for (let i = 0; i < REPEATS; i++) {
    it(`repeat ${i + 1}/${REPEATS}`, () => {
      const lg = `lg-s2-${i}`;
      const ticket = `t-s2-${i}`;
      const rng = mulberry32(2000 + i);

      const admin1 = fleetDevice("dev-1", "adm-1", { configured: false });
      const admin2 = fleetDevice("dev-2", "adm-2", { configured: true, broken: true });
      const admin3 = fleetDevice("dev-3", "adm-3", { configured: true });
      const fleet = [admin1, admin2, admin3];

      // chain[0] = the creating device (dev-1); no announce row needed — the
      // holder's own loop announces when it cannot print.
      runFleet(fleet, "dev-1", rng, ticket, lg);
      expectFleetResolved(fleet, "dev-1");
    });
  }
});

// ---------------------------------------------------------------------------
// Scenario 4 — the stale-holder guard. A holder that already reassigned must
// stand down when it comes back online and sees its own reassign. This is the
// branch that a fast-converging fleet never reaches (the holder acts before it
// ever observes the reassign), so it is driven directly: the creator
// reassigns, then acts again with the reassign visible.
// ---------------------------------------------------------------------------

describe("fleet scenario 4 — a stale holder stands down after its own reassign", () => {
  it("the reassigned creator never sends again", () => {
    const lg = "lg-s4";
    const ticket = "t-s4";

    // A genuinely stale creator: it reassigns but the successor has NOT
    // printed yet (no terminal row), then comes back online. It is capable
    // again (its printer was fixed) and still chain[0] — the ONLY thing that
    // may stop it sending is the stand-down guard. A terminal short-circuit
    // cannot mask the guard here because no PRINT_SUCCESS exists yet.
    //
    // Built from scratch on one ticket: the creator announces, the successor
    // requests, the creator reassigns, nobody prints.
    const creator = fleetDevice("dev-1", "adm-1", { configured: false });
    const successor = fleetDevice("dev-2", "adm-2", { configured: true });
    const fleet = [creator, successor];

    // The creator announces (it held, no printer).
    fleetStep(creator, "dev-1", 1_000_000);
    expect(creator.rows.at(-1)?.action).toBe("PRINT_PASS");
    fleetConverge(fleet, ticket, lg);

    // The successor requests; the creator reassigns to it and is out.
    fleetStep(successor, "dev-1", 1_000_001);
    expect(successor.rows.at(-1)?.action).toBe("PRINT_REQUEST");
    fleetConverge(fleet, ticket, lg);

    fleetStep(creator, "dev-1", 1_000_002);
    expect(creator.rows.at(-1)?.action).toBe("PRINT_REASSIGN");
    expect(creator.reassigned).toBe(true);
    fleetConverge(fleet, ticket, lg);

    // No success yet — the successor has not printed. The creator returns
    // capable (printer fixed) with its reassign visible: it must stand down.
    const staleFold = foldPrintBaton(creator.rows, "dev-1");
    expect(staleFold.terminal).toBe(false);
    expect(staleFold.reassignAuthors).toContain("dev-1");
    const decision = decidePrint(staleFold, {
      me: creator.id,
      capable: true,
      now: 1_000_003,
    });
    expect(decision.kind).toBe("stand-down");
    expect(creator.sends).toHaveLength(0);

    // The successor prints; exactly one physical print for the ticket.
    fleetStep(successor, "dev-1", 1_000_004);
    fleetConverge(fleet, ticket, lg);
    expectFleetResolved(fleet, "dev-1");
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — admin ticket on admin #1, 10 apps. #1 has no printer,
// #2–#8 are broken, #10 works.
// ---------------------------------------------------------------------------

describe("fleet scenario 3 — admin ticket (creator admin #1), 10 apps", () => {
  for (let i = 0; i < REPEATS; i++) {
    it(`repeat ${i + 1}/${REPEATS}`, () => {
      const lg = `lg-s3-${i}`;
      const ticket = `t-s3-${i}`;
      const rng = mulberry32(3000 + i);

      const fleet: FleetDevice[] = [
        fleetDevice("dev-1", "adm-1", { configured: false }),
        ...Array.from({ length: 7 }, (_, k) =>
          fleetDevice(`dev-${k + 2}`, `adm-${k + 2}`, { configured: true, broken: true }),
        ),
        // dev-9: no printer (configured: false) — an extra non-capable peer.
        fleetDevice("dev-9", "adm-9", { configured: false }),
        fleetDevice("dev-10", "adm-10", { configured: true }),
      ];

      runFleet(fleet, "dev-1", rng, ticket, lg);
      expectFleetResolved(fleet, "dev-1");
    });
  }
});
