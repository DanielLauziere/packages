// Per-location-group seed matrix (F1/F4/F6) — LOCAL-MIGRATION-AND-SEED.md §tests.
//
// Every fixture in omni/data/seed-fixtures must seed a fresh client DB and
// pass the same health bar the boot sequence checks (helpers.isDbHealthy):
// required tables present, zero FK violations, admin + location_group rows.
// Also pins scrub guarantees (F6) and reseed idempotency (F4).
//
// This is the canonical suite; frontend and rolonative mirror it against their
// own wrappers (test-ownership matrix in frontend docs/TESTING-PLAN.md).
import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyDdl, FULL_DDL, SEED_ORDER, seedGroupDatabase, validateSeedPayload } from './index.js'

type DbAdapter = { run: (s: string, p?: unknown[]) => Promise<unknown>; query: (s: string, p?: unknown[]) => Promise<unknown> }

function adapter(db: DatabaseSync): DbAdapter {
  return {
    run: async (s: string, p: unknown[] = []) => db.prepare(s).run(...(p as any)),
    query: async (s: string, p: unknown[] = []) => db.prepare(s).all(...(p as any)),
  }
}

// From packages/ticket-engine/src/ the monorepo root is ../../../ (same as
// applyParity.test.ts — omni holds the fixtures as their single source).
const monoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const FIXTURES_DIR = join(monoRoot, 'omni', 'data', 'seed-fixtures')

type Manifest = {
  scrub: string[]
  scrub_columns: string[]
  location_groups: Array<{
    uuid: string
    name: string
    file: string
    sha256: string
    bytes: number
    seed_version: number
    row_counts: Record<string, number>
  }>
}

const manifest = JSON.parse(readFileSync(join(FIXTURES_DIR, 'manifest.json'), 'utf8')) as Manifest

// Scrub keys must be absent entirely (D1); anything ticket/guest/balance
// related leaking into a bundle is a privacy regression.
const SCRUBBED_KEYS = [
  'ticket',
  'ticket_menu_item',
  'ticket_menu_item_modifier',
  'ticket_payment',
  'ticket_promotion',
  'guest',
  'guest_address',
  'guest_location_group',
  'location_group_balance_history',
]

function loadFixture(file: string): Record<string, any> {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8'))
}

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

function count(db: DatabaseSync, table: string): number {
  return (db.prepare(`SELECT COUNT(*) c FROM "${table}"`).get() as any).c as number
}

const fixtureFiles = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json') && f !== 'manifest.json')

describe('seed matrix (F1) — every LG fixture seeds a healthy local DB', () => {
  it('manifest and fixture files agree', () => {
    expect(fixtureFiles.length).toBe(manifest.location_groups.length)
    for (const g of manifest.location_groups) {
      expect(fixtureFiles).toContain(g.file)
      const raw = readFileSync(join(FIXTURES_DIR, g.file))
      expect(createHash('sha256').update(raw).digest('hex')).toBe(g.sha256)
      expect(raw.length).toBe(g.bytes)
    }
  })

  for (const g of manifest.location_groups) {
    describe(`${g.name} (${g.uuid})`, () => {
      it('F1: seeds fresh, passes the boot health bar, counts match manifest', async () => {
        const payload = loadFixture(g.file)

        // Key-vs-schema audit: payload keys must be known SEED_ORDER tables
        // (plus the seed_version scalar) — catches exporter/schema drift and
        // modal-tag mismatches before they hit a client.
        const known = new Set<string>(SEED_ORDER)
        const unknownKeys = Object.keys(payload).filter((key) => !known.has(key) && key !== 'seed_version')
        expect(unknownKeys).toEqual([])

        const db = freshDb()
        await applyDdl(adapter(db), FULL_DDL)

        // No structural issues (unknown tables, missing join keys). The
        // top-level seed_version scalar is a documented harmless non-table
        // (clients read it in useSchemaSync) — not a payload defect.
        const issues = (await validateSeedPayload(adapter(db), payload)).filter(
          (i) => !(i.table === 'seed_version' && i.issue === 'nonTable'),
        )
        expect(issues).toEqual([])

        await seedGroupDatabase(adapter(db), payload as any, SEED_ORDER)

        // Boot health bar (helpers.isDbHealthy): required tables, zero FK
        // violations, admin + location_group present.
        const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as any[]).map((t) => t.name)
        expect(tables).toEqual(expect.arrayContaining(['location_group', 'admin']))
        expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([])
        expect(count(db, 'location_group')).toBe(1)
        const adminCount = count(db, 'admin')
        expect(adminCount).toBe(g.row_counts.admin ?? 0)
        // Dead tenants (no admin_location → nobody can bind to them) keep
        // admin=0; every live LG must be login-healthy after a bundled seed.
        if ((g.row_counts.admin ?? 0) > 0) {
          expect(adminCount).toBeGreaterThan(0)
        }

        // Row counts match the manifest exactly (catches silently dropped rows).
        for (const [table, expected] of Object.entries(g.row_counts)) {
          expect(count(db, table), `table ${table}`).toBe(expected)
        }
      })

      it('F6: scrub holds — no tickets/guests/balance history, no password hashes', async () => {
        const payload = loadFixture(g.file)
        for (const key of SCRUBBED_KEYS) {
          expect(payload[key], `scrub key "${key}" present in ${g.file}`).toBeUndefined()
        }
        const hashed = (payload.admin ?? []).filter((a: any) => a && a.password_hash)
        expect(hashed, 'admin rows with a password_hash').toEqual([])
      })

      it('F4: reseed is idempotent — same payload twice, identical counts', async () => {
        const payload = loadFixture(g.file)
        const db = freshDb()
        await applyDdl(adapter(db), FULL_DDL)
        await seedGroupDatabase(adapter(db), payload as any, SEED_ORDER)

        const before = Object.fromEntries(Object.keys(g.row_counts).map((t) => [t, count(db, t)]))

        // Reboot-style reseed against the already-seeded DB.
        await seedGroupDatabase(adapter(db), payload as any, SEED_ORDER)

        const after = Object.fromEntries(Object.keys(g.row_counts).map((t) => [t, count(db, t)]))
        expect(after).toEqual(before)
        expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([])
      })
    })
  }
})

// Regression (incident 2026-10-15, fixed omni-side in commit 52431aa): an
// admin's kitchen/guest printer pointers are admin-global, but
// location_group_printer ships LG-scoped in the per-venue seed payload. Before
// the server-side strip (stripCrossLocationGroupPrinters), a payload could
// point an admin at a printer ABSENT from the payload → the client seeded a
// dangling FK (seed runs with foreign_keys OFF) → PRAGMA foreign_key_check
// (the F1 boot health bar) hard-failed → boot bounced to logout/login loop.
//
// The F1/F3 suites above only ever see the fixed, sanitized fixtures. This
// test re-creates the MALFORMED payload itself and pins the client-side net:
// validateSeedPayload has NO FK-closure check (it validates tables and
// conflict keys only), the seed applies the dangling pointer as-is, and only
// the post-seed foreign_key_check catches it, identifying the admin table.
//
// Negative control (un-mutated payload seeds clean with an empty
// foreign_key_check) is already pinned by the F1 assertions above — not
// duplicated here.
describe('regression 2026-10-15 — admin printer pointer outside the payload', () => {
  // Pick a fixture shaped like the incident: admins AND printers present, but
  // the mutated pointer references a printer with no payload row.
  const g = manifest.location_groups.find(
    (x) => (x.row_counts.admin ?? 0) > 0 && (x.row_counts.location_group_printer ?? 0) > 0,
  )!
  const MISSING_PRINTER = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

  it('validation does not reject; seeding completes; foreign_key_check flags the admin row', async () => {
    const payload = loadFixture(g.file)
    const admin = (payload.admin as any[])[0]!
    // Reproduce the regression: the admin points at a printer that has NO
    // location_group_printer row in this LG-scoped payload.
    admin.kitchen_location_group_printer_uuid = MISSING_PRINTER
    admin.guest_location_group_printer_uuid = MISSING_PRINTER

    const db = freshDb()
    await applyDdl(adapter(db), FULL_DDL)

    // validateSeedPayload checks unknown tables / missing conflict keys only —
    // no FK closure — so the dangling pointer is NOT caught up front (filtered
    // the same way F1 filters the harmless seed_version scalar).
    const issues = (await validateSeedPayload(adapter(db), payload)).filter(
      (i) => !(i.table === 'seed_version' && i.issue === 'nonTable'),
    )
    expect(issues).toEqual([])

    // The seed applies the malformed rows as-is (foreign_keys OFF inside the
    // transaction) and completes without throwing...
    await seedGroupDatabase(adapter(db), payload as any, SEED_ORDER)
    const seeded = db
      .prepare(
        'SELECT kitchen_location_group_printer_uuid k, guest_location_group_printer_uuid g FROM admin WHERE uuid = ?',
      )
      .get(admin.uuid) as any
    expect(seeded).toEqual({ k: MISSING_PRINTER, g: MISSING_PRINTER })

    // ...and the boot health bar (F1's isDbHealthy foreign_key_check) is what
    // catches the dangling FK — non-empty, identifying the admin table and the
    // location_group_printer parent it points at.
    const violations = db.prepare('PRAGMA foreign_key_check').all() as Array<{ table: string; parent: string }>
    expect(violations.length).toBeGreaterThan(0)
    for (const v of violations) {
      expect(v.table).toBe('admin')
      expect(v.parent).toBe('location_group_printer')
    }
    db.close()
  })
})
