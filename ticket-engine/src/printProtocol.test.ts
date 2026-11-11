import { describe, it, expect } from "vitest";
import {
  PRINT_ALERT_MS,
  PRINT_FAILED,
  PRINT_SPINNER_FAIL_MS,
  foldPrintBaton,
  decidePrint,
  manualTakeoverAllowed,
  printSpinnerState,
  PrintRow,
} from "./printProtocol.js";

const A = "admin-a";
const B = "admin-b";
const C = "admin-c";
const D = "admin-d";

let seq = 0;
function row(
  action: string,
  author: string | null,
  time_stamp: number,
  payload?: any,
): PrintRow {
  seq++;
  return { action, author, time_stamp, payload: payload ?? {} };
}

function permute<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permute(rest)) out.push([items[i], ...p]);
  }
  return out;
}

describe("foldPrintBaton — states", () => {
  it("empty rows: open, creator is implicit holder, not terminal", () => {
    const fold = foldPrintBaton([], A);
    expect(fold.state).toBe("open");
    expect(fold.holder).toBe(A);
    expect(fold.terminal).toBe(false);
    expect(fold.decider).toBe(false);
    expect(fold.conflict).toEqual([]);
    expect(fold.chain).toEqual([A]);
  });

  it("scenario 1: creator prints → printed, zero other rows needed", () => {
    const rows = [row("PRINT_SUCCESS", A, 1000, {})];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("printed");
    expect(fold.terminal).toBe(true);
    expect(fold.conflict).toEqual([]);
  });

  it("holder pass → solicit, holder is decider", () => {
    const rows = [row("PRINT_PASS", A, 1000)];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("solicit");
    expect(fold.holder).toBe(A);
    expect(fold.decider).toBe(true);
  });

  it("reassign moves the chain; new holder without pass → assigned", () => {
    const rows = [
      row("PRINT_PASS", A, 1000),
      row("PRINT_REQUEST", B, 1100),
      row("PRINT_REQUEST", C, 1200),
      row("PRINT_REASSIGN", A, 1300, { to: C }),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("assigned");
    expect(fold.holder).toBe(C);
    expect(fold.chain).toEqual([A, C]);
    expect(fold.decider).toBe(false);
    expect(fold.requests).toEqual([B, C]);
    expect(fold.conflict).toEqual([]);
  });

  it("chain hop: A→C→B folds through both reassigns", () => {
    const rows = [
      row("PRINT_PASS", A, 1000),
      row("PRINT_REQUEST", B, 1050),
      row("PRINT_REASSIGN", A, 1100, { to: C }),
      row("PRINT_PASS", C, 1200),
      row("PRINT_REASSIGN", C, 1300, { to: B }),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.holder).toBe(B);
    expect(fold.chain).toEqual([A, C, B]);
    expect(fold.state).toBe("assigned");
    expect(fold.conflict).toEqual([]);
  });

  it("reassigned target that passes → solicit again", () => {
    const rows = [
      row("PRINT_PASS", A, 1000),
      row("PRINT_REQUEST", B, 1100),
      row("PRINT_REASSIGN", A, 1200, { to: B }),
      row("PRINT_PASS", B, 1300),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("solicit");
    expect(fold.holder).toBe(B);
    expect(fold.decider).toBe(true);
  });

  it("server-as-A: null creator + null author behaves like any holder", () => {
    const rows = [row("PRINT_PASS", null, 1000)];
    const fold = foldPrintBaton(rows, null);
    expect(fold.state).toBe("solicit");
    expect(fold.holder).toBe(null);
    expect(fold.decider).toBe(true);

    const moved = foldPrintBaton(
      [
        ...rows,
        row("PRINT_REQUEST", B, 1100),
        row("PRINT_REASSIGN", null, 1200, { to: B }),
      ],
      null,
    );
    expect(moved.holder).toBe(B);
    expect(moved.chain).toEqual([null, B]);
    expect(moved.conflict).toEqual([]);
  });

  it("duplicate requests by one device are deduped", () => {
    const rows = [
      row("PRINT_PASS", A, 1000),
      row("PRINT_REQUEST", B, 1100),
      row("PRINT_REQUEST", B, 1150),
    ];
    expect(foldPrintBaton(rows, A).requests).toEqual([B]);
  });

  it("duplicate passes from one author dedupe passAuthors", () => {
    const rows = [row("PRINT_PASS", A, 1000), row("PRINT_PASS", A, 1100)];
    const fold = foldPrintBaton(rows, A);
    expect(fold.passAuthors).toEqual([A]);
    expect(fold.passAuthors).toHaveLength(1);
    // The holder's own repeated passes are legal — no conflict.
    expect(fold.conflict).toEqual([]);
  });

  it("duplicate reassigns from one author dedupe reassignAuthors", () => {
    const rows = [
      row("PRINT_PASS", A, 1000),
      row("PRINT_REASSIGN", A, 1100, { to: B }),
      row("PRINT_REASSIGN", A, 1200, { to: C }),
    ];
    const fold = foldPrintBaton(rows, A);
    // Two reassigns still flag MULTIPLE_REASSIGN, but the author list itself
    // holds one seat.
    expect(fold.reassignAuthors).toEqual([A]);
    expect(fold.reassignAuthors).toHaveLength(1);
    expect(fold.conflict).toContain("MULTIPLE_REASSIGN");
  });

  it("non-print actions are ignored", () => {
    const rows = [row("ADD_ITEM", B, 900), row("PRINT_SUCCESS", A, 1000)];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("printed");
    expect(fold.conflict).toEqual([]);
  });

  it("tracks printFailAuthors only for PRINT_PASS with reason=print_failed", () => {
    const rows = [
      row("PRINT_PASS", A, 1000, { reason: "print_failed" }),
      row("PRINT_PASS", B, 1100, { reason: "not_capable" }),
      row("PRINT_PASS", C, 1200, { reason: "print_failed" }),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.printFailAuthors).toEqual([A, C]);
    expect(fold.passAuthors).toEqual([A, B, C]);
  });

  it("printFailAuthors is empty when no PRINT_PASS has reason=print_failed", () => {
    const rows = [row("PRINT_PASS", A, 1000, { reason: "not_capable" })];
    const fold = foldPrintBaton(rows, A);
    expect(fold.printFailAuthors).toEqual([]);
    expect(fold.passAuthors).toEqual([A]);
  });
});

describe("foldPrintBaton — validation rules", () => {
  it("rule 1: PASS from a non-holder → conflict", () => {
    const rows = [row("PRINT_PASS", D, 1000)];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("conflict");
    expect(fold.conflict).toContain("PASS_FROM_NON_HOLDER");
  });

  it("rule 1: PASS after the author reassigned away → conflict", () => {
    const rows = [
      row("PRINT_PASS", A, 1000),
      row("PRINT_REASSIGN", A, 1100, { to: B }),
      row("PRINT_PASS", A, 1200),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("conflict");
    expect(fold.conflict).toContain("PASS_AFTER_REASSIGN");
  });

  it("rule 2: two reassigns from one seat → conflict", () => {
    const rows = [
      row("PRINT_PASS", A, 1000),
      row("PRINT_REASSIGN", A, 1100, { to: B }),
      row("PRINT_REASSIGN", A, 1200, { to: C }),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("conflict");
    expect(fold.conflict).toContain("MULTIPLE_REASSIGN");
  });

  it("rule 2: reassign without an announce → conflict", () => {
    const rows = [row("PRINT_REASSIGN", A, 1100, { to: B })];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("conflict");
    expect(fold.conflict).toContain("REASSIGN_WITHOUT_PASS");
  });

  it("rule 2: reassign from a non-holder → conflict", () => {
    const rows = [
      row("PRINT_PASS", D, 1000),
      row("PRINT_REASSIGN", D, 1100, { to: B }),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("conflict");
    expect(fold.conflict).toContain("PASS_FROM_NON_HOLDER");
    expect(fold.conflict).toContain("REASSIGN_FROM_NON_HOLDER");
  });

  it("rule 2: reassign without target payload → conflict", () => {
    const rows = [
      row("PRINT_PASS", A, 1000),
      row("PRINT_REASSIGN", A, 1100, {}),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("conflict");
    expect(fold.conflict).toContain("REASSIGN_WITHOUT_TARGET");
  });

  it("rule 2: reassign cycle → conflict", () => {
    const rows = [
      row("PRINT_PASS", A, 1000),
      row("PRINT_REASSIGN", A, 1100, { to: B }),
      row("PRINT_PASS", B, 1200),
      row("PRINT_REASSIGN", B, 1300, { to: A }),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("conflict");
    expect(fold.conflict).toContain("REASSIGN_CYCLE");
  });

  it("rule 3: auto SUCCESS from a non-holder → conflict", () => {
    const rows = [
      row("PRINT_PASS", A, 1000),
      row("PRINT_REASSIGN", A, 1100, { to: B }),
      row("PRINT_SUCCESS", A, 1200, {}),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("conflict");
    expect(fold.conflict).toContain("AUTO_SUCCESS_FROM_NON_HOLDER");
  });

  it("rule 3: manual SUCCESS from anyone is valid → printed", () => {
    const rows = [row("PRINT_SUCCESS", D, 1000, { manual: true })];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("printed");
    expect(fold.conflict).toEqual([]);
  });

  it("rule 3: two auto SUCCESSes from the same non-holder each flag the conflict", () => {
    const rows = [
      row("PRINT_SUCCESS", B, 1000, {}),
      row("PRINT_SUCCESS", B, 1100, {}),
    ];
    const fold = foldPrintBaton(rows, A);
    // One entry per offending row — the conflict list is not deduped.
    expect(fold.conflict).toEqual([
      "AUTO_SUCCESS_FROM_NON_HOLDER",
      "AUTO_SUCCESS_FROM_NON_HOLDER",
    ]);
    expect(fold.state).toBe("conflict");
    expect(fold.terminal).toBe(true);
  });

  it("rule 3: only manual === true is manual — false, 1 and {} are auto successes", () => {
    for (const manual of [false, 1, {}]) {
      // From a non-holder an auto success conflicts…
      const fromNonHolder = foldPrintBaton(
        [row("PRINT_SUCCESS", B, 1000, { manual })],
        A,
      );
      expect(fromNonHolder.conflict).toEqual(["AUTO_SUCCESS_FROM_NON_HOLDER"]);
      expect(fromNonHolder.state).toBe("conflict");

      // …from the holder it is a plain auto print.
      const fromHolder = foldPrintBaton(
        [row("PRINT_SUCCESS", A, 1000, { manual })],
        A,
      );
      expect(fromHolder.conflict).toEqual([]);
      expect(fromHolder.state).toBe("printed");
    }
  });

  it("manual SUCCESS resolves an otherwise conflicted fold", () => {
    const rows = [
      row("PRINT_PASS", D, 1000),
      row("PRINT_SUCCESS", D, 1400, { manual: true }),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("printed");
  });

  it("pass and reassign at the same ms from the same author is not a conflict", () => {
    const rows = [
      row("PRINT_PASS", A, 1000),
      row("PRINT_REASSIGN", A, 1000, { to: B }),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("assigned");
    expect(fold.holder).toBe(B);
    expect(fold.conflict).toEqual([]);
  });

  it("adversarial clock skew across authors never changes the chain", () => {
    const base = [
      row("PRINT_PASS", A, 5000),
      row("PRINT_REQUEST", B, 100),
      row("PRINT_REASSIGN", A, 6000, { to: C }),
      row("PRINT_SUCCESS", C, 10, {}),
    ];
    const skews = permute([0, -99999, 99999, 12345]);
    for (const [sa, sb, sc] of skews) {
      const rows = base.map((r) => ({
        ...r,
        time_stamp:
          r.time_stamp + (r.author === A ? sa : r.author === B ? sb : sc),
      }));
      const fold = foldPrintBaton(rows, A);
      expect(fold.holder).toBe(C);
      expect(fold.terminal).toBe(true);
      expect(fold.state).toBe("printed");
      expect(fold.conflict).toEqual([]);
    }
  });
});

describe("foldPrintBaton — device id precedence (deviceIdOf)", () => {
  it("top-level row.device_id beats payload.device_id", () => {
    // If the fold read payload.device_id it would see dev-2 ≠ creator dev-1
    // and flag AUTO_SUCCESS_FROM_NON_HOLDER on a perfectly valid print.
    const rows: PrintRow[] = [
      {
        action: "PRINT_SUCCESS",
        author: "admin-1",
        time_stamp: 1000,
        device_id: "dev-1",
        payload: { device_id: "dev-2" },
      },
    ];
    const fold = foldPrintBaton(rows, "dev-1");
    expect(fold.conflict).toEqual([]);
    expect(fold.state).toBe("printed");
  });

  it("a non-string or empty device id falls back to the author", () => {
    const rows: PrintRow[] = [
      //42 / '' are not usable device ids — the legacy admin author decides.
      { action: "PRINT_SUCCESS", author: A, time_stamp: 1, device_id: 42 as any, payload: {} },
      { action: "PRINT_SUCCESS", author: A, time_stamp: 2, device_id: "", payload: {} },
      { action: "PRINT_SUCCESS", author: A, time_stamp: 3, device_id: null, payload: { device_id: 42 } },
      { action: "PRINT_SUCCESS", author: A, time_stamp: 4, device_id: null, payload: { device_id: "" } },
    ];
    for (const r of rows) {
      // Author A is the creator → the fallback author makes it a valid print.
      const asHolder = foldPrintBaton([r], A);
      expect(asHolder.conflict).toEqual([]);
      expect(asHolder.state).toBe("printed");

      // …and under another creator the same fallback still conflicts.
      const asNonHolder = foldPrintBaton([r], B);
      expect(asNonHolder.conflict).toEqual(["AUTO_SUCCESS_FROM_NON_HOLDER"]);
    }
  });
});

describe("foldPrintBaton — I4 permutation invariance", () => {
  it("every permutation of the scenario-2 row set folds identically", () => {
    const rows = [
      row("PRINT_PASS", A, 1000),
      row("PRINT_REQUEST", B, 1100),
      row("PRINT_REQUEST", C, 1200),
      row("PRINT_REASSIGN", A, 1300, { to: C }),
      row("PRINT_SUCCESS", C, 1400, {}),
    ];
    const results = permute(rows).map((p) => {
      const f = foldPrintBaton(p, A);
      return {
        state: f.state,
        holder: f.holder,
        decider: f.decider,
        terminal: f.terminal,
        conflict: f.conflict,
        chain: f.chain,
      };
    });
    const first = JSON.stringify(results[0]);
    for (const r of results) expect(JSON.stringify(r)).toBe(first);
    expect(results[0].state).toBe("printed");
    expect(results[0].holder).toBe(C);
    expect(results[0].chain).toEqual([A, C]);
  });

  it("batching (partial row sets) converges to the same final fold", () => {
    const rows = [
      row("PRINT_PASS", A, 1000),
      row("PRINT_REQUEST", B, 1100),
      row("PRINT_REASSIGN", A, 1200, { to: B }),
      row("PRINT_PASS", B, 1300),
      row("PRINT_SUCCESS", B, 1400, {}),
    ];
    const full = foldPrintBaton(rows, A);
    const prefixes = rows.map((_, i) =>
      foldPrintBaton(rows.slice(0, i + 1), A),
    );
    expect(prefixes[prefixes.length - 1]).toEqual(full);
    expect(full.state).toBe("printed");
    expect(full.holder).toBe(B);
  });
});

describe("decidePrint — guards", () => {
  const base = { now: 1000000 };

  it("terminal → stand-down for everyone, holder included", () => {
    const fold = foldPrintBaton([row("PRINT_SUCCESS", A, 10, {})], A);
    expect(decidePrint(fold, { ...base, me: A, capable: true }).kind).toBe(
      "stand-down",
    );
    expect(decidePrint(fold, { ...base, me: B, capable: true }).kind).toBe(
      "stand-down",
    );
  });

  it("conflict → attention for everyone, holder included", () => {
    const fold = foldPrintBaton([row("PRINT_PASS", D, 10)], A);
    expect(fold.state).toBe("conflict");
    expect(decidePrint(fold, { ...base, me: A, capable: true }).kind).toBe(
      "attention",
    );
    expect(decidePrint(fold, { ...base, me: D, capable: true }).kind).toBe(
      "attention",
    );
  });

  it("only the holder sends", () => {
    const fold = foldPrintBaton([row("PRINT_PASS", A, 10)], A);
    expect(decidePrint(fold, { ...base, me: A, capable: true }).kind).toBe(
      "send",
    );
    expect(decidePrint(fold, { ...base, me: B, capable: true }).kind).toBe(
      "request",
    );
    expect(decidePrint(fold, { ...base, me: C, capable: false }).kind).toBe(
      "wait",
    );
  });

  it("holder announces once when not capable", () => {
    const fold = foldPrintBaton([], A);
    expect(decidePrint(fold, { ...base, me: A, capable: false })).toEqual({
      kind: "pass",
    });
  });

  it("holder that announced and sees requests reassigns to the first one seen", () => {
    const fold = foldPrintBaton(
      [
        row("PRINT_PASS", A, 10),
        row("PRINT_REQUEST", C, 20),
        row("PRINT_REQUEST", B, 30),
      ],
      A,
    );
    expect(fold.decider).toBe(true);
    expect(decidePrint(fold, { ...base, me: A, capable: false })).toEqual({
      kind: "reassign",
      to: C,
    });
  });

  it("holder that announced with no requests waits (solicit stays open)", () => {
    const fold = foldPrintBaton([row("PRINT_PASS", A, 10)], A);
    expect(decidePrint(fold, { ...base, me: A, capable: false }).kind).toBe(
      "wait",
    );
  });

  it("holder may still print itself after announcing (printer came back)", () => {
    const fold = foldPrintBaton([row("PRINT_PASS", A, 10)], A);
    expect(decidePrint(fold, { ...base, me: A, capable: true }).kind).toBe(
      "send",
    );
  });

  it("an author that reassigned is out forever", () => {
    const fold = foldPrintBaton(
      [
        row("PRINT_PASS", A, 10),
        row("PRINT_REQUEST", B, 20),
        row("PRINT_REASSIGN", A, 30, { to: B }),
      ],
      A,
    );
    expect(decidePrint(fold, { ...base, me: A, capable: true }).kind).toBe(
      "stand-down",
    );
    expect(decidePrint(fold, { ...base, me: A, capable: false }).kind).toBe(
      "stand-down",
    );
  });

  it("capable device requests once, only while a solicit is open", () => {
    const open = foldPrintBaton([], A);
    expect(decidePrint(open, { ...base, me: B, capable: true }).kind).toBe(
      "wait",
    );

    const solicit = foldPrintBaton([row("PRINT_PASS", A, 10)], A);
    expect(decidePrint(solicit, { ...base, me: B, capable: true }).kind).toBe(
      "request",
    );

    const already = foldPrintBaton(
      [row("PRINT_PASS", A, 10), row("PRINT_REQUEST", B, 20)],
      A,
    );
    expect(
      decidePrint(already, {
        ...base,
        me: B,
        capable: true,
        requestedObservedAt: 999950,
      }).kind,
    ).toBe("wait");
  });

  it("non-capable devices never request", () => {
    const fold = foldPrintBaton([row("PRINT_PASS", A, 10)], A);
    expect(decidePrint(fold, { ...base, me: B, capable: false }).kind).toBe(
      "wait",
    );
  });

  it("alert arms 60 s after my request, only while unresolved and not holder", () => {
    const rows = [row("PRINT_PASS", A, 10), row("PRINT_REQUEST", B, 20)];
    const fold = foldPrintBaton(rows, A);
    const requestedObservedAt = base.now - PRINT_ALERT_MS;
    expect(
      decidePrint(fold, { ...base, me: B, capable: true, requestedObservedAt }).kind,
    ).toBe("alert");
    expect(
      decidePrint(fold, {
        ...base,
        me: B,
        capable: true,
        requestedObservedAt: base.now - PRINT_ALERT_MS + 1,
      }).kind,
    ).toBe("wait");
  });

  it("alert self-clears when a SUCCESS arrives", () => {
    const fold = foldPrintBaton(
      [
        row("PRINT_PASS", A, 10),
        row("PRINT_REQUEST", B, 20),
        row("PRINT_SUCCESS", A, 30, {}),
      ],
      A,
    );
    expect(
      decidePrint(fold, {
        ...base,
        me: B,
        capable: true,
        requestedObservedAt: base.now - PRINT_ALERT_MS,
      }).kind,
    ).toBe("stand-down");
  });

  it("alert self-clears when the baton is reassigned to me", () => {
    const fold = foldPrintBaton(
      [
        row("PRINT_PASS", A, 10),
        row("PRINT_REQUEST", B, 20),
        row("PRINT_REASSIGN", A, 30, { to: B }),
      ],
      A,
    );
    expect(
      decidePrint(fold, {
        ...base,
        me: B,
        capable: true,
        requestedObservedAt: base.now - PRINT_ALERT_MS,
      }).kind,
    ).toBe("send");
  });

  it("server device (me = null) announces as holder and stands down after reassigning", () => {
    const open = foldPrintBaton([], null);
    expect(decidePrint(open, { ...base, me: null, capable: false }).kind).toBe(
      "pass",
    );

    const afterReassign = foldPrintBaton(
      [
        row("PRINT_PASS", null, 10),
        row("PRINT_REQUEST", B, 20),
        row("PRINT_REASSIGN", null, 30, { to: B }),
      ],
      null,
    );
    expect(
      decidePrint(afterReassign, { ...base, me: null, capable: false }).kind,
    ).toBe("stand-down");
  });

  it("server creator (me null, chain[0] null) arms the creator alert past 60 s", () => {
    const rows = [
      row("PRINT_PASS", null, 10),
      row("PRINT_REQUEST", B, 20),
      row("PRINT_REASSIGN", null, 30, { to: B }),
    ];
    const fold = foldPrintBaton(rows, null);
    expect(fold.chain[0]).toBeNull();
    expect(fold.reassignAuthors).toEqual([null]);
    // Exactly 60 s old: `now - observedAt >= PRINT_ALERT_MS` still holds.
    const observedAt = base.now - PRINT_ALERT_MS;
    expect(
      decidePrint(fold, { ...base, me: null, capable: false, observedAt }).kind,
    ).toBe("alert");
  });

  it("server creator stands down (no alert) before the 60 s window expires", () => {
    const rows = [
      row("PRINT_PASS", null, 10),
      row("PRINT_REQUEST", B, 20),
      row("PRINT_REASSIGN", null, 30, { to: B }),
    ];
    const fold = foldPrintBaton(rows, null);
    const observedAt = base.now - PRINT_ALERT_MS + 1;
    // decidePrint itself never carries alertInMs — the remaining-window arm
    // lives in runBatonPrint's stand-down branch; here it is a plain stand-down.
    expect(
      decidePrint(fold, { ...base, me: null, capable: false, observedAt }).kind,
    ).toBe("stand-down");
  });

  it("the reassign target skips a null (server) request for the next human device", () => {
    const rows = [
      row("PRINT_PASS", A, 10),
      row("PRINT_REQUEST", null, 20),
      row("PRINT_REQUEST", B, 30),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.requests).toEqual([null, B]);
    expect(decidePrint(fold, { ...base, me: A, capable: false })).toEqual({
      kind: "reassign",
      to: B,
    });
  });

  it("a stranded holder's reassign also skips the null request", () => {
    const rows = [
      row("PRINT_PASS", A, 10, { reason: "stranded" }),
      row("PRINT_REQUEST", null, 20),
      row("PRINT_REQUEST", B, 30),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(decidePrint(fold, { ...base, me: A, capable: true })).toEqual({
      kind: "reassign",
      to: B,
    });
  });

  it("the holder's own request is never a reassign target", () => {
    // B is the holder AND the only requester: without the `r !== me` filter
    // it would reassign to itself — a REASSIGN_CYCLE on the next fold.
    const rows = [
      row("PRINT_PASS", A, 10),
      row("PRINT_REQUEST", B, 20),
      row("PRINT_REASSIGN", A, 30, { to: B }),
      row("PRINT_PASS", B, 40),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.holder).toBe(B);
    expect(fold.requests).toEqual([B]);
    expect(decidePrint(fold, { ...base, me: B, capable: false })).toEqual({
      kind: "wait",
    });
  });

  it("original-device alert: creator sees alert (>60 s, reassign but no success)", () => {
    // A created the ticket, passed the baton (PRINT_PASS), then reassigned to B.
    // No PRINT_SUCCESS. Ticket created >60 s ago → A (the original device)
    // should get the alert instead of silently standing down.
    const rows = [
      row("PRINT_PASS", A, 10),
      row("PRINT_REQUEST", B, 20),
      row("PRINT_REASSIGN", A, 30, { to: B }),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.reassignAuthors).toEqual([A]);
    expect(fold.chain[0]).toBe(A);
    const observedAt = base.now - PRINT_ALERT_MS - 1;
    expect(
      decidePrint(fold, { ...base, me: A, capable: false, observedAt }).kind,
    ).toBe("alert");
  });

  it("original-device alert does not fire before 60 s", () => {
    const rows = [
      row("PRINT_PASS", A, 10),
      row("PRINT_REQUEST", B, 20),
      row("PRINT_REASSIGN", A, 30, { to: B }),
    ];
    const fold = foldPrintBaton(rows, A);
    const observedAt = base.now - PRINT_ALERT_MS + 1;
    expect(
      decidePrint(fold, { ...base, me: A, capable: false, observedAt }).kind,
    ).toBe("stand-down");
  });

  it("creator holder reassigns to a waiting requester even past the 60 s strand window", () => {
    // Never-print regression: A created the ticket, its one send was refused
    // (stranded pass), B and C requested — but the round trip landed ≥60 s
    // after A's first observation. The alert is a surface, not a blocker: A
    // must reassign (first requester in fold order) instead of returning
    // 'alert' forever and letting the chain die at PRINT_FAILED.
    const rows = [
      row("PRINT_PASS", A, 1000, { reason: "stranded" }),
      row("PRINT_REQUEST", B, 2000),
      row("PRINT_REQUEST", C, 3000),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.holder).toBe(A);
    expect(fold.stranded).toBe(true);
    const observedAt = base.now - PRINT_ALERT_MS - 1;
    expect(
      decidePrint(fold, { ...base, me: A, capable: true, observedAt }),
    ).toEqual({ kind: "reassign", to: B });
  });

  it("creator holder with a print_failed pass reassigns past 60 s (non-stranded evidence)", () => {
    // Same rule when the evidence is a print_failed (not stranded) pass: the
    // holder's productive move wins over the creator alert.
    const rows = [
      row("PRINT_PASS", A, 1000, { reason: "print_failed" }),
      row("PRINT_REQUEST", B, 2000),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.stranded).toBe(false);
    const observedAt = base.now - PRINT_ALERT_MS - 1;
    expect(
      decidePrint(fold, { ...base, me: A, capable: false, observedAt }),
    ).toEqual({ kind: "reassign", to: B });
  });

  it("creator holder still alerts past 60 s when no requester is waiting", () => {
    // The alert surface itself is unchanged: with nothing to reassign to,
    // the strand window decides.
    const rows = [row("PRINT_PASS", A, 1000, { reason: "stranded" })];
    const fold = foldPrintBaton(rows, A);
    const observedAt = base.now - PRINT_ALERT_MS - 1;
    expect(
      decidePrint(fold, { ...base, me: A, capable: true, observedAt }).kind,
    ).toBe("alert");
  });

  it("a capable holder with its own refusal evidence never re-sends", () => {
    // Never-print regression (send gate): the one-send rule is not limited
    // to `stranded` — a legacy `print_failed` pass is the same evidence.
    // A capable holder reassigns to a waiting requester; with nobody
    // waiting it waits instead of retrying the printer that already
    // refused it (each device tries once, never retries).
    const withRequester = foldPrintBaton(
      [
        row("PRINT_PASS", A, 1000, { reason: "print_failed" }),
        row("PRINT_REQUEST", B, 2000),
      ],
      A,
    );
    expect(
      decidePrint(withRequester, { ...base, me: A, capable: true }),
    ).toEqual({ kind: "reassign", to: B });

    const alone = foldPrintBaton(
      [row("PRINT_PASS", A, 1000, { reason: "print_failed" })],
      A,
    );
    expect(decidePrint(alone, { ...base, me: A, capable: true })).toEqual({
      kind: "wait",
    });
  });

  it("original-device alert does not fire when a non-creator device reassigned", () => {
    // B reassigned (not the creator). Even if >60 s and no success, B should
    // stand down — only the original device (creator) arms the alert.
    const rows = [
      row("PRINT_PASS", A, 10),
      row("PRINT_REQUEST", C, 20),
      row("PRINT_REASSIGN", A, 30, { to: B }),
      row("PRINT_PASS", B, 40),
      row("PRINT_REQUEST", C, 50),
      row("PRINT_REASSIGN", B, 60, { to: C }),
    ];
    const fold = foldPrintBaton(rows, A);
    // B is a reassign author but NOT the creator (chain[0] = A).
    const observedAt = base.now - PRINT_ALERT_MS - 1;
    expect(
      decidePrint(fold, { ...base, me: B, capable: false, observedAt }).kind,
    ).toBe("stand-down");
  });

  it("original-device alert self-clears when a SUCCESS arrives", () => {
    const rows = [
      row("PRINT_PASS", A, 10),
      row("PRINT_REQUEST", B, 20),
      row("PRINT_REASSIGN", A, 30, { to: B }),
      row("PRINT_SUCCESS", B, 40, {}),
    ];
    const fold = foldPrintBaton(rows, A);
    const observedAt = base.now - PRINT_ALERT_MS - 1;
    expect(
      decidePrint(fold, { ...base, me: A, capable: false, observedAt }).kind,
    ).toBe("stand-down");
  });

  it("original-device alert self-clears when a SUCCESS arrives via reassignment", async () => {
    // A created, reassigned to B; B printed successfully. A is the original
    // device but the fold is terminal → stand-down (alert clears).
    const rows = [
      row("PRINT_PASS", A, 10),
      row("PRINT_REQUEST", B, 20),
      row("PRINT_REASSIGN", A, 30, { to: B }),
      row("PRINT_SUCCESS", B, 40, {}),
    ];
    const fold = foldPrintBaton(rows, A);
    const observedAt = base.now - PRINT_ALERT_MS - 1;
    expect(
      decidePrint(fold, { ...base, me: A, capable: false, observedAt }).kind,
    ).toBe("stand-down");
  });

  it("original-device alert fires on local print failure (no reassign), >60 s", () => {
    // A created the ticket, tried to print, the transport refused
    // (PRINT_PASS reason=print_failed). No reassign, no SUCCESS. A is still
    // the holder. Ticket created >60 s ago → A should get the alert.
    const rows = [row("PRINT_PASS", A, 1000, { reason: "print_failed" })];
    const fold = foldPrintBaton(rows, A);
    expect(fold.printFailAuthors).toEqual([A]);
    expect(fold.holder).toBe(A);
    expect(fold.chain[0]).toBe(A);
    const observedAt = base.now - PRINT_ALERT_MS - 1;
    expect(
      decidePrint(fold, { ...base, me: A, capable: false, observedAt }).kind,
    ).toBe("alert");
  });

  it("original-device alert on local print failure does not fire before 60 s", () => {
    const rows = [row("PRINT_PASS", A, 1000, { reason: "print_failed" })];
    const fold = foldPrintBaton(rows, A);
    const observedAt = base.now - PRINT_ALERT_MS + 1;
    // <60 s: creator is still holder, has passed, no requests → wait (holder
    // that already passed, decider with no requests to reassign to).
    expect(
      decidePrint(fold, { ...base, me: A, capable: false, observedAt }).kind,
    ).toBe("wait");
  });

  it("original-device local-print-fail alert does NOT fire for the non-creator", () => {
    // B had a print failure, A is the creator. B is not the holder (A is), and
    // B passing while not holder is a conflict → attention, not alert.
    const rows = [row("PRINT_PASS", B, 1000, { reason: "print_failed" })];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("conflict");
    const observedAt = base.now - PRINT_ALERT_MS - 1;
    expect(
      decidePrint(fold, { ...base, me: B, capable: false, observedAt }).kind,
    ).toBe("attention");
  });

  it("original-device alert fires for either print_failed OR reassign (no SUCCESS)", () => {
    // A created, failed print, AND reassigned — alert fires (covers AND of
    // both evidence sources in the requirement).
    const rows = [
      row("PRINT_PASS", A, 1000, { reason: "print_failed" }),
      row("PRINT_REQUEST", B, 2000),
      row("PRINT_REASSIGN", A, 3000, { to: B }),
    ];
    const fold = foldPrintBaton(rows, A);
    const observedAt = base.now - PRINT_ALERT_MS - 1;
    expect(
      decidePrint(fold, { ...base, me: A, capable: false, observedAt }).kind,
    ).toBe("alert");
  });

  it("original-device local-print-fail alert self-clears on SUCCESS", () => {
    const rows = [
      row("PRINT_PASS", A, 1000, { reason: "print_failed" }),
      row("PRINT_SUCCESS", A, 2000, {}),
    ];
    const fold = foldPrintBaton(rows, A);
    const observedAt = base.now - PRINT_ALERT_MS - 1;
    expect(
      decidePrint(fold, { ...base, me: A, capable: false, observedAt }).kind,
    ).toBe("stand-down");
  });

  it("original-device alert on print_failed stays silent when the device is not capable but <60 s", () => {
    const rows = [row("PRINT_PASS", A, 1000, { reason: "print_failed" })];
    const fold = foldPrintBaton(rows, A);
    const observedAt = base.now - 30_000; // 30 s ago
    expect(
      decidePrint(fold, { ...base, me: A, capable: false, observedAt }).kind,
    ).toBe("wait");
  });

  it("manual takeover is allowed only while unresolved", () => {
    expect(manualTakeoverAllowed(foldPrintBaton([], A))).toBe(true);
    expect(
      manualTakeoverAllowed(foldPrintBaton([row("PRINT_PASS", D, 10)], A)),
    ).toBe(true);
    expect(
      manualTakeoverAllowed(
        foldPrintBaton([row("PRINT_SUCCESS", A, 10, {})], A),
      ),
    ).toBe(false);
  });
});

describe("printSpinnerState — silent-print spinner", () => {
  const trying = { printed: 0, silentPrint: true, ageMs: 60_000 };

  it("spins while the ticket is printable and has no PRINT_SUCCESS yet", () => {
    expect(printSpinnerState(trying)).toBe("trying");
  });

  it("no spinner once PRINT_SUCCESS exists (0/1 from SQL EXISTS and booleans)", () => {
    expect(printSpinnerState({ ...trying, printed: 1 })).toBeNull();
    expect(printSpinnerState({ ...trying, printed: true })).toBeNull();
    expect(printSpinnerState({ ...trying, printed: false })).toBe("trying");
  });

  it("no spinner when silent print is off (nothing is expected to print)", () => {
    expect(printSpinnerState({ ...trying, silentPrint: false })).toBeNull();
    expect(printSpinnerState({ ...trying, silentPrint: null })).toBeNull();
  });

  it("no spinner when the surface does not carry print state", () => {
    expect(printSpinnerState({ ...trying, printed: null })).toBeNull();
    expect(printSpinnerState({ ...trying, printed: undefined })).toBeNull();
  });

  it("flips to failed only once the ticket is past the fail threshold", () => {
    expect(
      printSpinnerState({ ...trying, ageMs: PRINT_SPINNER_FAIL_MS - 1 }),
    ).toBe("trying");
    expect(printSpinnerState({ ...trying, ageMs: PRINT_SPINNER_FAIL_MS })).toBe(
      "failed",
    );
    expect(
      printSpinnerState({ ...trying, ageMs: PRINT_SPINNER_FAIL_MS + 60_000 }),
    ).toBe("failed");
  });

  it("age unknown (anchor not fetched yet) keeps spinning instead of failing", () => {
    expect(printSpinnerState({ ...trying, ageMs: null })).toBe("trying");
    expect(printSpinnerState({ ...trying, ageMs: undefined })).toBe("trying");
    expect(printSpinnerState({ ...trying, ageMs: 0 })).toBe("trying");
    // A negative age (clock skew between the anchor and now) is not "old".
    expect(printSpinnerState({ ...trying, ageMs: -5 })).toBe("trying");
  });

  it("only printed true/1 mean printed — anything else falls through as not-printed", () => {
    // SQL EXISTS returns 0/1, but a truthy count (2) must not be mistaken for
    // "PRINT_SUCCESS exists": it falls through to the age check.
    expect(printSpinnerState({ ...trying, printed: 2 })).toBe("trying");
    expect(
      printSpinnerState({ ...trying, printed: 2, ageMs: PRINT_SPINNER_FAIL_MS }),
    ).toBe("failed");
  });

  it("Phase 3: pendingMs (local observation) wins over ageMs (foreign stamp)", () => {
    // The foreign age anchor claims the ticket is past the threshold, but
    // THIS device first observed the print-pending state a moment ago — the
    // local window is young, so it keeps spinning.
    expect(
      printSpinnerState({
        ...trying,
        ageMs: PRINT_SPINNER_FAIL_MS + 60_000,
        pendingMs: 1_000,
      }),
    ).toBe("trying");
    // Conversely, a local observation past the threshold decides even when
    // the foreign age anchor is unknown or claims the ticket is new.
    expect(
      printSpinnerState({ ...trying, ageMs: null, pendingMs: PRINT_SPINNER_FAIL_MS }),
    ).toBe("failed");
    expect(
      printSpinnerState({ ...trying, ageMs: 1_000, pendingMs: PRINT_SPINNER_FAIL_MS + 1 }),
    ).toBe("failed");
    // pendingMs exactly at the threshold flips, like ageMs.
    expect(
      printSpinnerState({ ...trying, ageMs: 0, pendingMs: PRINT_SPINNER_FAIL_MS }),
    ).toBe("failed");
    expect(
      printSpinnerState({ ...trying, ageMs: 0, pendingMs: PRINT_SPINNER_FAIL_MS - 1 }),
    ).toBe("trying");
  });
});

describe("foldPrintBaton — stranded failover (item 9)", () => {
  it("a stranded pass marks the fold stranded; not_capable does not", () => {
    const stranded = foldPrintBaton(
      [row("PRINT_PASS", A, 10, { reason: "stranded" })],
      A,
    );
    expect(stranded.stranded).toBe(true);
    expect(stranded.decider).toBe(true);

    const notCapable = foldPrintBaton(
      [row("PRINT_PASS", A, 10, { reason: "not_capable" })],
      A,
    );
    expect(notCapable.stranded).toBe(false);
  });

  it("a reassign after the stranded pass clears the flag", () => {
    const fold = foldPrintBaton(
      [
        row("PRINT_PASS", A, 10, { reason: "stranded" }),
        row("PRINT_REASSIGN", A, 20, { to: B }),
      ],
      A,
    );
    expect(fold.stranded).toBe(false);
    expect(fold.holder).toBe(B);
  });

  it("printFailAuthors counts a stranded pass (the creator alert must arm)", () => {
    const fold = foldPrintBaton(
      [row("PRINT_PASS", A, 10, { reason: "stranded" })],
      A,
    );
    expect(fold.printFailAuthors).toEqual([A]);
  });
});

describe("decidePrint — stranded failover (item 9)", () => {
  const base = { now: 1000000 };

  function strandedFold() {
    return foldPrintBaton([row("PRINT_PASS", A, 10, { reason: "stranded" })], A);
  }

  it("a stranded holder never sends — even when capable", () => {
    const fold = strandedFold();
    expect(decidePrint(fold, { ...base, me: A, capable: true })).toEqual({
      kind: "wait",
    });
  });

  it("a stranded holder reassigns to the first requester", () => {
    const fold = foldPrintBaton(
      [
        row("PRINT_PASS", A, 10, { reason: "stranded" }),
        row("PRINT_REQUEST", B, 20, {}),
      ],
      A,
    );
    expect(decidePrint(fold, { ...base, me: A, capable: true })).toEqual({
      kind: "reassign",
      to: B,
    });
  });

  it("a capable peer requests over a stranded pass (the old assigned-fold lock-out)", () => {
    const fold = strandedFold();
    expect(decidePrint(fold, { ...base, me: B, capable: true }).kind).toBe(
      "request",
    );
  });

  it("a non-capable peer does not request over a stranded pass", () => {
    const fold = strandedFold();
    expect(decidePrint(fold, { ...base, me: B, capable: false }).kind).toBe(
      "wait",
    );
  });

  it("a device that already requested does not request again", () => {
    const fold = foldPrintBaton(
      [
        row("PRINT_PASS", A, 10, { reason: "stranded" }),
        row("PRINT_REQUEST", B, 20, {}),
      ],
      A,
    );
    expect(decidePrint(fold, { ...base, me: B, capable: true }).kind).toBe(
      "wait",
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — per-author ordinal (`seq`) replaces raw-stamp ordering for every
// same-author comparison (open-pass test, PASS_AFTER_REASSIGN, latest-pass).
// A skewed foreign stamp must no longer shadow or rewind the author's own
// order; a counter rewind degrades to the stamp behaviour, never worse.
// ---------------------------------------------------------------------------
describe("foldPrintBaton — per-author seq ordering (Phase 2)", () => {
  const seqRow = (
    action: string,
    author: string,
    time_stamp: number,
    seq: number,
    payload: any = {},
  ): PrintRow => ({ action, author, time_stamp, payload: { ...payload, seq }, seq });

  it("open-pass test: seq orders a pass before a reassign despite a skewed stamp", () => {
    // A slow-clock author: pass stamped 9000 (looks older than the reassign's
    // 100) but seq says the pass came first. The chain must walk.
    const rows = [
      seqRow("PRINT_PASS", A, 9000, 1),
      seqRow("PRINT_REASSIGN", A, 100, 2, { to: B }),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.conflict).toEqual([]);
    expect(fold.state).toBe("assigned");
    expect(fold.chain).toEqual([A, B]);
    expect(fold.holder).toBe(B);
  });

  it("open-pass test: a pass strictly after the reassign (seq) is REASSIGN_WITHOUT_PASS", () => {
    const rows = [
      seqRow("PRINT_REASSIGN", A, 100, 2, { to: B }),
      seqRow("PRINT_PASS", A, 9000, 3),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.conflict).toContain("REASSIGN_WITHOUT_PASS");
    expect(fold.state).toBe("conflict");
  });

  it("PASS_AFTER_REASSIGN: seq decides, not the stamp", () => {
    // seq says the pass came after the reassign, but the stamp says before.
    const rows = [
      seqRow("PRINT_PASS", A, 100, 1),
      seqRow("PRINT_REASSIGN", A, 9000, 2, { to: B }),
      seqRow("PRINT_PASS", A, 50, 3),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.conflict).toContain("PASS_AFTER_REASSIGN");
  });

  it("PASS_AFTER_REASSIGN: a pass at the same seq point is tolerated", () => {
    const rows = [
      seqRow("PRINT_PASS", A, 100, 1),
      seqRow("PRINT_REASSIGN", A, 9000, 1, { to: B }),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.conflict).toEqual([]);
    expect(fold.state).toBe("assigned");
  });

  it("seq collision tiebreaks on the author's own stamp (rewind degrades to stamps)", () => {
    // A device-restore rewound the counter: pass and reassign share seq 1.
    // The author's own stamps then decide — the pre-seq behaviour.
    const rows = [
      seqRow("PRINT_PASS", A, 500, 1),
      seqRow("PRINT_REASSIGN", A, 100, 1, { to: B }),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.conflict).toContain("REASSIGN_WITHOUT_PASS");
  });

  it("legacy rows (no seq) fall back to time_stamp within the author", () => {
    const rows: PrintRow[] = [
      { action: "PRINT_PASS", author: A, time_stamp: 100, payload: {} },
      { action: "PRINT_REASSIGN", author: A, time_stamp: 200, payload: { to: B } },
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.conflict).toEqual([]);
    expect(fold.state).toBe("assigned");
    expect(fold.holder).toBe(B);
  });

  it("mixed legacy + seq rows compare on the stamp (no cross-form ordering)", () => {
    // A legacy pass (no seq) vs a seq'd reassign: the fallback is the stamp.
    const rows: PrintRow[] = [
      { action: "PRINT_PASS", author: A, time_stamp: 100, payload: {} },
      seqRow("PRINT_REASSIGN", A, 200, 5, { to: B }),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.conflict).toEqual([]);
    expect(fold.state).toBe("assigned");
  });

  it("latest-pass scan uses seq: a newer stranded pass sets the flag", () => {
    const rows = [
      seqRow("PRINT_PASS", A, 100, 1, { reason: "stranded" }),
      seqRow("PRINT_PASS", A, 200, 2),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.stranded).toBe(false);
  });

  it("latest-pass scan uses seq: a newer normal pass clears the flag", () => {
    const rows = [
      seqRow("PRINT_PASS", A, 9000, 1, { reason: "stranded" }),
      seqRow("PRINT_PASS", A, 100, 2),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.stranded).toBe(false);
  });

  it("latest-pass scan uses seq: a newer stranded pass (lower stamp) sets the flag", () => {
    const rows = [
      seqRow("PRINT_PASS", A, 9000, 1),
      seqRow("PRINT_PASS", A, 100, 2, { reason: "stranded" }),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.stranded).toBe(true);
  });

  it("seq never orders across authors — only same-author rows compare", () => {
    // B's seq 1 pass vs A's seq 9 reassign: the fold must not treat B's pass
    // as covering A's reassign (different author) — the chain walks to B via
    // A's own pass, and B's pass is then a holder pass, not a conflict.
    const rows = [
      seqRow("PRINT_PASS", A, 100, 9),
      seqRow("PRINT_PASS", B, 200, 1),
      seqRow("PRINT_REASSIGN", A, 300, 10, { to: B }),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.conflict).toEqual([]);
    expect(fold.chain).toEqual([A, B]);
    expect(fold.holder).toBe(B);
  });
});

describe("Phase 4 — PRINT_FAILED fold / decide / spinner", () => {
  it("PRINT_FAILED alone: state failed, terminal — every device stands down", () => {
    const rows = [row(PRINT_FAILED, B, 1000, { device_id: D })];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("failed");
    expect(fold.terminal).toBe(true);
    expect(fold.failed).toBe(true);
    expect(fold.conflict).toEqual([]);
    // decidePrint is stand-down for EVERY device — holder, author, stranger:
    // no requests, no sends, no passes on any of them.
    for (const me of [A, B, D, "dev-x"]) {
      expect(decidePrint(fold, { me, capable: true, now: 2000 }).kind).toBe(
        "stand-down",
      );
    }
  });

  it("success dominates: PRINT_SUCCESS + PRINT_FAILED → printed, never conflict", () => {
    // The 4:58-print / 5:00-declare race resolved in both directions.
    const rows = [
      row("PRINT_FAILED", B, 1000, { device_id: D }),
      row("PRINT_SUCCESS", A, 2000, { device_id: A }),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("printed");
    expect(fold.terminal).toBe(true);
    expect(fold.failed).toBe(false);
    expect(fold.conflict).toEqual([]);
  });

  it("multi-writer: several PRINT_FAILED rows → one stand-down, no conflict", () => {
    const rows = [
      row(PRINT_FAILED, A, 1000, { device_id: A }),
      row(PRINT_FAILED, B, 1100, { device_id: D }),
      row(PRINT_FAILED, C, 1200, { device_id: "dev-z" }),
    ];
    const fold = foldPrintBaton(rows, A);
    expect(fold.state).toBe("failed");
    expect(fold.failed).toBe(true);
    expect(fold.terminal).toBe(true);
    expect(fold.conflict).toEqual([]);
  });

  it("failed beats an open solicit and an assigned chain", () => {
    const solicit = foldPrintBaton(
      [
        row("PRINT_PASS", A, 1000, { device_id: A }),
        row(PRINT_FAILED, B, 2000, { device_id: D }),
      ],
      A,
    );
    expect(solicit.state).toBe("failed");

    const assigned = foldPrintBaton(
      [
        row("PRINT_PASS", A, 1000, { device_id: A }),
        row("PRINT_REASSIGN", A, 2000, { to: D, device_id: A }),
        row(PRINT_FAILED, B, 3000, { device_id: D }),
      ],
      A,
    );
    expect(assigned.state).toBe("failed");
    expect(assigned.chain).toEqual([A, D]);
  });

  it("conflict still outranks failed — the attention verdict survives", () => {
    const fold = foldPrintBaton(
      [
        // REASSIGN without a pass → conflict, plus a late declaration.
        row("PRINT_REASSIGN", A, 1000, { to: D, device_id: A }),
        row(PRINT_FAILED, B, 2000, { device_id: D }),
      ],
      A,
    );
    expect(fold.state).toBe("conflict");
    expect(fold.failed).toBe(true); // no success — still untakeable-safe
    expect(fold.terminal).toBe(true);
  });

  it("manualTakeoverAllowed from failed; the manual success clears it", () => {
    const failedFold = foldPrintBaton(
      [row(PRINT_FAILED, B, 1000, { device_id: D })],
      A,
    );
    expect(manualTakeoverAllowed(failedFold)).toBe(true);

    const takenOver = foldPrintBaton(
      [
        row(PRINT_FAILED, B, 1000, { device_id: D }),
        row("PRINT_SUCCESS", A, 2000, { manual: true, device_id: A }),
      ],
      A,
    );
    expect(takenOver.state).toBe("printed");
    expect(takenOver.failed).toBe(false);
    expect(manualTakeoverAllowed(takenOver)).toBe(false);
  });

  it("spinner: the durable failed verdict renders on every device", () => {
    // No local window needed — the EXISTS column flips it immediately.
    expect(
      printSpinnerState({ printed: 0, silentPrint: true, failed: 1 }),
    ).toBe("failed");
    // …even before this device's own 5:00 window elapsed.
    expect(
      printSpinnerState({
        printed: 0,
        silentPrint: true,
        failed: 1,
        pendingMs: 1_000,
      }),
    ).toBe("failed");
    // Success dominates: printed → no spinner at all (green check path).
    expect(
      printSpinnerState({ printed: 1, silentPrint: true, failed: 1 }),
    ).toBeNull();
    // Silent print off → quiet even with a failed row.
    expect(
      printSpinnerState({ printed: 0, silentPrint: false, failed: 1 }),
    ).toBeNull();
  });
});
