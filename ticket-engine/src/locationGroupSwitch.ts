/**
 * Multi-location-group (multi-venue) switch orchestration, shared by the web
 * client and the RN app (byte-parity: identical input → identical state).
 *
 * The web feature added `/gerentes` + `/tablero-multi` (venue picker + floating
 * switcher); this module owns the decision logic BOTH clients run so the guard
 * order and flush-or-block rule can never drift:
 *
 *   no_session → same_venue → blocked_offline → flush → wipe → writeMeta → reload
 *
 * Everything platform-specific (DB wipe, session-meta persistence, the reload /
 * boot restart, HTTP upload, connectivity) is injected, so this file stays
 * side-effect free and testable without a device, browser, or server.
 *
 * Rules encoded here (see omni/docs/CORE-LOGIC-*):
 *  - Switching is ONLINE-ONLY: no server round-trip is possible offline, so a
 *    switch would drop unsynced local ticket logs.
 *  - Flush-or-block: ALL local ticket logs for the CURRENT venue are pushed to
 *    the server first; any failure blocks the switch and leaves the DB untouched.
 *  - After a successful flush the local DB is wiped and the new venue's
 *    session-meta is written; the caller then reloads/reboots so the new venue
 *    reseeds from scratch (a wiped venue's data can never leak into another).
 */


/** Minimal venue reference a switch needs. Both clients' `LocationGroup`
 *  satisfies it (only `uuid` + `url_name` are used). */
export interface VenueRef {
  uuid: string;
  url_name?: string | null;
}

/** Outcome of a switch attempt. `'switched'` means the caller must now
 *  reload/reboot — nothing after that point runs in the old session. */
export type SwitchResult =
  | 'switched'
  | 'same_venue'
  | 'no_session'
  | 'blocked_offline'
  | 'blocked_flush';

/** Everything platform-specific a switch needs. All fields required — the
 *  engine never guesses a default; each client binds its own (see web
 *  `lgSwitch.ts` and RN `src/core/venue/lgSwitch.ts`). */
export interface SwitchDeps {
  /** Current bound admin uuid, or null when signed out. */
  getAdminUuid: () => Promise<string | null | undefined>;
  /** Currently bound venue uuid, or null (fresh picker / pre-login). */
  getCurrentLocationGroupUuid: () => Promise<string | null | undefined>;
  /** Connectivity probe. Offline short-circuits before any local mutation. */
  isOnline: () => boolean;
  /** Push every local ticket log for `locationGroupUuid` to the server.
   *  Resolves true only when the flush fully succeeded. */
  flush: (locationGroupUuid: string) => Promise<boolean>;
  /** Wipe the local DB (and re-apply the baseline DDL so the meta writes
   *  below have a `key_value` home). */
  wipe: () => Promise<void>;
  /** Persist the new venue's session meta (must be durable before reload). */
  writeSessionMeta: (target: {
    adminUuid: string;
    locationGroupUuid: string;
    restGroup: string;
  }) => Promise<void>;
  /** Reload/reboot onto the new venue (web: hard navigation; RN: restartBoot). */
  onSwitched: () => void;
}

/**
 * Venue switch — the ONLY supported way to change the active location_group
 * while keeping the same admin session. See the module doc for the invariants.
 *
 * `deps` is fully injectable so both clients supply their own wipe / meta /
 * reload while sharing this exact decision order.
 */
export async function switchLocationGroup(
  target: VenueRef,
  deps: SwitchDeps,
): Promise<SwitchResult> {
  const currentLg = await deps.getCurrentLocationGroupUuid();
  const adminUuid = await deps.getAdminUuid();
  if (!adminUuid) return 'no_session';
  if (currentLg === target.uuid) return 'same_venue';

  if (!deps.isOnline()) return 'blocked_offline';

  if (currentLg) {
    const flushed = await deps.flush(currentLg);
    if (!flushed) return 'blocked_flush';
  }

  await deps.wipe();
  await deps.writeSessionMeta({
    adminUuid,
    locationGroupUuid: target.uuid,
    restGroup: target.url_name ?? '',
  });
  deps.onSwitched();
  return 'switched';
}
