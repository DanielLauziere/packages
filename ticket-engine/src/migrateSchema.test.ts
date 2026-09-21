import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import {
  applyDdl,
  dropAllTables,
  FULL_DDL,
  getSchemaUuid,
  migrateSchema,
  setSchemaUuid,
} from './index.js'

function adapter(db: DatabaseSync) {
  return {
    run: async (s: string, p: unknown[] = []) => db.prepare(s).run(...(p as any)),
    query: async (s: string, p: unknown[] = []) => db.prepare(s).all(...(p as any)),
  }
}

function userTables(db: DatabaseSync): string[] {
  return (db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  ).all() as any[]).map((r) => r.name).sort()
}

// The core "never drop the protected tables" guarantee (Risk 1 cause 5).
// A schema wipe must DROP everything except key_value + print_record, and those
// two must keep their rows — otherwise a schema push logs the admin out and
// re-claims already-printed tickets.
it('T19: dropAllTables keeps key_value + print_record rows, drops everything else', async () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  await applyDdl(adapter(db), FULL_DDL)

  db.prepare(`INSERT INTO key_value (key, value) VALUES (?, ?)`).run(
    'device_uuid',
    'dev-123',
  )
  db.prepare(
    `INSERT INTO print_record (ticket_uuid, decision, synced) VALUES (?, ?, ?)`,
  ).run('tkt-1', 'printed', 1)

  const before = userTables(db)
  expect(before).toContain('key_value')
  expect(before).toContain('print_record')
  expect(before).toContain('admin') // a normal table that must go

  await dropAllTables(adapter(db), ['key_value', 'print_record'])

  const after = userTables(db)
  expect(after).toEqual(['key_value', 'print_record'])

  // Rows survived the wipe.
  const kv = db.prepare(`SELECT value FROM key_value WHERE key = 'device_uuid'`).get() as any
  expect(kv.value).toBe('dev-123')
  const pr = db.prepare(`SELECT decision FROM print_record WHERE ticket_uuid = 'tkt-1'`).get() as any
  expect(pr.decision).toBe('printed')

  // And the schema can be rebuilt on top of the survivors (full table set back).
  await applyDdl(adapter(db), FULL_DDL)
  expect(userTables(db)).toEqual(before)
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
})

// The full 'session' reset round-trip (the RN resetDatabase('session') primitive,
// exercised on the real engine). 'none' must be far more aggressive and drop the
// protected tables too.
describe('T20: resetDatabase round-trip preserves/clears protected tables', () => {
  it("'session' preserves key_value + print_record rows across drop+rebuild", async () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    await applyDdl(adapter(db), FULL_DDL)
    db.prepare(`INSERT INTO key_value (key, value) VALUES (?, ?)`).run('binding', 'lg-9')
    db.prepare(
      `INSERT INTO print_record (ticket_uuid, decision, synced) VALUES (?, ?, ?)`,
    ).run('tkt-2', 'printed', 0)

    // The real resetDatabase body: dropAllTables(protected) + applyDdl(FULL_DDL).
    await dropAllTables(adapter(db), ['key_value', 'print_record'])
    await applyDdl(adapter(db), FULL_DDL)

    expect(
      (db.prepare(`SELECT value FROM key_value WHERE key = 'binding'`).get() as any).value,
    ).toBe('lg-9')
    expect(
      (db.prepare(`SELECT decision FROM print_record WHERE ticket_uuid = 'tkt-2'`).get() as any)
        .decision,
    ).toBe('printed')
  })

  it("'none' drops key_value + print_record ROWS entirely (tables rebuilt empty)", async () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    await applyDdl(adapter(db), FULL_DDL)
    db.prepare(`INSERT INTO key_value (key, value) VALUES (?, ?)`).run('binding', 'lg-9')
    db.prepare(
      `INSERT INTO print_record (ticket_uuid, decision, synced) VALUES (?, ?, ?)`,
    ).run('tkt-2', 'printed', 0)

    await dropAllTables(adapter(db), [])
    await applyDdl(adapter(db), FULL_DDL)

    // FULL_DDL recreates the skeleton, but a 'none' wipe must have cleared the
    // rows — no binding, no print state survives a logout.
    expect((db.prepare(`SELECT COUNT(*) c FROM key_value`).get() as any).c).toBe(0)
    expect((db.prepare(`SELECT COUNT(*) c FROM print_record`).get() as any).c).toBe(0)
  })
})

// The brick guard: a malformed DDL statement must fail LOUD, not leave a partial
// schema (Risk 1 cause 5 / T21). Only genuine "already exists" errors are ignored.
describe('T21: applyDdl surfaces real errors, idempotent replay stays quiet', () => {
  it('throws on a malformed statement instead of swallowing it', async () => {
    const db = new DatabaseSync(':memory:')
    await expect(applyDdl(adapter(db), 'CREATE TABLE "x" (this is not valid sql')).rejects.toThrow()
  })

  it('throws on a duplicate column rather than building a broken table', async () => {
    const db = new DatabaseSync(':memory:')
    await expect(
      applyDdl(adapter(db), 'CREATE TABLE IF NOT EXISTS "broken" ("c" INTEGER, "c" TEXT)'),
    ).rejects.toThrow()
  })

  it('does NOT throw when replaying idempotent CREATE IF NOT EXISTS', async () => {
    const db = new DatabaseSync(':memory:')
    await expect(applyDdl(adapter(db), FULL_DDL)).resolves.not.toThrow()
    // Second apply must be a clean no-op (no "already exists" -> throw).
    await expect(applyDdl(adapter(db), FULL_DDL)).resolves.not.toThrow()
  })
})

// Rollback story (Risk 1 cause 5 / T23): redeploy the previous image → the old
// uuid differs again → the device wipes + reseeds back. Because applyDdl is
// additive-only (CREATE IF NOT EXISTS), an older schema cannot DROP a table a
// newer one added — that leftover is tolerated cruft, not a brick. The DB must
// stay self-consistent and the persisted uuid correct.
it('T23: applying A → B → A converges to a consistent DB with the final uuid', async () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const probe = '\nCREATE TABLE IF NOT EXISTS "schema_sync_probe" ("id" INTEGER PRIMARY KEY);'

  await migrateSchema(adapter(db), { schemaUuid: 'A', fullDdl: FULL_DDL })
  await migrateSchema(adapter(db), { schemaUuid: 'B', fullDdl: FULL_DDL + probe })
  await migrateSchema(adapter(db), { schemaUuid: 'A', fullDdl: FULL_DDL })

  expect(await getSchemaUuid(adapter(db))).toBe('A')
  // The newer schema's table is tolerated leftover (additive-only), not a failure.
  expect(userTables(db)).toContain('schema_sync_probe')
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
})

// FULL_DDL must actually execute on the engine and build a complete, consistent
// schema (Risk 2 cause 2 / Risk 5 cause 4 / T24). The dialect lint (T3) only
// scans the SQL strings; this proves they RUN and produce the expected shape.
describe('T24: FULL_DDL executes fully and builds a consistent schema', () => {
  const expected = [
    'admin', 'location_group', 'ticket', 'ticket_log', 'key_value',
    'print_record', 'menu', 'menu_item', 'menu_category', 'dining_table',
    'fulfillment', 'payment', 'guest', 'modifier', 'promotion',
    'session', 'location_group_feature',
  ]

  it('creates every expected table with no FK violations', async () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    await applyDdl(adapter(db), FULL_DDL)

    const tables = userTables(db)
    for (const t of expected) expect(tables).toContain(t)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('is idempotent: re-applying does not add or drop tables', async () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    await applyDdl(adapter(db), FULL_DDL)
    const first = userTables(db)
    await applyDdl(adapter(db), FULL_DDL)
    expect(userTables(db)).toEqual(first)
  })
})

// migrations helper: setSchemaUuid round-trips through key_value.
it('setSchemaUuid/getSchemaUuid round-trip', async () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  await applyDdl(adapter(db), FULL_DDL)
  await setSchemaUuid(adapter(db), 'zzz')
  expect(await getSchemaUuid(adapter(db))).toBe('zzz')
})
