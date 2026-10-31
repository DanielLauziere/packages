/**
 * Client-side baton print loop (CORE-LOGIC-PRINT-LOGIC.md). The fold is
 * computed live from the four PRINT_* rows in ticket_log; the engine's
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
  PRINT_PASS,
  PRINT_REASSIGN,
  PRINT_REQUEST,
  PRINT_SUCCESS,
  type PrintFold,
  type PrintRow,
} from './printProtocol.js';

export interface BatonResult {
  outcome: 'printed' | 'advanced' | 'alert' | 'conflict' | 'waiting';
  // Arm/re-arm local timers: retryInMs = sender cooldown before another
  // attempt; alertInMs = time until my own PRINT_REQUEST strands (60 s (!)).
  retryInMs?: number;
  alertInMs?: number;
}

/** SQL every client uses to load the baton rows for one ticket. */
export const PRINT_ROWS_SQL = `SELECT action, payload, "time_stamp", admin_uuid
     FROM ticket_log
     WHERE ticket_uuid = ?
       AND action IN ('PRINT_SUCCESS', 'PRINT_PASS', 'PRINT_REQUEST', 'PRINT_REASSIGN')
     ORDER BY "time_stamp", uuid`;

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
  return (rows ?? []).map((r) => ({
    action: r.action,
    author: r.admin_uuid || null,
    time_stamp: Number(r.time_stamp),
    payload: parsePrintPayload(r.payload),
  }));
}

/** Fold = engine foldPrintBaton over the ticket's PRINT_* rows. */
export async function readPrintFold<
  Ticket extends { uuid: string; admin_uuid?: string | null },
>(
  getRows: (ticket_uuid: string) => Promise<PrintRow[]>,
  ticket: Ticket,
): Promise<{ fold: PrintFold; rows: PrintRow[] }> {
  const rows = await getRows(ticket.uuid);
  const fold = foldPrintBaton(rows, ticket.admin_uuid ?? null);
  return { fold, rows };
}

const MAX_ITERATIONS = 10;

// Per-ticket send-failure state (session memory): a refused send flips this
// device non-capable for a cooldown so the fold can announce/reassign instead
// of hot-retrying. Cleared on success.
const sendCooldownUntil = new Map<string, number>();
const sendFailures = new Map<string, number>();

export interface BatonDeps<Ticket, TLG, TAdmin> {
  /** Load the ticket's PRINT_* baton rows (client reads its real DB). */
  getPrintRows(ticket_uuid: string): Promise<PrintRow[]>;
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
  /** Config-level capability (silent mode + printer configured for this
   *  platform). Re-checked each iteration; cooldown handled by the loop. */
  isKitchenCapable(): boolean;
  /** Deliver the ticket bytes — the client's print transport. */
  printTicket(args: {
    ticket: Ticket;
    locationGroup: TLG;
    admin: TAdmin;
    translations: string[];
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
    payload,
    admin_uuid,
  });
}

export async function runBatonPrint<
  Ticket extends {
    uuid: string
    admin_uuid?: string | null
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
  const me = admin.uuid;
  const offset = await deps.getServerOffset();
  const logError = deps.logError ?? ((msg: string, err?: unknown) => console.error(msg, err));
  let advanced = false;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const rows = await deps.getPrintRows(ticket.uuid);
    const fold = foldPrintBaton(rows, ticket.admin_uuid ?? null);
    const myRequest = rows.find(
      (r) => r.action === PRINT_REQUEST && r.author === me,
    );
    const now = Date.now() + offset;
    const createdAt = Number(ticket.time_stamp) || undefined;
    // The cooldown is stored in local wall-clock (Date.now()); compare on that
    // same clock. Using the offset-adjusted `now` here shrinks every cooldown
    // by the server offset — with a skewed clock the device never enters
    // the non-capable window, hot-loops failed sends, and can never reassign.
    const cooldownRemaining = (sendCooldownUntil.get(ticket.uuid) ?? 0) - Date.now();
    const capable = deps.isKitchenCapable() && cooldownRemaining <= 0;
    const decision = decidePrint(fold, {
      me,
      capable,
      now,
      requestedAt: myRequest ? myRequest.time_stamp : null,
      createdAt,
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
          });
        } catch (err) {
          logError(`❌ Print failed ${ticket.uuid}`, err);
          printed = false;
        }

        if (printed) {
          sendCooldownUntil.delete(ticket.uuid);
          sendFailures.delete(ticket.uuid);
          await appendPrintLog(deps, ticket, me, PRINT_SUCCESS, {});
          return { outcome: 'printed' };
        }

        // Transport refused — announce so capable peers can take the baton
        // (doc scenario 3), then back off on a cooldown.
        if (!fold.passAuthors.includes(me)) {
          await appendPrintLog(deps, ticket, me, PRINT_PASS, {
            reason: 'print_failed',
          });
          advanced = true;
        }
        const failures = (sendFailures.get(ticket.uuid) ?? 0) + 1;
        sendFailures.set(ticket.uuid, failures);
        const backoffMs = Math.min(failures, 6) * 2000;
        sendCooldownUntil.set(ticket.uuid, Date.now() + backoffMs);
        continue;
      }

      case 'pass':
        await appendPrintLog(deps, ticket, me, PRINT_PASS, { reason: 'not_capable' });
        advanced = true;
        continue;

      case 'request':
        await appendPrintLog(deps, ticket, me, PRINT_REQUEST, {});
        advanced = true;
        continue;

      case 'reassign':
        await appendPrintLog(deps, ticket, me, PRINT_REASSIGN, { to: decision.to });
        advanced = true;
        continue;

      case 'alert':
        return { outcome: 'alert' };

      case 'attention':
        return { outcome: 'conflict' };

      case 'stand-down':
        if (fold.terminal) return { outcome: 'printed' };
        // Original device that already tried to print (reassign or local print
        // failure) but hasn't reached the 60 s strand window yet: arm a timer
        // to re-check so the alert surfaces promptly when it does.
        if (
          fold.chain.length > 0 &&
          fold.chain[0] === me &&
          !fold.terminal &&
          createdAt != null &&
          (fold.reassignAuthors.includes(me) || fold.printFailAuthors.includes(me))
        ) {
          const remaining = createdAt + PRINT_ALERT_MS - now;
          if (remaining > 0 && remaining <= PRINT_ALERT_MS) {
            return {
              outcome: advanced ? 'advanced' : 'waiting',
              alertInMs: remaining,
            };
          }
        }
        return { outcome: advanced ? 'advanced' : 'waiting' };

      case 'wait': {
        // Recently-failed holder: retry after the cooldown instead of
        // blocking this device's print queue.
        if (cooldownRemaining > 0 && fold.holder === me && !fold.terminal) {
          return {
            outcome: advanced ? 'advanced' : 'waiting',
            retryInMs: cooldownRemaining,
          };
        }
        // Waiter on my own request: arm the 60 s (!) alert timer.
        if (myRequest && !fold.terminal && fold.holder !== me) {
          return {
            outcome: advanced ? 'advanced' : 'waiting',
            alertInMs: Math.max(0, myRequest.time_stamp + PRINT_ALERT_MS - now),
          };
        }
        // Original device with a local print failure (no reassign): arm the
        // 60 s (!) alert timer so the alert surfaces when the strand window
        // elapses, even though decidePrint currently returns 'wait'.
        if (
          fold.chain.length > 0 &&
          fold.chain[0] === me &&
          !fold.terminal &&
          fold.printFailAuthors.includes(me) &&
          createdAt != null
        ) {
          const remaining = createdAt + PRINT_ALERT_MS - now;
          if (remaining > 0 && remaining <= PRINT_ALERT_MS) {
            return {
              outcome: advanced ? 'advanced' : 'waiting',
              alertInMs: remaining,
            };
          }
        }
        return { outcome: advanced ? 'advanced' : 'waiting' };
      }
    }
  }

  return { outcome: advanced ? 'advanced' : 'waiting' };
}

// The (!) press: re-validate the fold at press time, then take the ticket
// terminal for everyone. Returns false when truth already resolved it.
export async function manualTakeover<
  Ticket extends { uuid: string; admin_uuid?: string | null; location_group_uuid: string },
  TLG,
  TAdmin extends { uuid: string },
>(
  deps: BatonDeps<Ticket, TLG, TAdmin>,
  ticket: Ticket,
  admin: TAdmin,
): Promise<boolean> {
  const rows = await deps.getPrintRows(ticket.uuid);
  const fold = foldPrintBaton(rows, ticket.admin_uuid ?? null);
  if (!manualTakeoverAllowed(fold)) return false;
  await appendPrintLog(deps, ticket, admin.uuid, PRINT_SUCCESS, { manual: true });
  return true;
}
