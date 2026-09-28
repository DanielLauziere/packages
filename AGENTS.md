# AGENTS.md — packages repo entry point for agents

## What this repo is

`@omni/packages` — the shared TypeScript code both DirectEatz clients consume.
Today it holds one workspace package: **`@omni/ticket-engine`**.

The engine is the TS port of the Go apply/seed logic in `../omni`. Its contract:
**identical input → identical state** across web (`frontend`) and RN
(`rolonative`), and byte-parity with the Go side. Most of its rules are
*owned* by docs in the omni repo — this repo implements and tests them.

## Doc map

| Doc | Owns | Consult it when… |
|---|---|---|
| `../omni/docs/CORE-LOGIC-TICKET-LOGS.md` | The apply ruleset: idempotency, ordering, FK gates, retries, buckets | Changing `applyTicketLog.ts`, `syncBuckets.ts`, log actions |
| `../omni/docs/CORE-LOGIC-SCHEMA-SYNC.md` | Server-driven schema parity, `schemaUuid`, wipe+rebuild | Changing `migrateSchema.ts`, `generatedSchema.ts`, seed flow |
| `../omni/docs/CRITICAL-RISKS.md` | Catastrophic failure classes + living test checklist (T1–T24) | Before shipping any engine change |
| `../omni/OPS.md` | Server ops, deploy, `make drift` details | Schema/build-gate questions (human reference — do not edit) |
| `README.md` | Commands, usage, VSCode vitest setup | Quick command lookup (human reference — do not edit) |

## Core invariants (non-negotiables)

1. **Never hand-edit `src/generatedSchema.ts`** — it is emitted by the omni
   translator from `../omni/data/schema/baseline.sql` (`make drift` in omni).
2. **Per-row isolation in seed and apply** — one bad row is skipped (seed) or
   retried (apply `MISSING_DEPENDENCY`), never silently dropped or aborting
   a batch.
3. **Idempotent replay** — uuid is identity; upserts/`ON CONFLICT` so replaying
   a log or seed is a no-op.
4. **Unknown actions throw and are retried**, never silently applied.
5. **SQL must parse on SQLite 3.39.4** (RN quick-sqlite 8.2.7 floor) —
   `sqliteDialect.test.ts` enforces this.
6. **`syncBuckets.ts` is byte-compatible with Go**
   (`../omni/src/services/bucket/hashing.go`) — change both together.
7. Keep `dist/` fresh: consumers load a **copied** `file:../packages/ticket-engine`
   directory, so `yarn build` here + reinstall in the consumer after any source
   change.

## How to verify a change

```sh
yarn test          # vitest run (all engine tests)
yarn typecheck     # tsc --noEmit
yarn build         # emit dist/ (required by consumers)
```

- Tests needing `node:sqlite` require **Node ≥ 22.5** (env has newer).
- `applyParity.test.ts` reads `../omni/data/schema/out/apply-parity-scenarios.json`
  — **the sibling omni repo must be present** and `make drift` run there first.
- After engine changes also run the consumers: `vitest run` in `frontend/`,
  `yarn test:all` in `rolonative/`.

## Repo layout (short)

- `ticket-engine/src/applyTicketLog.ts` — log apply engine (per-action handlers, priority)
- `ticket-engine/src/calculateLocationTickets.ts` + `calculateCombos.ts` — ticket math (items, modifiers, promos, BOGO, combos)
- `ticket-engine/src/seedGroupDatabase.ts` + `seedCommon.ts` — idempotent seeder
- `ticket-engine/src/migrateSchema.ts` + `generatedSchema.ts` — schema uuid + DDL
- `ticket-engine/src/escpos.ts` — ESC/POS receipt builder (shared print formatting)
- `ticket-engine/src/syncBuckets.ts` — anti-entropy bucket hashing (Go parity)
- `ticket-engine/src/billing.ts` — plans + invoice math (shared by web + RN billing)
- `ticket-engine/src/help/` — bilingual (en/es) help content
- `vitest.config.ts` (repo root) — runs `ticket-engine/src/**/*.test.ts`

## Gotchas

- Dual lockfiles (`yarn.lock` + `package-lock.json`) exist at root and in
  `ticket-engine/` — yarn is what the scripts use; don't "fix" lockfiles
  unless asked.
- `seedProbe.test.ts` is a debug probe that console.logs — not a regression gate.
- The suite is ~310+ `it()` blocks across 15 files — trust `yarn test` output
  over any hardcoded count in prose.
