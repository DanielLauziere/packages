import { describe, it, expect, vi } from 'vitest';
import {
  switchLocationGroup,
  flushVenueLogs,
  type SwitchDeps,
  type VenueRef,
  type VenueFlushDeps,
} from './locationGroupSwitch.js';

const target: VenueRef = { uuid: 'lg-b', url_name: 'venue-b' };

const baseDeps = (): SwitchDeps => ({
  getAdminUuid: vi.fn(async () => 'admin-1'),
  getCurrentLocationGroupUuid: vi.fn(async () => 'lg-a'),
  isOnline: vi.fn(() => true),
  flush: vi.fn(async () => true),
  wipe: vi.fn(async () => {}),
  writeSessionMeta: vi.fn(async () => {}),
  onSwitched: vi.fn(),
});

describe('switchLocationGroup', () => {
  it('blocks when no admin session exists', async () => {
    const deps = baseDeps();
    vi.mocked(deps.getAdminUuid).mockResolvedValue(null);
    vi.mocked(deps.getCurrentLocationGroupUuid).mockResolvedValue(null);

    const result = await switchLocationGroup(target, deps);

    expect(result).toBe('no_session');
    expect(deps.flush).not.toHaveBeenCalled();
    expect(deps.wipe).not.toHaveBeenCalled();
    expect(deps.onSwitched).not.toHaveBeenCalled();
  });

  it('is a no-op when the target is the current venue', async () => {
    const deps = baseDeps();
    vi.mocked(deps.getCurrentLocationGroupUuid).mockResolvedValue('lg-b');

    const result = await switchLocationGroup(target, deps);

    expect(result).toBe('same_venue');
    expect(deps.flush).not.toHaveBeenCalled();
    expect(deps.wipe).not.toHaveBeenCalled();
  });

  it('blocks offline switches before touching the local DB', async () => {
    const deps = { ...baseDeps(), isOnline: vi.fn(() => false) };

    const result = await switchLocationGroup(target, deps);

    expect(result).toBe('blocked_offline');
    expect(deps.flush).not.toHaveBeenCalled();
    expect(deps.wipe).not.toHaveBeenCalled();
    expect(deps.writeSessionMeta).not.toHaveBeenCalled();
    expect(deps.onSwitched).not.toHaveBeenCalled();
  });

  it('blocks the switch when the flush fails, leaving the DB untouched', async () => {
    const deps = { ...baseDeps(), flush: vi.fn(async () => false) };

    const result = await switchLocationGroup(target, deps);

    expect(result).toBe('blocked_flush');
    expect(deps.flush).toHaveBeenCalledWith('lg-a');
    expect(deps.wipe).not.toHaveBeenCalled();
    expect(deps.writeSessionMeta).not.toHaveBeenCalled();
    expect(deps.onSwitched).not.toHaveBeenCalled();
  });

  it('flushes the CURRENT venue, wipes, writes meta, then switches (in order)', async () => {
    const deps = baseDeps();
    const order: string[] = [];
    vi.mocked(deps.flush).mockImplementation(async () => {
      order.push('flush');
      return true;
    });
    vi.mocked(deps.wipe).mockImplementation(async () => {
      order.push('wipe');
    });
    vi.mocked(deps.writeSessionMeta).mockImplementation(async () => {
      order.push('writeSessionMeta');
    });
    vi.mocked(deps.onSwitched).mockImplementation(() => {
      order.push('onSwitched');
    });

    const result = await switchLocationGroup(target, deps);

    expect(result).toBe('switched');
    expect(deps.flush).toHaveBeenCalledWith('lg-a');
    expect(deps.wipe).toHaveBeenCalledTimes(1);
    expect(deps.writeSessionMeta).toHaveBeenCalledWith({
      adminUuid: 'admin-1',
      locationGroupUuid: 'lg-b',
      restGroup: 'venue-b',
    });
    expect(order).toEqual(['flush', 'wipe', 'writeSessionMeta', 'onSwitched']);
  });

  it('skips the flush when there is no current venue (fresh picker) but still wipes', async () => {
    const deps = baseDeps();
    vi.mocked(deps.getCurrentLocationGroupUuid).mockResolvedValue(null);

    const result = await switchLocationGroup(target, deps);

    expect(result).toBe('switched');
    expect(deps.flush).not.toHaveBeenCalled();
    expect(deps.wipe).toHaveBeenCalledTimes(1);
    expect(deps.writeSessionMeta).toHaveBeenCalledWith({
      adminUuid: 'admin-1',
      locationGroupUuid: 'lg-b',
      restGroup: 'venue-b',
    });
    expect(deps.onSwitched).toHaveBeenCalledTimes(1);
  });
});

describe('flushVenueLogs', () => {
  type Log = {
    uuid: string;
    ticket_uuid: string;
    action: string;
    time_stamp: number;
  };
  const lg = 'lg-a';
  const log = (ticket_uuid: string, uuid: string): Log => ({
    ticket_uuid,
    uuid,
    time_stamp: Date.now(),
    action: 'CREATE_TICKET',
  });

  const flushWith = (
    getLocalTicketsMap: VenueFlushDeps<Log>['getLocalTicketsMap'],
    syncTicketLogs: VenueFlushDeps<Log>['syncTicketLogs'],
  ) =>
    flushVenueLogs<Log>(lg, {
      getLocalTicketsMap,
      syncTicketLogs,
      logError: () => {},
    });

  it('treats a wiped/empty local DB as a successful flush', async () => {
    const syncTicketLogs = vi.fn();
    const result = await flushWith(async () => {
      throw new Error('no such table');
    }, syncTicketLogs);

    expect(result).toBe(true);
    expect(syncTicketLogs).not.toHaveBeenCalled();
  });

  it('succeeds without an HTTP call when there are no active tickets', async () => {
    const syncTicketLogs = vi.fn();
    const result = await flushWith(async () => ({}), syncTicketLogs);

    expect(result).toBe(true);
    expect(syncTicketLogs).not.toHaveBeenCalled();
  });

  it('pushes full buckets with an empty baseline hash and succeeds on ok', async () => {
    const syncTicketLogs = vi.fn(async () => ({
      ok: true,
      data: { buckets: {}, bucket_hashes: {}, server_timestamp: Date.now() },
    }));

    const result = await flushWith(
      async () => ({ t1: [log('t1', 'l1'), log('t1', 'l2')] }),
      syncTicketLogs,
    );

    expect(result).toBe(true);
    expect(syncTicketLogs).toHaveBeenCalledTimes(1);
    const [passedLg, body] = syncTicketLogs.mock.calls[0]!;
    expect(passedLg).toBe(lg);
    expect(body.bucket_hashes).toEqual({});
    expect(Object.keys(body.buckets)).toHaveLength(1);
    const singleBucket = Object.values(body.buckets)[0]!;
    expect(Object.keys(singleBucket)).toContain('t1');
  });

  it('fails when the server rejects the upload', async () => {
    const result = await flushWith(
      async () => ({ t1: [log('t1', 'l1')] }),
      vi.fn(async () => ({ ok: false, message: 'boom' })),
    );

    expect(result).toBe(false);
  });

  it('fails when the upload throws', async () => {
    const result = await flushWith(
      async () => ({ t1: [log('t1', 'l1')] }),
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    expect(result).toBe(false);
  });

  it('drops expired tickets (36h cutoff) and does not upload them', async () => {
    const syncTicketLogs = vi.fn(async () => ({ ok: true }));
    const stale: Log = {
      uuid: 'old',
      ticket_uuid: 't-old',
      action: 'CREATE_TICKET',
      time_stamp: Date.now() - 40 * 60 * 60 * 1000,
    };

    const result = await flushWith(async () => ({ 't-old': [stale] }), syncTicketLogs);

    expect(result).toBe(true);
    expect(syncTicketLogs).not.toHaveBeenCalled();
  });
});
