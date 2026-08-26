import type { DbAdapter } from './dbAdapter.js'

// SchemaDescriptor is the server-served schema identity (CORE-LOGIC-SCHEMA-SYNC.md
// §8/§3.2): a content-derived uuid plus the full SQLite DDL. Clients fetch it
// from /v1/schema/snapshot and apply/migrate against it — nothing is bundled.
export interface SchemaDescriptor {
  schemaUuid: string
  fullDdl: string
}

// getSchemaUuid reads the persisted applied schema uuid from key_value.
export function getSchemaUuid(db: DbAdapter): string {
  try {
    const rows = db.query(`SELECT value FROM key_value WHERE key = 'schema_uuid' LIMIT 1`)
    const raw = rows?.[0]?.value
    if (raw === undefined || raw === null) return ''
    return String(raw)
  } catch {
    return ''
  }
}

export function setSchemaUuid(db: DbAdapter, uuid: string): void {
  db.run(`INSERT OR REPLACE INTO key_value (key, value) VALUES (?, ?)`, ['schema_uuid', uuid])
}

// applyDdl applies SQLite DDL idempotently (IF NOT EXISTS). DDL comes from the
// server descriptor, not from a bundled constant.
export function applyDdl(db: DbAdapter, ddl: string): void {
  for (const stmt of splitStatements(ddl)) {
    try {
      db.run(stmt)
    } catch {
      // idempotent DDL; ignore duplicate-object errors
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
export function dropAllTables(db: DbAdapter, protectedTables: string[]): void {
  const rows = db.query(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  )
  const protectedSet = new Set(protectedTables)
  try {
    db.run('PRAGMA foreign_keys = OFF')
    for (const row of rows) {
      const name = row.name as string
      if (protectedSet.has(name)) continue
      db.run(`DROP TABLE IF EXISTS "${name}"`)
    }
  } finally {
    db.run('PRAGMA foreign_keys = ON')
  }
}

export interface MigrateResult {
  needsReseed: boolean
}

// migrateSchema applies the server-supplied descriptor DDL and reconciles the
// persisted uuid. Returns needsReseed=true when the stored uuid differs — the
// wrapper is responsible for wiping + re-seeding from the snapshot. uuid is
// persisted here only so a fully-applied schema becomes a no-op on next boot.
export function migrateSchema(db: DbAdapter, descriptor: SchemaDescriptor): MigrateResult {
  const stored = getSchemaUuid(db)
  applyDdl(db, descriptor.fullDdl)

  if (stored === descriptor.schemaUuid) return { needsReseed: false }

  setSchemaUuid(db, descriptor.schemaUuid)
  return { needsReseed: true }
}