import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyDdl, getSchemaUuid, reconcileSchema, setSchemaUuid, type ReconcileDescriptor } from './index.js'

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

function columnsOf(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info("${table}")`).all() as any[]).map((r) => r.name)
}

// ---- fixtures: an old schema and its additive successor -------------------
// v2 only ADDS: alpha gains a NOT NULL + constant-default column, beta gains a
// nullable column, and a brand-new table appears. Nothing is dropped, renamed,
// or retyped — the "additions only, forever" contract the operator enforces.

const ALPHA_BETA = `CREATE TABLE IF NOT EXISTS "alpha" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "legacy" TEXT
);
CREATE TABLE IF NOT EXISTS "beta" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "alpha_uuid" TEXT NOT NULL,
    FOREIGN KEY ("alpha_uuid") REFERENCES "alpha" ("uuid")
);
CREATE INDEX IF NOT EXISTS "idx_beta_alpha_uuid" ON "beta" ("alpha_uuid");
CREATE TABLE IF NOT EXISTS "key_value" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);`

const KEY_VALUE_TABLE: ReconcileDescriptor['tables'][number] = {
  name: 'key_value',
  columns: [
    { name: 'key', type: 'TEXT', nullable: false },
    { name: 'value', type: 'TEXT', nullable: false },
  ],
}

const V1: ReconcileDescriptor = {
  schemaUuid: 'uuid-v1',
  fullDdl: ALPHA_BETA,
  tables: [
    {
      name: 'alpha',
      columns: [
        { name: 'uuid', type: 'TEXT', nullable: false },
        { name: 'name', type: 'TEXT', nullable: false },
        { name: 'legacy', type: 'TEXT', nullable: true },
      ],
    },
    {
      name: 'beta',
      columns: [
        { name: 'uuid', type: 'TEXT', nullable: false },
        { name: 'alpha_uuid', type: 'TEXT', nullable: false },
      ],
    },
    KEY_VALUE_TABLE,
  ],
}

const V2_DDL = `CREATE TABLE IF NOT EXISTS "alpha" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "legacy" TEXT,
    "note" TEXT NOT NULL DEFAULT 'hi'
);
CREATE TABLE IF NOT EXISTS "beta" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "alpha_uuid" TEXT NOT NULL,
    "color" TEXT,
    FOREIGN KEY ("alpha_uuid") REFERENCES "alpha" ("uuid")
);
CREATE INDEX IF NOT EXISTS "idx_beta_alpha_uuid" ON "beta" ("alpha_uuid");
CREATE TABLE IF NOT EXISTS "gamma" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT
);
CREATE TABLE IF NOT EXISTS "key_value" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);`

const V2: ReconcileDescriptor = {
  schemaUuid: 'uuid-v2',
  fullDdl: V2_DDL,
  tables: [
    {
      name: 'alpha',
      columns: [
        { name: 'uuid', type: 'TEXT', nullable: false },
        { name: 'name', type: 'TEXT', nullable: false },
        { name: 'legacy', type: 'TEXT', nullable: true },
        { name: 'note', type: 'TEXT', nullable: false, default: "'hi'" },
      ],
    },
    {
      name: 'beta',
      columns: [
        { name: 'uuid', type: 'TEXT', nullable: false },
        { name: 'alpha_uuid', type: 'TEXT', nullable: false },
        { name: 'color', type: 'TEXT', nullable: true },
      ],
    },
    {
      name: 'gamma',
      columns: [
        { name: 'uuid', type: 'TEXT', nullable: false },
        { name: 'label', type: 'TEXT', nullable: true },
      ],
    },
    KEY_VALUE_TABLE,
  ],
}

async function freshV1(): Promise<DatabaseSync> {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  await applyDdl(adapter(db), V1.fullDdl)
  db.prepare(`INSERT INTO alpha (uuid, name, legacy) VALUES (?, ?, ?)`).run('a1', 'one', 'keep')
  db.prepare(`INSERT INTO beta (uuid, alpha_uuid) VALUES (?, ?)`).run('b1', 'a1')
  await setSchemaUuid(adapter(db), 'uuid-v1')
  return db
}

describe('reconcileSchema (additions only)', () => {
  it('IN_SYNC: stored uuid equal to the descriptor is a no-op', async () => {
    const db = await freshV1()
    const result = await reconcileSchema(adapter(db), V1)
    expect(result.outcome).toBe('IN_SYNC')
    expect(await getSchemaUuid(adapter(db))).toBe('uuid-v1')
  })

  it('OK: adds tables and columns in place — rows survive, defaults land, uuid persists', async () => {
    const db = await freshV1()
    const result = await reconcileSchema(adapter(db), V2)

    expect(result.outcome).toBe('OK')
    expect(result.addedTables).toEqual(['gamma'])
    expect(result.addedColumns).toEqual([
      { table: 'alpha', column: 'note' },
      { table: 'beta', column: 'color' },
    ])
    expect(result.cruftTables).toEqual([])
    expect(result.cruftColumns).toEqual([])

    // existing rows untouched, new columns filled per their default/null-ness
    const alpha = db.prepare(`SELECT * FROM alpha WHERE uuid = 'a1'`).get() as any
    expect(alpha).toEqual({ uuid: 'a1', name: 'one', legacy: 'keep', note: 'hi' })
    const beta = db.prepare(`SELECT * FROM beta WHERE uuid = 'b1'`).get() as any
    expect(beta.color).toBeNull()

    // brand-new table exists
    expect(userTables(db)).toContain('gamma')
    expect(columnsOf(db, 'gamma').sort()).toEqual(['label', 'uuid'])

    // uuid persisted atomically with the DDL — a second pass is IN_SYNC
    expect(await getSchemaUuid(adapter(db))).toBe('uuid-v2')
    expect((await reconcileSchema(adapter(db), V2)).outcome).toBe('IN_SYNC')
  })

  it('OK: local-only tables and columns are tolerated cruft, never dropped', async () => {
    const db = await freshV1()
    db.exec(`CREATE TABLE "leftover_local" ("id" INTEGER PRIMARY KEY)`)
    db.exec(`INSERT INTO "leftover_local" (id) VALUES (7)`)
    db.exec(`ALTER TABLE "alpha" ADD COLUMN "extra_col" TEXT`)

    const result = await reconcileSchema(adapter(db), V2)

    expect(result.outcome).toBe('OK')
    expect(result.cruftTables).toEqual(['leftover_local'])
    expect(result.cruftColumns).toEqual([{ table: 'alpha', column: 'extra_col' }])
    // cruft intact
    expect((db.prepare(`SELECT id FROM leftover_local`).get() as any).id).toBe(7)
    expect(columnsOf(db, 'alpha')).toContain('extra_col')
    expect(await getSchemaUuid(adapter(db))).toBe('uuid-v2')
  })

  it('REBUILD_REQUIRED: ADD COLUMN NOT NULL without default is rejected — nothing written, uuid unchanged', async () => {
    const db = await freshV1()
    const bad: ReconcileDescriptor = {
      schemaUuid: 'uuid-bad',
      fullDdl: ALPHA_BETA + `\nCREATE TABLE IF NOT EXISTS "nu" ("x" INTEGER);`,
      tables: [
        {
          ...V1.tables[0],
          columns: [...V1.tables[0].columns, { name: 'force', type: 'TEXT', nullable: false }],
        },
        V1.tables[1],
        { name: 'nu', columns: [{ name: 'x', type: 'INTEGER', nullable: true }] },
      ],
    }

    const result = await reconcileSchema(adapter(db), bad)
    expect(result.outcome).toBe('REBUILD_REQUIRED')
    expect(result.reason).toMatch(/NOT NULL/i)

    // fully rolled back: no column, no new table, uuid still v1
    expect(columnsOf(db, 'alpha')).not.toContain('force')
    expect(userTables(db)).not.toContain('nu')
    expect(await getSchemaUuid(adapter(db))).toBe('uuid-v1')
  })

  it('REBUILD_REQUIRED: non-constant DEFAULT (CURRENT_TIMESTAMP) is rejected by SQLite — nothing written', async () => {
    const db = await freshV1()
    const bad: ReconcileDescriptor = {
      schemaUuid: 'uuid-bad',
      fullDdl: ALPHA_BETA,
      tables: [
        {
          ...V1.tables[0],
          columns: [...V1.tables[0].columns, { name: 'ts', type: 'TEXT', nullable: true, default: 'CURRENT_TIMESTAMP' }],
        },
        V1.tables[1],
      ],
    }

    const result = await reconcileSchema(adapter(db), bad)
    expect(result.outcome).toBe('REBUILD_REQUIRED')
    expect(columnsOf(db, 'alpha')).not.toContain('ts')
    expect(await getSchemaUuid(adapter(db))).toBe('uuid-v1')
  })

  it('BAD_DESCRIPTOR: failing full_ddl rolls back every statement and never destroys data', async () => {
    const db = await freshV1()
    const broken: ReconcileDescriptor = {
      schemaUuid: 'uuid-broken',
      // first statement is valid (would create a table), second is garbage —
      // the whole tx must roll back, including the valid CREATE.
      fullDdl: `CREATE TABLE IF NOT EXISTS "partial" ("x" INTEGER);\nBROKEN SQL IS NOT VALID;`,
      tables: [
        ...V1.tables,
        { name: 'partial', columns: [{ name: 'x', type: 'INTEGER', nullable: true }] },
      ],
    }

    const result = await reconcileSchema(adapter(db), broken)
    expect(result.outcome).toBe('BAD_DESCRIPTOR')
    expect(result.reason).toMatch(/full_ddl failed/i)

    expect(userTables(db)).not.toContain('partial')
    expect((db.prepare(`SELECT COUNT(*) c FROM alpha`).get() as any).c).toBe(1)
    expect(await getSchemaUuid(adapter(db))).toBe('uuid-v1')
  })

  it('BAD_DESCRIPTOR: structurally broken payloads never reach the write path', async () => {
    const db = await freshV1()
    const noTables = { schemaUuid: 'x', fullDdl: ALPHA_BETA } as ReconcileDescriptor
    const noDdl = { schemaUuid: 'x', fullDdl: '', tables: V1.tables } as ReconcileDescriptor

    expect((await reconcileSchema(adapter(db), noTables)).outcome).toBe('BAD_DESCRIPTOR')
    expect((await reconcileSchema(adapter(db), noDdl)).outcome).toBe('BAD_DESCRIPTOR')
    expect(await getSchemaUuid(adapter(db))).toBe('uuid-v1')
    expect(userTables(db)).toEqual(['alpha', 'beta', 'key_value'])
  })
})
