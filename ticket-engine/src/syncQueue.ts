/**
 * Pure sync-queue helpers shared by the web client and the RN app
 * (CORE-LOGIC-TICKET-LOGS.md — deterministic ordering, 36h cutoff).
 *
 * Everything here is side-effect free: DB access and the server-clock offset
 * are injected by the callers, so the exact code both clients run is pinned
 * by tests in this package and exercised end-to-end by the frontend suite.
 */

import { ACTION_PRIORITY } from './applyTicketLog.js';
import { CUTOFF_MS } from './consts.js';

/** Minimal log shape the queue helpers need. Both clients' `TicketLog`
 *  (and the engine's `TicketLogEntry`) satisfy it. */
export interface SyncLogLike {
  uuid: string;
  ticket_uuid: string;
  action: string;
  time_stamp?: number | string | null;
  payload?: unknown;
}

export type TicketsMapLike<T extends SyncLogLike> = Record<string, T[]>;

/** Counters the sync round reports to its UI. Superset of both clients'
 *  historical shapes — clients may ignore fields they don't display. */
export interface SyncSummary {
  ticketsTotal: number;
  ticketsActive: number;
  ticketsExpired: number;
  incomingTickets: number;
  bucketsOut: number;
  pruned: number;
  ticketsOutOfSync: number;
}

/** Priority tier of a log; unknown actions sort last (999). */
export const getPriority = (log: { action: string }): number =>
  ACTION_PRIORITY[log.action] ?? 999;

/** Deterministic apply order: priority tier, then time_stamp, then uuid.
 *  Does not mutate the input. */
export const sortTicketLogs = <T extends SyncLogLike>(logs: T[]): T[] => {
  return [...logs].sort((a, b) => {
    const pa = getPriority(a);
    const pb = getPriority(b);
    if (pa !== pb) return pa - pb;
    if ((a.time_stamp ?? 0) < (b.time_stamp ?? 0)) return -1;
    if ((a.time_stamp ?? 0) > (b.time_stamp ?? 0)) return 1;
    if (a.uuid < b.uuid) return -1;
    if (a.uuid > b.uuid) return 1;
    return 0;
  });
};

/** JSON-string payloads (rows straight out of SQLite) become objects;
 *  unparseable JSON becomes null. Object payloads pass through. */
export const normalizeLogs = <T extends { payload?: unknown }>(logs: T[]): T[] => {
  return logs.map((log) => {
    if (typeof log.payload === 'string') {
      try {
        return { ...log, payload: JSON.parse(log.payload) };
      } catch {
        return { ...log, payload: null as unknown };
      }
    }
    return log;
  });
};

/** Group a flat log list by ticket_uuid (apply order is per ticket). */
export const groupLogsByTicket = <T extends SyncLogLike>(logs: T[]): Record<string, T[]> => {
  const map: Record<string, T[]> = {};
  for (const log of logs) {
    if (!map[log.ticket_uuid]) map[log.ticket_uuid] = [];
    map[log.ticket_uuid]!.push(log);
  }
  return map;
};

/** True when any log of the ticket set its status to PAID. */
export const isPaidTicket = <T extends { action: string }>(logs: T[]): boolean =>
  logs.some((log) => log.action === 'SET_STATUS_PAID');

/**
 * Drop tickets whose newest log is older than the 36h cutoff. `now` is the
 * caller's offset-adjusted server time (injected — keeps this pure). Updates
 * `summary` in place: total/active on every ticket, expired+pruned on drop.
 */
export const filterTicketsByActivity = <T extends SyncLogLike>(
  tickets: TicketsMapLike<T>,
  summary: SyncSummary,
  now: number,
): TicketsMapLike<T> => {
  const result: TicketsMapLike<T> = {};

  for (const ticket_uuid in tickets) {
    const logs = tickets[ticket_uuid];
    if (!logs?.length) continue;

    summary.ticketsTotal++;

    const maxTs = Math.max(...logs.map((l) => Number(l.time_stamp)));
    const age = now - maxTs;

    if (age > CUTOFF_MS) {
      summary.pruned++;
      summary.ticketsExpired++;
      continue;
    }

    summary.ticketsActive++;
    result[ticket_uuid] = logs;
  }

  return result;
};
