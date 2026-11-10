import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { foldPrintBaton, type PrintRow } from "./printProtocol.js";

// Print-fold parity corpus (Phase 2) — the Go engine reads the same file
// (omni/src/domain/print_fold_parity_test.go). Both must fold identical rows
// into identical states; the scenarios carry deliberately skewed `ts` stamps
// to prove the per-author `seq` ordinal drives ordering.

const corpusPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "printFoldParity.corpus.json",
);

interface CorpusRow {
  action: string;
  author: string | null;
  device_id?: string | null;
  ts: number;
  seq?: number;
  payload?: Record<string, unknown>;
}

interface CorpusScenario {
  name: string;
  creator: string;
  rows: CorpusRow[];
  expect: {
    state: string;
    holder: string;
    decider: boolean;
    terminal: boolean;
    conflicts: string[];
    chain: string[];
    stranded: boolean;
  };
}

function toPrintRow(r: CorpusRow): PrintRow {
  const payload = { ...(r.payload ?? {}) };
  if (r.device_id) payload.device_id = r.device_id;
  if (r.seq != null) payload.seq = r.seq;
  return {
    action: r.action,
    author: r.author,
    time_stamp: r.ts,
    payload,
    device_id: r.device_id ?? null,
    seq: r.seq ?? null,
  };
}

describe("print-fold parity corpus (Go ↔ TS)", () => {
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as {
    scenarios: CorpusScenario[];
  };

  for (const sc of corpus.scenarios) {
    it(sc.name, () => {
      const fold = foldPrintBaton(sc.rows.map(toPrintRow), sc.creator);
      expect(fold.state).toBe(sc.expect.state);
      expect(fold.holder).toBe(sc.expect.holder);
      expect(fold.decider).toBe(sc.expect.decider);
      expect(fold.terminal).toBe(sc.expect.terminal);
      expect(fold.conflict).toEqual(sc.expect.conflicts);
      expect(fold.chain).toEqual(sc.expect.chain);
      expect(fold.stranded).toBe(sc.expect.stranded);
    });
  }
});
