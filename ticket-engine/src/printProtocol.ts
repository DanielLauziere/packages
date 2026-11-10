export const PRINT_SUCCESS = "PRINT_SUCCESS";
export const PRINT_PASS = "PRINT_PASS";
export const PRINT_REQUEST = "PRINT_REQUEST";
export const PRINT_REASSIGN = "PRINT_REASSIGN";

export const PRINT_ACTIONS = [
  PRINT_SUCCESS,
  PRINT_PASS,
  PRINT_REQUEST,
  PRINT_REASSIGN,
] as const;

export type PrintAction = (typeof PRINT_ACTIONS)[number];

const PRINT_ACTION_SET: ReadonlySet<string> = new Set(PRINT_ACTIONS);

export const PRINT_ALERT_MS = 60000;

// Silent-print failover (backlog item 9): a holder whose send is refused hands
// the baton off instead of retrying forever. A `stranded` pass is that handoff
// — it opens the floor so any capable device not already in the chain can
// request, and the holder reassigns to the first requester. The retry-then-
// reassign cooldown is gone for a refused send; the device is out permanently.
export const PRINT_REASON_STRANDED = "stranded";

// Silent-print spinner: the icon spins from the moment a printable ticket
// enters the feed until PRINT_SUCCESS lands, then flips to the failed state
// once the ticket is this old with no success (5 minutes).
export const PRINT_SPINNER_FAIL_MS = 300000;

export type PrintFoldState =
  "open" | "solicit" | "assigned" | "printed" | "conflict";

export interface PrintRow {
  action: string;
  author: string | null;
  time_stamp: number;
  payload?: any;
  /** Device that acted on this PRINT_* row (`payload.device_id`). The baton's
   *  identity is the device, not the admin — `author` (admin_uuid) stays the
   *  acting admin for logging. Absent on rows written before the device
   *  change; the fold falls back to `author` for those. */
  device_id?: string | null;
  /** Per-author monotonic ordinal (Phase 2). The authoring device stamps it
   *  on every PRINT_* row it writes — a counter persisted in its local
   *  metadata, never reused within a device. Ordering between two rows of the
   *  SAME author (a holder's pass vs that holder's reassign) is decided by
   *  `seq`, which needs only the author's own clock and is immune to
   *  cross-device skew. Absent on legacy rows; those fall back to
   *  `time_stamp` (within the author only). */
  seq?: number | null;
}

/** Read the acting device from a PRINT_* row's payload. */
function deviceIdOf(row: PrintRow): string | null {
  const id = row.device_id ?? row.payload?.device_id;
  return typeof id === 'string' && id ? id : null;
}

/**
 * Read the per-author ordinal from a PRINT_* row. Top-level `seq` (set by the
 * loaders from `payload.seq`) wins; `payload.seq` is the wire form. Returns
 * null for legacy rows (no seq anywhere) — the fold then falls back to
 * `time_stamp` for that comparison.
 */
function seqOf(row: PrintRow): number | null {
  const raw = row.seq ?? row.payload?.seq;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * Order two rows of the SAME author: `seq` when both carry one (skew-proof),
 * else `time_stamp` (legacy rows). Equal seqs tiebreak on the author's own
 * `time_stamp` — one clock per comparison is sound, and a counter rewind then
 * degrades to exactly the pre-seq behaviour for the colliding rows.
 *
 * This is the "at or before" form: `a` comes before `b` or is the same point
 * in the author's own order.
 */
function sameAuthorBefore(a: PrintRow, b: PrintRow): boolean {
  const as = seqOf(a);
  const bs = seqOf(b);
  if (as != null && bs != null) {
    if (as !== bs) return as < bs;
    return a.time_stamp <= b.time_stamp;
  }
  return a.time_stamp <= b.time_stamp;
}

/**
 * Strictly-before form, used only by the "latest pass" scan (the stranded
 * flag rides the holder's LAST pass). With equal seqs the author's own stamp
 * breaks the tie; a true tie keeps the earlier-scanned row (stable).
 */
function sameAuthorStrictlyBefore(a: PrintRow, b: PrintRow): boolean {
  const as = seqOf(a);
  const bs = seqOf(b);
  if (as != null && bs != null) {
    if (as !== bs) return as < bs;
    return a.time_stamp < b.time_stamp;
  }
  return a.time_stamp < b.time_stamp;
}

export interface PrintFold {
  state: PrintFoldState;
  holder: string | null;
  decider: boolean;
  terminal: boolean;
  conflict: string[];
  chain: (string | null)[];
  requests: (string | null)[];
  passAuthors: (string | null)[];
  reassignAuthors: (string | null)[];
  /** Devices whose PRINT_PASS carried reason='print_failed' (a real transport
   * attempt that was refused), distinct from 'not_capable' announces. Used
   * by the original-device stranded-print alert. */
  printFailAuthors: (string | null)[];
  /** True when the current holder's latest pass is a failover handoff
   * (`reason='stranded'`) and it has not reassigned yet. Any capable device
   * not already in the chain may request (backlog item 9). */
  stranded: boolean;
}

function pushByAuthor(
  map: Map<string | null, PrintRow[]>,
  author: string | null,
  row: PrintRow,
): void {
  const list = map.get(author);
  if (list) list.push(row);
  else map.set(author, [row]);
}

export function foldPrintBaton(
  rows: PrintRow[],
  creator: string | null,
): PrintFold {
  const conflicts: string[] = [];
  const reassignsBy = new Map<string | null, PrintRow[]>();
  const passesBy = new Map<string | null, PrintRow[]>();
  const requests: (string | null)[] = [];
  const passAuthors: (string | null)[] = [];
  const reassignAuthors: (string | null)[] = [];
  const printFailAuthors: (string | null)[] = [];
  const successes: PrintRow[] = [];

  for (const row of rows) {
    if (!PRINT_ACTION_SET.has(row.action)) continue;
    // Identity is the device: `payload.device_id` on rows written since the
    // device change, else the legacy admin author. `row.author` itself stays
    // the admin for logging.
    const author = deviceIdOf(row) ?? row.author ?? null;
    switch (row.action) {
      case PRINT_PASS:
        pushByAuthor(passesBy, author, row);
        if (!passAuthors.includes(author)) passAuthors.push(author);
        if (
          row.payload?.reason === "print_failed" &&
          !printFailAuthors.includes(author)
        ) {
          printFailAuthors.push(author);
        }
        // Failover (item 9): a `stranded` pass is also a real refused send, so
        // it counts for the creator strand alert. Without this the creator
        // would never arm the alert after its one failed send.
        if (
          row.payload?.reason === PRINT_REASON_STRANDED &&
          !printFailAuthors.includes(author)
        ) {
          printFailAuthors.push(author);
        }
        break;
      case PRINT_REASSIGN:
        pushByAuthor(reassignsBy, author, row);
        if (!reassignAuthors.includes(author)) reassignAuthors.push(author);
        break;
      case PRINT_REQUEST:
        if (!requests.includes(author)) requests.push(author);
        break;
      case PRINT_SUCCESS:
        successes.push(row);
        break;
    }
  }

  const chain: (string | null)[] = [creator];
  const visited = new Set<string | null>([creator]);
  let current = creator;
  let walking = true;
  while (walking) {
    walking = false;
    const owned = reassignsBy.get(current) ?? [];
    if (owned.length > 1) {
      conflicts.push("MULTIPLE_REASSIGN");
      break;
    }
    if (owned.length === 1) {
      const reassign = owned[0];
      const passes = passesBy.get(current) ?? [];
      // Open-pass test (C2): same author only, so the per-author `seq`
      // ordinal decides — a skewed foreign stamp can no longer shadow it.
      const hasOpenPass = passes.some((p) => sameAuthorBefore(p, reassign));
      if (!hasOpenPass) {
        conflicts.push("REASSIGN_WITHOUT_PASS");
        break;
      }
      const to = reassign.payload?.to;
      if (typeof to !== "string" || !to) {
        conflicts.push("REASSIGN_WITHOUT_TARGET");
        break;
      }
      if (visited.has(to)) {
        conflicts.push("REASSIGN_CYCLE");
        break;
      }
      visited.add(to);
      chain.push(to);
      current = to;
      walking = true;
    }
  }

  for (const [author, passes] of passesBy) {
    if (!visited.has(author)) {
      conflicts.push("PASS_FROM_NON_HOLDER");
      continue;
    }
    const owned = reassignsBy.get(author) ?? [];
    if (
      owned.length === 1 &&
      // PASS_AFTER_REASSIGN (C3): same author only — `seq` decides, strictly
      // after (a pass at the same point as the reassign is tolerated, as the
      // stamp comparison was).
      passes.some((p) => sameAuthorStrictlyBefore(owned[0], p))
    ) {
      conflicts.push("PASS_AFTER_REASSIGN");
    }
  }

  for (const [author] of reassignsBy) {
    if (!visited.has(author)) conflicts.push("REASSIGN_FROM_NON_HOLDER");
  }

  const manual = successes.filter((s) => s.payload?.manual === true);
  const auto = successes.filter((s) => s.payload?.manual !== true);
  for (const s of auto) {
    // Identity is the device (payload.device_id), same as every other actor
    // check — comparing the raw admin author here would flag every device
    // success written since the device-identity change (backlog item 4).
    if ((deviceIdOf(s) ?? s.author ?? null) !== current)
      conflicts.push("AUTO_SUCCESS_FROM_NON_HOLDER");
  }

  const holderPasses = passesBy.get(current) ?? [];
  const holderReassigns = reassignsBy.get(current) ?? [];
  const openPass = holderPasses.some(
    (p) =>
      holderReassigns.length === 0 ||
      // Same author only — `seq` decides (C2).
      sameAuthorBefore(p, holderReassigns[0]),
  );
  const decider = openPass && holderReassigns.length === 0;

  // Failover (item 9): the holder's latest pass is a `stranded` handoff and
  // it has not reassigned yet → the floor is open for any capable device not
  // already in the chain.
  let stranded = false;
  if (holderReassigns.length === 0 && holderPasses.length > 0) {
    let latest = holderPasses[0];
    for (const p of holderPasses.slice(1)) {
      if (sameAuthorStrictlyBefore(latest, p)) latest = p;
    }
    stranded = latest.payload?.reason === PRINT_REASON_STRANDED;
  }
  const terminal = successes.length > 0;

  let state: PrintFoldState;
  if (manual.length > 0) state = "printed";
  else if (conflicts.length > 0) state = "conflict";
  else if (terminal) state = "printed";
  else if (openPass) state = "solicit";
  else if (chain.length > 1) state = "assigned";
  else state = "open";

  return {
    state,
    holder: current,
    decider,
    terminal,
    conflict: conflicts,
    chain,
    requests,
    passAuthors,
    reassignAuthors,
    printFailAuthors,
    stranded,
  };
}

export interface PrintDeviceContext {
  me: string | null;
  capable: boolean;
  now: number;
  /** When THIS device first observed its own unanswered `PRINT_REQUEST`
   * (Phase 3: device-local observation time, never the row's foreign
   * `time_stamp`). Arms the 60 s requester-strand alert. */
  requestedObservedAt?: number | null;
  /** When THIS device first observed the creator-strand state (its own failed
   *  send / its own reassign) — device-local observation time. Arms the 60 s
   *  original-device strand alert. */
  observedAt?: number | null;
}

export type PrintDecision =
  | { kind: "send" }
  | { kind: "pass"; reason?: string }
  | { kind: "request" }
  | { kind: "reassign"; to: string }
  | { kind: "alert" }
  | { kind: "attention" }
  | { kind: "stand-down" }
  | { kind: "wait" };

export function decidePrint(
  fold: PrintFold,
  ctx: PrintDeviceContext,
): PrintDecision {
  const { me, capable, now } = ctx;

  if (fold.terminal) return { kind: "stand-down" };
  if (fold.state === "conflict") return { kind: "attention" };

  // Original-device stranded-print alert: this device is the creator (chain[0])
  // and already tried to print — either it passed the baton (PRINT_REASSIGN)
  // or it failed locally (PRINT_PASS with reason='print_failed') — but no
  // PRINT_SUCCESS has landed and the ticket is past the 60 s strand window.
  // Surface the alert so the original device can take manual action instead
  // of standing down silently. Only the creator (fold.chain[0]) arms this.
  if (
    fold.chain.length > 0 &&
    fold.chain[0] === me &&
    !fold.terminal &&
    ctx.observedAt != null &&
    now - ctx.observedAt >= PRINT_ALERT_MS &&
    (fold.reassignAuthors.includes(me) || fold.printFailAuthors.includes(me))
  ) {
    return { kind: "alert" };
  }

  if (fold.reassignAuthors.includes(me)) {
    return { kind: "stand-down" };
  }

  if (fold.holder === me) {
    // Failover (item 9): a stranded pass means this device already had its one
    // send and it was refused. Never send again — reassign or wait.
    if (fold.stranded) {
      if (fold.decider) {
        const to = fold.requests.find((r) => r !== null && r !== me);
        if (to) return { kind: "reassign", to };
      }
      return { kind: "wait" };
    }
    if (capable) return { kind: "send" };
    if (!fold.passAuthors.includes(me)) return { kind: "pass" };
    if (fold.decider) {
      const to = fold.requests.find((r) => r !== null && r !== me);
      if (to) return { kind: "reassign", to };
    }
    return { kind: "wait" };
  }

  // Failover (item 9): a stranded holder's floor is open — a capable device
  // not already in the chain may request, same as an open solicit.
  if (
    capable &&
    !fold.requests.includes(me) &&
    (fold.state === "solicit" || fold.stranded)
  ) {
    return { kind: "request" };
  }

  if (
    fold.requests.includes(me) &&
    !fold.terminal &&
    fold.holder !== me &&
    ctx.requestedObservedAt != null &&
    now - ctx.requestedObservedAt >= PRINT_ALERT_MS
  ) {
    return { kind: "alert" };
  }

  return { kind: "wait" };
}

/**
 * Silent-print spinner state (plan Item 1): an icon-only spinner rides every
 * printable ticket while its print is still pending. It spins from the moment
 * the ticket enters the feed until either PRINT_SUCCESS lands (no spinner) or
 * the ticket is older than PRINT_SPINNER_FAIL_MS with no success (the spinner
 * flips to the failed/warning state). No spinner when silent print is off —
 * nothing is expected to print. `printed == null` means the surface does not
 * carry print state (a non-feed view) — stay quiet there too.
 */
export type PrintSpinnerState = "trying" | "failed";

export function printSpinnerState(opts: {
  /** Whether a PRINT_SUCCESS row already exists (SQL EXISTS → 0/1). */
  printed?: boolean | number | null;
  /** location_group.silent_print — the restaurant-level print switch. */
  silentPrint?: boolean | null;
  /** ms since the ticket's age anchor (completion time, else creation).
   *  Legacy/foreign-stamp basis — prefer `pendingMs` (Phase 3). */
  ageMs?: number | null;
  /** ms since THIS device first observed the ticket as print-pending
   *  (Phase 3: device-local observation time, never a foreign row stamp).
   *  When provided it decides the fail threshold; `ageMs` is ignored. */
  pendingMs?: number | null;
}): PrintSpinnerState | null {
  const { printed, silentPrint, ageMs, pendingMs } = opts;
  if (!silentPrint) return null;
  if (printed === true || printed === 1) return null;
  if (printed === null || printed === undefined) return null;
  // Phase 3: the local observation basis wins when present.
  if (pendingMs != null) {
    return pendingMs >= PRINT_SPINNER_FAIL_MS ? "failed" : "trying";
  }
  if (ageMs === null || ageMs === undefined || ageMs <= 0) return "trying";
  return ageMs >= PRINT_SPINNER_FAIL_MS ? "failed" : "trying";
}

export function manualTakeoverAllowed(fold: PrintFold): boolean {
  return !fold.terminal;
}
