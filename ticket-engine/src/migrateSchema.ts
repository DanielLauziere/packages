import { FULL_DDL, SCHEMA_VERSION } from './generatedSchema.js'
import type { DbAdapter } from './dbAdapter.js'

// getSchemaVersion reads the persisted schema version from key_value.
export function getSchemaVersion(db: DbAdapter): number {
  try {
    const rows = db.query(`SELECT value FROM key_value WHERE key = 'schemaVersion' LIMIT 1`)
    const raw = rows?.[0]?.value
    if (raw === undefined || raw === null) return 0
    return parseInt(String(raw), 10) || 0
  } catch {
    return 0
  }
}

export function setSchemaVersion(db: DbAdapter, version: number): void {
  db.run(`INSERT OR REPLACE INTO key_value (key, value) VALUES (?, ?)`, ['schemaVersion', String(version)])
}

// applyFullDdl applies the bundled union FULL_DDL idempotently (IF NOT EXISTS).
export function applyFullDdl(db: DbAdapter): void {
  for (const stmt of splitStatements(FULL_DDL)) {
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

// migrateSchema applies the bundled baseline, then reconciles the persisted
// schema version. Returns needsReseed=true when the stored version lags the
// bundled baseline (the wrapper must wipe + re-seed from the snapshot).
export function migrateSchema(db: DbAdapter): MigrateResult {
  const stored = getSchemaVersion(db)
  applyFullDdl(db)

  if (stored >= SCHEMA_VERSION) return { needsReseed: false }

  setSchemaVersion(db, SCHEMA_VERSION)
  return { needsReseed: true }
}
