import { describe, it, expect, vi } from 'vitest';
import {
  switchLocationGroup,
  type SwitchDeps,
  type VenueRef,
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
