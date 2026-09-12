import type { DbAdapter } from './dbAdapter.js'

// SchemaDescriptor is the server-served schema identity (CORE-LOGIC-SCHEMA-SYNC.md
// §8/§3.2): a content-derived uuid plus the full SQLite DDL. Clients fetch it
// from /v1/schema/snapshot and apply/migrate against it — nothing is bundled.
export interface SchemaDescriptor {
  schemaUuid: string
  fullDdl: string
}

// getSchemaUuid reads the persisted applied schema uuid from key_value.
export async function getSchemaUuid(db: DbAdapter): Promise<string> {
  try {
    const rows = await db.query(`SELECT value FROM key_value WHERE key = 'schema_uuid' LIMIT 1`)
    const raw = rows?.[0]?.value
    if (raw === undefined || raw === null) return ''
    return String(raw)
  } catch {
    return ''
  }
}

export async function setSchemaUuid(db: DbAdapter, uuid: string): Promise<void> {
  await db.run(`INSERT OR REPLACE INTO key_value (key, value) VALUES (?, ?)`, ['schema_uuid', uuid])
}

// applyDdl applies SQLite DDL idempotently (IF NOT EXISTS). DDL comes from the
// server descriptor, not from a bundled constant.
//
// Errors are NOT silently swallowed. A malformed or unsupported statement must
// surface so a buggy descriptor fails loudly on the first device (a partial
// schema would otherwise let the reseed fail FK and loop every device to
// RECOVER). Only genuine "already exists" errors are ignored — those are the
// expected result of idempotent `CREATE ... IF NOT EXISTS` replay against a
// schema that already has the object. (Schema-sync brick guard, T21.)
export async function applyDdl(db: DbAdapter, ddl: string): Promise<void> {
  for (const stmt of splitStatements(ddl)) {
    try {
      await db.run(stmt)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!/already exists/i.test(msg)) {
        throw err
      }
    }
  }
}

// splitStatements splits a SQL script on ';' boundaries, dropping empty
// fragments. Used because some DB drivers reject multi-statement scripts.
export function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

// dropAllTables drops every user table except the protected ones. The engine
// has no table enumeration API, so callers must pass the protected set; the
// client adapter provides the table list.
export async function dropAllTables(db: DbAdapter, protectedTables: string[]): Promise<void> {
  const rows = await db.query(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  )
  const protectedSet = new Set(protectedTables)
  try {
    await db.run('PRAGMA foreign_keys = OFF')
    for (const row of rows) {
      const name = row.name as string
      if (protectedSet.has(name)) continue
      await db.run(`DROP TABLE IF EXISTS "${name}"`)
    }
  } finally {
    await db.run('PRAGMA foreign_keys = ON')
  }
}

export interface MigrateResult {
  needsReseed: boolean
}

// migrateSchema applies the server-supplied descriptor DDL and reconciles the
// persisted uuid. Returns needsReseed=true when the stored uuid differs — the
// wrapper is responsible for wiping + re-seeding from the snapshot. uuid is
// persisted here only so a fully-applied schema becomes a no-op on next boot.
export async function migrateSchema(db: DbAdapter, descriptor: SchemaDescriptor): Promise<MigrateResult> {
  const stored = await getSchemaUuid(db)
  await applyDdl(db, descriptor.fullDdl)

  if (stored === descriptor.schemaUuid) return { needsReseed: false }

  await setSchemaUuid(db, descriptor.schemaUuid)
  return { needsReseed: true }
}
