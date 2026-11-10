/**
 * Client-side baton print loop (CORE-LOGIC-PRINT-LOGIC.md). The fold is
 * computed live from the five PRINT_* rows in ticket_log; the engine's
 * `decidePrint` picks this device's single next move; every row this device
 * writes is an ordinary ticket_log that rides sync/P2P. No claim, no confirm,
 * no print_record — the local ledger is the log itself.
 *
 * The loop is identical on the web client and the RN app; only the print
 * transport, the capability policy, the clock-offset source, and the DB read
 * differ — all injected via `BatonDeps`.
 */

import {
  decidePrint,
  foldPrintBaton,
  manualTakeoverAllowed,
  PRINT_ALERT_MS,
  PRINT_FAILED,
  PRINT_PASS,
  PRINT_REASON_STRANDED,
  PRINT_REASSIGN,
  PRINT_REQUEST,
  PRINT_SPINNER_FAIL_MS,
  PRINT_SUCCESS,
  type PrintFold,
  type PrintRow,
} from './printProtocol.js';

export interface BatonResult {
  outcome: 'printed' | 'advanced' | 'alert' | 'conflict' | 'waiting' | 'failed';
  // Arm/re-arm local timers: alertInMs = time until my own PRINT_REQUEST
  // strands (60 s (!)); failInMs = time until this device's local 5:00
  // give-up window elapses (Phase 4 — the hook arms the earlier of the two).
  // No retryInMs — a refused send now fails over immediately (item 9)
  // instead of retrying on a cooldown.
  alertInMs?: number;
  failInMs?: number;
}

/** SQL every client uses to load the baton rows for one ticket. */
export const PRINT_ROWS_SQL = `SELECT action, payload, "time_stamp", admin_uuid
     FROM ticket_log
     WHERE ticket_uuid = ?
       AND action IN ('PRINT_SUCCESS', 'PRINT_PASS', 'PRINT_REQUEST', 'PRINT_REASSIGN', 'PRINT_FAILED')
     ORDER BY "time_stamp", uuid`;

/**
 * SQL for the chain seed: the ticket's FIRST log row of ANY action. That row
 * carries `payload.device_id` (stamped once by the ticket-create path) and is
 * what chain[0] is seeded from. PRINT_ROWS_SQL deliberately filters to the
 * print actions, so the seed needs its own query.
 */
export const CHAIN_SEED_SQL = `SELECT action, payload, "time_stamp", admin_uuid
     FROM ticket_log
     WHERE ticket_uuid = ?
     ORDER BY "time_stamp", uuid
     LIMIT 1`;

export function parsePrintPayload(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Map raw ticket_log rows (either client's driver shape) to `PrintRow`s. */
export function mapPrintRows(
  rows: {
    action: string;
    payload: string | null;
    time_stamp: number | string;
    admin_uuid: string | null;
  }[],
): PrintRow[] {
  return (rows ?? []).map((r) => {
    const payload = parsePrintPayload(r.payload);
    return {
      action: r.action,
      author: r.admin_uuid || null,
      time_stamp: Number(r.time_stamp),
      payload,
      // The acting device, read straight from the row payload (the fold also
      // falls back to `payload.device_id` for rows mapped elsewhere).
      device_id: (payload?.device_id as string) || null,
      // Per-author ordinal (Phase 2), read from the row payload.
      seq: typeof payload?.seq === 'number' ? payload.seq : null,
    };
  });
}

/** Device of a seed row: payload.device_id, else the acting admin. */
export function seedDeviceOf(row: PrintRow | null): string | null {
  if (!row) return null;
  return (
    row.device_id ??
    (row.payload?.device_id as string | undefined) ??
    row.author ??
    null
  );
}

/** Fold = engine foldPrintBaton over the ticket's PRINT_* rows. */
export async function readPrintFold<
  Ticket extends { uuid: string; admin_uuid?: string | null; device_uuid?: string | null },
>(
  getRows: (ticket_uuid: string) => Promise<PrintRow[]>,
  ticket: Ticket,
  getSeedRow?: (ticket_uuid: string) => Promise<PrintRow | null>,
): Promise<{ fold: PrintFold; rows: PrintRow[] }> {
  const rows = await getRows(ticket.uuid);
  const seedRow = getSeedRow ? await getSeedRow(ticket.uuid) : null;
  const fold = foldPrintBaton(rows, seedDeviceOf(seedRow));
  return { fold, rows };
}

const MAX_ITERATIONS = 10;

/**
 * Test-only: clear per-ticket baton session state. Kept for the suites that
 * reset module state between cases; there is no send-failure cooldown anymore
 * (item 9 replaced retry-with-backoff with immediate failover), so this is a
 * no-op retained for API stability.
 */
export function _resetBatonSendStateForTests(): void {}

export interface BatonDeps<Ticket, TLG, TAdmin> {
  /** Load the ticket's PRINT_* baton rows (client reads its real DB). */
  getPrintRows(ticket_uuid: string): Promise<PrintRow[]>;
  /** Load the ticket's first log row (any action) — the chain seed. */
  getChainSeedRow(ticket_uuid: string): Promise<PrintRow | null>;
  /** Write a PRINT_* log (client wraps its appendLog: lock/offset/notify). */
  appendLog(input: {
    ticket_uuid: string;
    location_group_uuid: string;
    action: string;
    time_stamp: number;
    payload: Record<string, unknown>;
    admin_uuid: string;
  }): Promise<unknown>;
  /** Server-clock offset in ms for decidePrint's `now`. */
  getServerOffset(): Promise<number>;
  /** This device's stable id (`device_uuid`) — the baton's identity. */
  deviceUuid(): string;
  /** Per-device monotonic ordinal for PRINT_* rows this device authors
   *  (Phase 2). Returned value must be strictly greater than every value
   *  previously returned on this device; the counter is persisted in local
   *  metadata so it survives restarts. The fold uses it to order same-author
   *  rows (pass vs reassign) without any cross-device clock. */
  nextPrintSeq(): Promise<number>;
  /** Phase 3: local observation time for this device's own unanswered
   *  PRINT_REQUEST on a ticket — set once (first observation) and persisted
   *  in local storage keyed by ticket. Arms the requester-strand 60 s alert.
   *  Called only when this device has a PRINT_REQUEST row in the fold. May be
   *  async (a client's local storage can be async); the loop awaits it. */
  observeRequest(ticket_uuid: string): number | Promise<number>;
  /** Phase 3: local observation time for the creator-strand state (this
   *  device's own failed send or reassign) — set once and persisted in local
   *  storage keyed by ticket. Arms the original-device 60 s strand alert. */
  observeCreatorStrand(ticket_uuid: string): number | Promise<number>;
  /** Phase 4: READ-ONLY local observation of the print-pending state (the
   *  spinner-start window the UI armed) — returns null when this device has
   *  no observation (silent print off / never rendered the ticket), and
   *  never creates one. The loop publishes PRINT_FAILED only once this
   *  device's own 5:00 window has elapsed from it. */
  getPrintPendingObservedAt?(ticket_uuid: string): number | Promise<number> | null;
  /** Config-level capability (silent mode + printer configured for this
   *  platform). Re-checked each iteration; cooldown handled by the loop. */
  isKitchenCapable(): boolean;
  /** Deliver the ticket bytes — the client's print transport.
   *  `job_id` is the baton's idempotent-retry marker (ticket_uuid). The
   *  relay transport sends it so a retried send after a lost response does
   *  not produce a second physical print. Manual reprints (the client's own
   *  print buttons) never go through here and carry no job_id. */
  printTicket(args: {
    ticket: Ticket;
    locationGroup: TLG;
    admin: TAdmin;
    translations: string[];
    job_id: string;
  }): Promise<boolean>;
  /** Optional error sink (RN routes to its file logger). Default console. */
  logError?(msg: string, err?: unknown): void;
}

async function appendPrintLog<Ticket extends { uuid: string; location_group_uuid: string }>(
  deps: BatonDeps<Ticket, any, any>,
  ticket: Ticket,
  admin_uuid: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await deps.appendLog({
    ticket_uuid: ticket.uuid,
    location_group_uuid: ticket.location_group_uuid,
    action,
    time_stamp: Date.now(),
    // The acting device rides in the payload — `admin_uuid` stays the admin
    // (backlog item 4). The fold reads this key to identify actors. `seq` is
    // the per-device ordinal the fold uses to order this device's own rows
    // (Phase 2) — one counter per device, persisted in local metadata.
    payload: { ...payload, device_id: deps.deviceUuid(), seq: await deps.nextPrintSeq() },
    admin_uuid,
  });
}

export async function runBatonPrint<
  Ticket extends {
    uuid: string
    admin_uuid?: string | null
    device_uuid?: string | null
    location_group_uuid: string
    time_stamp?: string | number | null
  },
  TLG,
  TAdmin extends { uuid: string },
>(
  deps: BatonDeps<Ticket, TLG, TAdmin>,
  args: {
    ticket: Ticket;
    locationGroup: TLG;
    admin: TAdmin;
    translations: string[];
  },
): Promise<BatonResult> {
  const { ticket, locationGroup, admin, translations } = args;
  // Identity is the device, not the admin: two devices on one admin must not
  // both believe they hold the ticket (backlog item 4). `admin` stays in the
  // args for the transports and for logging.
  const me = deps.deviceUuid();
  const offset = await deps.getServerOffset();
  const logError = deps.logError ?? ((msg: string, err?: unknown) => console.error(msg, err));
  let advanced = false;

  // chain[0] is the device of the ticket's first log row (any action), which
  // carries payload.device_id (backlog item 4).
  const seed = seedDeviceOf(await deps.getChainSeedRow(ticket.uuid));

  // Phase 4: remaining time on this device's local 5:00 give-up window,
  // recomputed each iteration from the read-only pending observation.
  // Unresolved returns carry it as `failInMs` so the hook re-runs the loop
  // exactly when the window elapses (the earlier of alertInMs/failInMs wins).
  let failArmMs: number | undefined;
  const withFailTimer = <R extends BatonResult>(result: R): R =>
    failArmMs != null && result.failInMs == null
      ? { ...result, failInMs: failArmMs }
      : result;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const rows = await deps.getPrintRows(ticket.uuid);
    const fold = foldPrintBaton(rows, seed);
    const myRequest = rows.find(
      (r) =>
        r.action === PRINT_REQUEST &&
        (r.device_id ?? (r.payload?.device_id as string | undefined) ?? null) ===
          me,
    );
    const now = Date.now() + offset;
    const capable = deps.isKitchenCapable();

    // Phase 4: the durable 5-minute give-up. The window runs from THIS
    // device's own spinner-start observation (read-only — the UI arms it; no
    // observation means this device never watched the ticket and never
    // declares). `!fold.terminal` carries both spec gates at once: no
    // PRINT_SUCCESS applied and no PRINT_FAILED yet (by anyone — the first
    // declaration to land does the work for every device, and its count bump
    // re-folds peers before their own timers fire). Conflicts keep the
    // attention verdict, so they never publish over it.
    const pendingObservedAt =
      (await deps.getPrintPendingObservedAt?.(ticket.uuid)) ?? null;
    failArmMs =
      pendingObservedAt != null && !fold.terminal && fold.state !== 'conflict'
        ? pendingObservedAt + PRINT_SPINNER_FAIL_MS - now
        : undefined;
    if (failArmMs != null && failArmMs <= 0) {
      await appendPrintLog(deps, ticket, admin.uuid, PRINT_FAILED, {});
      advanced = true;
      // Re-read: the fold now resolves failed and decidePrint stands this
      // device — and every other — down on the next iteration.
      continue;
    }

    // Phase 3: local observation of the creator-strand state — set once, so
    // the 60 s window is measured from when this device first saw its own
    // failed send / reassign, not from any foreign row stamp.
    const observedAt = await deps.observeCreatorStrand(ticket.uuid);
    const decision = decidePrint(fold, {
      me,
      capable,
      now,
      // The requester window is armed the first time this device sees its own
      // unanswered PRINT_REQUEST.
      requestedObservedAt: myRequest
        ? await deps.observeRequest(ticket.uuid)
        : null,
      observedAt,
    });

    switch (decision.kind) {
      case 'send': {
        let printed = false;
        try {
          printed = await deps.printTicket({
            ticket,
            locationGroup,
            admin,
            translations,
            job_id: ticket.uuid,
          });
        } catch (err) {
          logError(`❌ Print failed ${ticket.uuid}`, err);
          printed = false;
        }

        if (printed) {
          await appendPrintLog(deps, ticket, admin.uuid, PRINT_SUCCESS, {});
          return { outcome: 'printed' };
        }

        // Transport refused. Failover (item 9): this device does NOT retry —
        // a refused send is treated as a dead printer (wrong IP, offline,
        // wrong port), and retrying the same device never fixes that. Write a
        // `stranded` pass that opens the floor, so a capable peer requests and
        // this holder reassigns to it. If no peer is capable the fold ends
        // stranded and the 60 s alert fires.
        await appendPrintLog(deps, ticket, admin.uuid, PRINT_PASS, {
          reason: PRINT_REASON_STRANDED,
        });
        // Stop here: this device is out of the chain. Re-iterating would
        // re-read the fold, see itself as holder with an open pass and no
        // requests, and send again — the exact retry this replaces.
        return { outcome: 'advanced' };
      }

      case 'pass':
        await appendPrintLog(deps, ticket, admin.uuid, PRINT_PASS, { reason: 'not_capable' });
        advanced = true;
        continue;

      case 'request':
        await appendPrintLog(deps, ticket, admin.uuid, PRINT_REQUEST, {});
        advanced = true;
        continue;

      case 'reassign':
        await appendPrintLog(deps, ticket, admin.uuid, PRINT_REASSIGN, { to: decision.to });
        advanced = true;
        continue;

      case 'alert':
        return withFailTimer({ outcome: 'alert' });

      case 'attention':
        return { outcome: 'conflict' };

      case 'stand-down':
        // Phase 4: a failed strand is its own outcome — surface it for
        // manual resolution, never misreport it as printed.
        if (fold.failed) return { outcome: 'failed' };
        if (fold.terminal) return { outcome: 'printed' };
        // Original device that already tried to print (reassign or local print
        // failure) but hasn't reached the 60 s strand window yet: arm a timer
        // to re-check so the alert surfaces promptly when it does.
        if (
          fold.chain.length > 0 &&
          fold.chain[0] === me &&
          !fold.terminal &&
          observedAt != null &&
          (fold.reassignAuthors.includes(me) || fold.printFailAuthors.includes(me))
        ) {
          const remaining = observedAt + PRINT_ALERT_MS - now;
          if (remaining > 0 && remaining <= PRINT_ALERT_MS) {
            return withFailTimer({
              outcome: advanced ? 'advanced' : 'waiting',
              alertInMs: remaining,
            });
          }
        }
        return withFailTimer({ outcome: advanced ? 'advanced' : 'waiting' });

      case 'wait': {
        // Waiter on my own request: arm the 60 s (!) alert timer from the
        // local observation time, never the request row's foreign stamp.
        if (myRequest && !fold.terminal && fold.holder !== me) {
          const requestedObservedAt = await deps.observeRequest(ticket.uuid);
          return withFailTimer({
            outcome: advanced ? 'advanced' : 'waiting',
            alertInMs: Math.max(0, requestedObservedAt + PRINT_ALERT_MS - now),
          });
        }
        // Original device with a local print failure (no reassign): arm the
        // 60 s (!) alert timer so the alert surfaces when the strand window
        // elapses, even though decidePrint currently returns 'wait'.
        if (
          fold.chain.length > 0 &&
          fold.chain[0] === me &&
          !fold.terminal &&
          fold.printFailAuthors.includes(me) &&
          observedAt != null
        ) {
          const remaining = observedAt + PRINT_ALERT_MS - now;
          if (remaining > 0 && remaining <= PRINT_ALERT_MS) {
            return withFailTimer({
              outcome: advanced ? 'advanced' : 'waiting',
              alertInMs: remaining,
            });
          }
        }
        return withFailTimer({ outcome: advanced ? 'advanced' : 'waiting' });
      }
    }
  }

  return withFailTimer({ outcome: advanced ? 'advanced' : 'waiting' });
}

// The (!) press: re-validate the fold at press time, then take the ticket
// terminal for everyone. Returns false when truth already resolved it.
export async function manualTakeover<
  Ticket extends {
    uuid: string
    admin_uuid?: string | null
    device_uuid?: string | null
    location_group_uuid: string
  },
  TLG,
  TAdmin extends { uuid: string },
>(
  deps: BatonDeps<Ticket, TLG, TAdmin>,
  ticket: Ticket,
  admin: TAdmin,
): Promise<boolean> {
  const rows = await deps.getPrintRows(ticket.uuid);
  const seed = await deps.getChainSeedRow(ticket.uuid);
  const fold = foldPrintBaton(rows, seedDeviceOf(seed));
  if (!manualTakeoverAllowed(fold)) return false;
  await appendPrintLog(deps, ticket, admin.uuid, PRINT_SUCCESS, { manual: true });
  return true;
}
