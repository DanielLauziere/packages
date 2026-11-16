/**
 * Print-baton FLEET regression gate (CORE-LOGIC-PRINT-LOGIC.md).
 *
 * Four independent devices, one location group, ten tickets — the canonical
 * failover scenario, run in-process so it can gate every PR:
 *
 *   owner   live ESCPOS/TCP printer (this test binds the capture server)
 *   mesero  closed port → the OS refuses the connect
 *   pos     closed port → refused
 *   gerente closed port → refused
 *
 * All ten tickets are created on `mesero`, a device whose own printer is dead,
 * so every one of them has to travel: the creator's send is refused →
 * PRINT_PASS {stranded} opens the floor → a capable peer requests → the holder
 * reassigns → the printable device sends the bytes → PRINT_SUCCESS lands on
 * every device.
 *
 * What is REAL here: the baton loop and fold (production code), the ticket_log
 * SQL every client runs (PRINT_ROWS_SQL / CHAIN_SEED_SQL), the ESC/POS
 * renderer, and the TCP socket — a real connect/write/flush against a real
 * listener, refused exactly like the Rust `print_tcp` does. What is simulated
 * is only the transport BETWEEN devices: `syncFleet` copies ticket_log rows
 * between the four databases, which is what the bucket sync does on the wire.
 *
 * Why this file exists: the 4-device Playwright fleet e2e could never run
 * (Playwright cannot attach to a real Tauri window, and a plain browser can
 * never TCP-print — `isKitchenCapable` gates ESCPOS behind IS_TAURI), so the
 * failover contract had no automated gate at all. This is that gate. The
 * shipped-app wiring (boot → driver → capability → print_tcp) is covered
 * separately by frontend/e2e/tauri/printBaton/printBatonSmoke.spec.ts, and the
 * Rust socket itself by `cargo test` in src-tauri.
 */

import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import net from "node:net";
import { randomUUID } from "node:crypto";

import {
  CHAIN_SEED_SQL,
  PRINT_ROWS_SQL,
  mapPrintRows,
  runBatonPrint,
  type BatonDeps,
} from "./batonLoop.js";
import {
  PRINT_FAILED,
  PRINT_PASS,
  PRINT_REASON_STRANDED,
  PRINT_REASSIGN,
  PRINT_REQUEST,
  PRINT_SPINNER_FAIL_MS,
  PRINT_SUCCESS,
} from "./printProtocol.js";
import { ticketToEscPos } from "./escpos.js";

const LOCATION_GROUP = "lg-fleet";
const TICKET_COUNT = 10;

/** The ticket as the ESC/POS renderer sees it (kitchen ticket shape). */
interface FleetTicket {
  uuid: string;
  id: number;
  admin_uuid: string;
  device_uuid: string;
  location_group_uuid: string;
  time_stamp: string;
  total: string;
  tax_total: string;
  tip_total: string;
  grand_total: string;
  grand_total_cents: number;
  menu_items: Array<{
    uuid: string;
    name: string;
    price_whole: number;
    price_whundredths: number;
  }>;
}

interface FleetLocation {
  name?: string;
  tax_percentage?: number;
  tip_percentage?: number;
  simple_print?: boolean;
  print_notes?: boolean;
}

const LOCATION: FleetLocation = {
  name: "DirectEatz Fleet",
  tax_percentage: 0,
  tip_percentage: 0,
  simple_print: false,
  print_notes: false,
};

interface LogRow {
  uuid: string;
  ticket_uuid: string;
  location_group_uuid: string;
  action: string;
  payload: string | null;
  time_stamp: number;
  admin_uuid: string | null;
}

interface TicketRow {
  uuid: string;
  id: number;
  admin_uuid: string;
  device_uuid: string;
  location_group_uuid: string;
  time_stamp: number;
}

/**
 * One simulated install: its own SQLite database (so its own device_uuid,
 * ticket_log and print observations), its own admin, and its own kitchen
 * printer address — the four replicas must never collapse into one device.
 */
class Device {
  private readonly db = new DatabaseSync(":memory:");
  private readonly observations = new Map<string, Map<string, number>>();
  private readonly pendingWindows = new Map<string, number>();
  private seq = 0;
  readonly deps: BatonDeps<FleetTicket, FleetLocation, { uuid: string }>;

  constructor(
    readonly name: string,
    readonly adminUuid: string,
    private readonly printerPort: number,
  ) {
    this.db.exec(`
      CREATE TABLE ticket_log (
        uuid TEXT PRIMARY KEY,
        ticket_uuid TEXT,
        location_group_uuid TEXT,
        action TEXT,
        payload TEXT,
        time_stamp INTEGER,
        admin_uuid TEXT
      );
      CREATE TABLE ticket (
        uuid TEXT PRIMARY KEY,
        id INTEGER,
        admin_uuid TEXT,
        device_uuid TEXT,
        location_group_uuid TEXT,
        time_stamp INTEGER
      );
    `);

    this.deps = {
      // The exact SQL every client runs against its own database.
      getPrintRows: async (ticket_uuid) =>
        mapPrintRows(
          this.db.prepare(PRINT_ROWS_SQL).all(ticket_uuid) as LogRow[],
        ),
      getChainSeedRow: async (ticket_uuid) => {
        const row = this.db
          .prepare(CHAIN_SEED_SQL)
          .get(ticket_uuid) as LogRow | undefined;
        return row ? (mapPrintRows([row])[0] ?? null) : null;
      },
      appendLog: async (input) => {
        this.insertLog(input);
      },
      getServerOffset: async () => 0,
      deviceUuid: () => this.name,
      // Per-device ordinal persisted beside device_uuid in the real client.
      nextPrintSeq: async () => ++this.seq,
      observeRequest: (ticket_uuid) => this.observe("request", ticket_uuid),
      observeCreatorStrand: (ticket_uuid) => this.observe("strand", ticket_uuid),
      // READ-ONLY, like the client: the loop never arms a window the UI
      // never showed. The test arms it explicitly for the give-up case.
      getPrintPendingObservedAt: (ticket_uuid) =>
        this.pendingWindows.get(ticket_uuid) ?? null,
      isKitchenCapable: () => true,
      isSilentPrintOn: () => true,
      printTicket: ({ ticket }) => this.sendToPrinter(ticket),
      logError: () => {},
    };
  }

  /** The production print path: render the kitchen ticket, then TCP send. */
  private async sendToPrinter(ticket: FleetTicket): Promise<boolean> {
    const bytes = await ticketToEscPos(ticket, LOCATION, {
      lang: "es",
      wrapMode: "truncate",
      kitchenTicket: true,
      beepMode: "escb",
      receiptPrinterWidthMm: 80,
    });
    return sendTcp("127.0.0.1", this.printerPort, bytes);
  }

  private insertLog(input: {
    ticket_uuid: string;
    location_group_uuid: string;
    action: string;
    time_stamp: number;
    payload: Record<string, unknown>;
    admin_uuid: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO ticket_log
           (uuid, ticket_uuid, location_group_uuid, action, payload, time_stamp, admin_uuid)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.ticket_uuid,
        input.location_group_uuid,
        input.action,
        JSON.stringify(input.payload),
        input.time_stamp,
        input.admin_uuid,
      );
  }

  /** First local observation of a state — windows are measured from here. */
  private observe(kind: string, ticket_uuid: string): number {
    let byTicket = this.observations.get(kind);
    if (!byTicket) {
      byTicket = new Map<string, number>();
      this.observations.set(kind, byTicket);
    }
    const existing = byTicket.get(ticket_uuid);
    if (existing) return existing;
    const now = Date.now();
    byTicket.set(ticket_uuid, now);
    return now;
  }

  /** Arm the UI's spinner window as if the ticket had been watched. */
  armPendingWindow(ticket_uuid: string, at: number): void {
    this.pendingWindows.set(ticket_uuid, at);
  }

  /** Create the ticket here: the row plus the creating device's seed log. */
  createTicket(ticket: FleetTicket): void {
    this.db
      .prepare(
        `INSERT INTO ticket (uuid, id, admin_uuid, device_uuid, location_group_uuid, time_stamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ticket.uuid,
        ticket.id,
        ticket.admin_uuid,
        this.name,
        ticket.location_group_uuid,
        Date.now(),
      );
    // The chain[0] seed: the first log row of ANY action carries the creating
    // device (backlog item 4) — exactly what the ticket-create path stamps.
    this.insertLog({
      ticket_uuid: ticket.uuid,
      location_group_uuid: ticket.location_group_uuid,
      action: "SET_STATUS_COMPLETE",
      time_stamp: Date.now(),
      payload: { device_id: this.name },
      admin_uuid: this.adminUuid,
    });
  }

  run(ticket: FleetTicket) {
    return runBatonPrint(this.deps, {
      ticket,
      locationGroup: LOCATION,
      admin: { uuid: this.adminUuid },
      translations: [],
    });
  }

  hasPrintSuccess(ticket_uuid: string): boolean {
    return (
      this.db
        .prepare(
          `SELECT 1 AS ok FROM ticket_log
            WHERE ticket_uuid = ? AND action = 'PRINT_SUCCESS'
            LIMIT 1`,
        )
        .get(ticket_uuid) !== undefined
    );
  }

  actionsFor(ticket_uuid: string): string[] {
    return (
      this.db
        .prepare(
          `SELECT action FROM ticket_log
            WHERE ticket_uuid = ? AND action LIKE 'PRINT_%'
            ORDER BY "time_stamp", uuid`,
        )
        .all(ticket_uuid) as Array<{ action: string }>
    ).map((r) => r.action);
  }

  printRowsFor(ticket_uuid: string) {
    return mapPrintRows(
      this.db.prepare(PRINT_ROWS_SQL).all(ticket_uuid) as LogRow[],
    );
  }

  allLogs(): LogRow[] {
    return this.db.prepare(`SELECT * FROM ticket_log`).all() as LogRow[];
  }

  allTickets(): TicketRow[] {
    return this.db.prepare(`SELECT * FROM ticket`).all() as TicketRow[];
  }

  /** Merge a peer's rows — the bucket sync's effect on one database. */
  merge(logs: LogRow[], tickets: TicketRow[]): void {
    const logStmt = this.db.prepare(
      `INSERT OR IGNORE INTO ticket_log
         (uuid, ticket_uuid, location_group_uuid, action, payload, time_stamp, admin_uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of logs) {
      logStmt.run(
        row.uuid,
        row.ticket_uuid,
        row.location_group_uuid,
        row.action,
        row.payload,
        row.time_stamp,
        row.admin_uuid,
      );
    }
    const ticketStmt = this.db.prepare(
      `INSERT OR IGNORE INTO ticket
         (uuid, id, admin_uuid, device_uuid, location_group_uuid, time_stamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const row of tickets) {
      ticketStmt.run(
        row.uuid,
        row.id,
        row.admin_uuid,
        row.device_uuid,
        row.location_group_uuid,
        row.time_stamp,
      );
    }
  }

  close(): void {
    this.db.close();
  }
}

/**
 * The TCP send, mirroring `src-tauri/src/tcp_printer.rs`: connect (5 s), write
 * all, flush, shutdown. It never reads a response — a listener that accepts
 * and stays silent would count as a SUCCESS, which is why the dead printers
 * here are closed ports (refused) rather than silent ones.
 */
function sendTcp(host: string, port: number, data: Uint8Array): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (!ok) socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(5000, () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("connect", () => {
      socket.end(Buffer.from(data), () => finish(true));
    });
  });
}

/** A loopback ESCPOS printer: one accepted connection = one print job. */
class CapturePrinter {
  readonly jobs: Buffer[] = [];
  private server: net.Server | null = null;

  async start(): Promise<number> {
    this.server = net.createServer((socket) => {
      const chunks: Buffer[] = [];
      socket.on("data", (chunk: Buffer) => chunks.push(chunk));
      socket.on("end", () => this.jobs.push(Buffer.concat(chunks)));
      socket.on("error", () => {});
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });
    return (this.server!.address() as net.AddressInfo).port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** A loopback port with no listener — connecting to it is refused. */
async function closedPort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** One sync round: every device ends up holding every other device's rows. */
function syncFleet(devices: Device[]): void {
  const logs = new Map<string, LogRow>();
  const tickets = new Map<string, TicketRow>();
  for (const device of devices) {
    for (const row of device.allLogs()) if (!logs.has(row.uuid)) logs.set(row.uuid, row);
    for (const row of device.allTickets())
      if (!tickets.has(row.uuid)) tickets.set(row.uuid, row);
  }
  for (const device of devices) device.merge([...logs.values()], [...tickets.values()]);
}

/**
 * Drive every device until every device holds PRINT_SUCCESS for every ticket.
 * Each round runs the real loop once per (device, ticket) pair, then syncs.
 */
async function driveFleet(
  devices: Device[],
  tickets: FleetTicket[],
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    syncFleet(devices);
    let pending = 0;
    for (const device of devices) {
      for (const ticket of tickets) {
        if (device.hasPrintSuccess(ticket.uuid)) continue;
        pending++;
        await device.run(ticket);
      }
    }
    syncFleet(devices);
    if (pending === 0) return;
    if (Date.now() > deadline) {
      throw new Error(
        `fleet did not converge within ${timeoutMs}ms:\n${fleetState(devices, tickets)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function fleetState(devices: Device[], tickets: FleetTicket[]): string {
  return tickets
    .map((ticket) => {
      const perDevice = devices
        .map((device) => `${device.name}=[${device.actionsFor(ticket.uuid).join(">")}]`)
        .join(" ");
      return `  ${ticket.uuid}: ${perDevice}`;
    })
    .join("\n");
}

/** Ticket numbers the kitchen ticket renders as `# <id>` (escpos.ts). */
function ticketNumbersInJob(job: Buffer): number[] {
  const ids: number[] = [];
  for (const match of job.toString("latin1").matchAll(/#\s*(\d+)/g)) {
    ids.push(Number(match[1]));
  }
  return ids;
}

function makeTicket(id: number, creator: Device): FleetTicket {
  return {
    uuid: `t-${id}`,
    id,
    admin_uuid: creator.adminUuid,
    device_uuid: creator.name,
    location_group_uuid: LOCATION_GROUP,
    time_stamp: new Date().toISOString(),
    total: "10.00",
    tax_total: "0.00",
    tip_total: "0.00",
    grand_total: "10.00",
    grand_total_cents: 1000,
    menu_items: [
      {
        uuid: `item-${id}`,
        name: "Camarones con salsa de langosta",
        price_whole: 10,
        price_whundredths: 0,
      },
    ],
  };
}

describe("print-baton fleet (CORE-LOGIC-PRINT-LOGIC.md)", () => {
  it("ten tickets created on a dead-printer device print exactly once each on the live printer", async () => {
    const printer = new CapturePrinter();
    const livePort = await printer.start();
    const deadPorts = [await closedPort(), await closedPort(), await closedPort()];

    const owner = new Device("owner", "admin-owner", livePort);
    const mesero = new Device("mesero", "admin-mesero", deadPorts[0]);
    const pos = new Device("pos", "admin-pos", deadPorts[1]);
    const gerente = new Device("gerente", "admin-gerente", deadPorts[2]);
    const devices = [owner, mesero, pos, gerente];

    try {
      // Every ticket is created on the device whose own printer is dead, so
      // all ten have to travel to the printable device.
      const tickets: FleetTicket[] = [];
      for (let i = 1; i <= TICKET_COUNT; i++) {
        const ticket = makeTicket(i, mesero);
        tickets.push(ticket);
        mesero.createTicket(ticket);
      }

      await driveFleet(devices, tickets, 60_000);

      // 1. Physical truth: one job per ticket, all of them on the live
      //    printer, each rendering the ticket it belongs to.
      expect(printer.jobs, "physical print jobs").toHaveLength(TICKET_COUNT);
      const printedIds = printer.jobs
        .flatMap((job) => ticketNumbersInJob(job))
        .sort((a, b) => a - b);
      expect(printedIds, "exactly one print per ticket").toEqual(
        tickets.map((ticket) => ticket.id).sort((a, b) => a - b),
      );

      // 2. Every device folded every ticket to PRINT_SUCCESS, and nobody was
      //    abandoned to the 5-minute give-up.
      for (const device of devices) {
        for (const ticket of tickets) {
          expect(
            device.hasPrintSuccess(ticket.uuid),
            `${device.name} folded ticket ${ticket.id}`,
          ).toBe(true);
          expect(
            device.actionsFor(ticket.uuid),
            `${device.name} never gave up on ticket ${ticket.id}`,
          ).not.toContain(PRINT_FAILED);
        }
      }

      // 3. The failover shape on every ticket: the creator's send was
      //    refused, a capable peer requested, the holder reassigned, and the
      //    printable device did the actual printing.
      for (const ticket of tickets) {
        const rows = owner.printRowsFor(ticket.uuid);
        const actions = rows.map((row) => row.action);

        const stranded = rows.some(
          (row) =>
            row.action === PRINT_PASS &&
            row.payload?.reason === PRINT_REASON_STRANDED,
        );
        expect(stranded, `ticket ${ticket.id} recorded a refused send`).toBe(true);
        expect(actions, `ticket ${ticket.id} has a request`).toContain(PRINT_REQUEST);
        expect(actions, `ticket ${ticket.id} was reassigned`).toContain(PRINT_REASSIGN);
        expect(actions, `ticket ${ticket.id} printed`).toContain(PRINT_SUCCESS);

        const success = rows.find((row) => row.action === PRINT_SUCCESS);
        expect(
          success?.device_id,
          `ticket ${ticket.id} printed by the live device`,
        ).toBe(owner.name);

        // The chain really travelled: more than one device authored rows.
        const authors = new Set(rows.map((row) => row.device_id ?? row.author));
        expect(
          [...authors],
          `ticket ${ticket.id} involved several devices`,
        ).toEqual(expect.arrayContaining([mesero.name, owner.name]));
      }
    } finally {
      await printer.stop();
      for (const device of devices) device.close();
    }
  });

  it("a chain nobody can print declares PRINT_FAILED once the 5-minute window elapses", async () => {
    const device = new Device("owner", "admin-owner", await closedPort());
    try {
      const ticket = makeTicket(1, device);
      device.createTicket(ticket);
      // The UI armed the spinner five minutes ago and nothing printed.
      device.armPendingWindow(ticket.uuid, Date.now() - PRINT_SPINNER_FAIL_MS - 1000);

      const result = await device.run(ticket);
      expect(result.outcome).toBe("failed");

      const actions = device.actionsFor(ticket.uuid);
      expect(actions, "the chain gave up").toContain(PRINT_FAILED);
      expect(actions, "nothing printed").not.toContain(PRINT_SUCCESS);
    } finally {
      device.close();
    }
  });
});
