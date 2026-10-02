import type { DbAdapter } from './dbAdapter.js'
import { applyDdl, getSchemaUuid, setSchemaUuid } from './migrateSchema.js'

// reconcileSchema is the non-destructive schema-sync primitive
// (CORE-LOGIC-SCHEMA-SYNC.md, "additions only, forever").
//
// On a schemaUuid mismatch it reconciles the local SQLite schema toward the
// server descriptor WITHOUT destroying data, and demotes the historical
// wipe+reseed to a caller-side recovery path. The outcome contract:
//
//   IN_SYNC           stored uuid already equals the descriptor — nothing ran.
//   OK                additive reconcile applied (full_ddl replay for missing
//                     tables/indexes + ALTER ADD COLUMN for missing columns)
//                     and the descriptor uuid persisted once the DDL phases
//                     succeeded. Existing rows are never touched.
//   REBUILD_REQUIRED  the descriptor needs something that cannot be added
//                     (SQLite rejects the ALTER), or the local schema could not
//                     be introspected. Known-illegal shapes are detected in
//                     the plan phase BEFORE any write; a shape SQLite only
//                     rejects at execution time is rolled back with its
//                     transaction. The uuid is never advanced. The caller
//                     drains pending logs, then wipes + reseeds + persists the
//                     uuid itself — this is the ONLY path allowed to destroy
//                     data, reached only via incompatible shapes.
//   BAD_DESCRIPTOR    the descriptor itself is unusable (missing fields, or
//                     full_ddl failed to execute). The full_ddl transaction
//                     rolled back — nothing was written. The caller must FAIL
//                     the boot to RECOVER — never destroy local data on
//                     suspicion of a bad payload.
//
// Columns/tables present locally but absent from the descriptor are tolerated
// cruft and reported (never dropped): the device keeps working, and a later
// reseed/convergence pass owns their data. This is what makes a uuid mismatch
// survivable in place — the wipe fallback is for incompatible shapes only.

export interface ReconcileColumn {
  name: string
  type: string
  nullable: boolean
  default?: string
}

export interface ReconcileTable {
  name: string
  columns: ReconcileColumn[]
}

// ReconcileDescriptor is the server snapshot (schema.json) as served by
// /v1/schema/snapshot: schema_uuid + full_ddl + tables[] (with column
// defaults, so the diff can build legal ALTERs).
export interface ReconcileDescriptor {
  schemaUuid: string
  fullDdl: string
  tables: ReconcileTable[]
}

export type ReconcileOutcome = 'IN_SYNC' | 'OK' | 'REBUILD_REQUIRED' | 'BAD_DESCRIPTOR'

export interface ReconcileResult {
  outcome: ReconcileOutcome
  reason?: string
  addedTables: string[]
  addedColumns: Array<{ table: string; column: string }>
  cruftTables: string[]
  cruftColumns: Array<{ table: string; column: string }>
}

function emptyResult(outcome: ReconcileOutcome, reason?: string): ReconcileResult {
  return { outcome, reason, addedTables: [], addedColumns: [], cruftTables: [], cruftColumns: [] }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function quoteIdent(name: string): string {
  return `"${name}"`
}

// buildAddColumnStatement emits SQLite's ALTER TABLE ... ADD COLUMN. SQLite
// only accepts a CONSTANT default here (no CURRENT_TIMESTAMP, no parenthesized
// expression) and no NOT NULL without a default. addColumnRejection returns the
// reason for a shape SQLite is GUARANTEED to reject — those are detected in the
// plan phase so nothing is ever written for them. Anything else SQLite rejects
// at execution time still lands on REBUILD_REQUIRED via its rolled-back
// transaction; we deliberately do not re-implement SQLite's full legality rules.
function addColumnRejection(col: ReconcileColumn): string | null {
  if (!col.nullable && !col.default) {
    return `ADD COLUMN ${col.name}: NOT NULL without a DEFAULT is not addable to an existing table`
  }
  if (col.default && col.default.includes('(')) {
    return `ADD COLUMN ${col.name}: parenthesized expression DEFAULT (${col.default}) is not addable to an existing table`
  }
  if (col.default && /CURRENT_(TIME|DATE|DATETIME)/i.test(col.default)) {
    return `ADD COLUMN ${col.name}: non-constant DEFAULT ${col.default} is not addable to an existing table`
  }
  return null
}

function buildAddColumnStatement(table: string, col: ReconcileColumn): string {
  const parts = [`ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${quoteIdent(col.name)} ${col.type}`]
  if (!col.nullable) parts.push('NOT NULL')
  if (col.default) parts.push(`DEFAULT ${col.default}`)
  return parts.join(' ')
}

function isDescriptorShaped(descriptor: ReconcileDescriptor): boolean {
  if (!descriptor) return false
  if (!descriptor.schemaUuid || !descriptor.fullDdl) return false
  if (!Array.isArray(descriptor.tables) || descriptor.tables.length === 0) return false
  return descriptor.tables.every(
    (t) => t && typeof t.name === 'string' && t.name.length > 0 && Array.isArray(t.columns),
  )
}

// reconcileSchema runs the three-way branch described above. It applies the
// reconcile in PHASED transactions — full_ddl first, then ALTERs + uuid
// persist — because both production adapters (RN quick-sqlite, web sql.js /
// Tauri) buffer engine BEGIN…COMMIT and surface SQL errors only at COMMIT
// time. Keeping each phase in its own transaction means a failure is always
// classified by the phase whose COMMIT is in flight:
//
//   tx A  BEGIN → full_ddl replay → COMMIT              fail → BAD_DESCRIPTOR
//   tx B  BEGIN → ALTERs → persist uuid → COMMIT        fail → REBUILD_REQUIRED
//
// Phases are independently idempotent: a crash between them leaves the uuid
// stale, so the next reconcile simply re-runs (CREATE IF NOT EXISTS + a
// re-diffed ALTER plan) and converges. Callers must NOT already be inside a
// transaction.
export async function reconcileSchema(
  db: DbAdapter,
  descriptor: ReconcileDescriptor,
): Promise<ReconcileResult> {
  // Phase 0: descriptor sanity. A structurally broken payload is never allowed
  // to reach the write path.
  if (!isDescriptorShaped(descriptor)) {
    return emptyResult('BAD_DESCRIPTOR', 'descriptor missing schema_uuid, full_ddl, or tables[]')
  }

  // Phase 1: fast path — stored uuid already matches (idempotent replay).
  const stored = await getSchemaUuid(db)
  if (stored === descriptor.schemaUuid) {
    return emptyResult('IN_SYNC')
  }

  // Phase 2: introspect the local schema (read-only). A local failure here
  // means the device DB itself is unhealthy → the rebuild path recovers it.
  let localTables: Set<string>
  const localColumns = new Map<string, Set<string>>()
  try {
    const rows = await db.query(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    )
    localTables = new Set(rows.map((r) => String(r.name)))
    for (const t of descriptor.tables) {
      if (!localTables.has(t.name)) continue
      const info = await db.query(`PRAGMA table_info(${quoteIdent(t.name)})`)
      localColumns.set(
        t.name,
        new Set(info.map((r) => String((r as { name?: unknown }).name))),
      )
    }
  } catch (err) {
    return emptyResult('REBUILD_REQUIRED', `local schema introspection failed: ${errorText(err)}`)
  }

  // Phase 3: plan (read-only). Missing tables come from the full_ddl replay;
  // missing columns on existing tables become ALTERs. Local-only tables and
  // columns are tolerated cruft — reported, never dropped.
  const addedTables: string[] = []
  const addedColumns: Array<{ table: string; column: string }> = []
  const alterStatements: string[] = []
  for (const t of descriptor.tables) {
    const have = localColumns.get(t.name)
    if (!have) {
      addedTables.push(t.name)
      continue
    }
    for (const c of t.columns) {
      if (have.has(c.name)) continue
      const rejection = addColumnRejection(c)
      if (rejection) {
        return emptyResult('REBUILD_REQUIRED', rejection)
      }
      addedColumns.push({ table: t.name, column: c.name })
      alterStatements.push(buildAddColumnStatement(t.name, c))
    }
  }

  const descriptorTableSet = new Set(descriptor.tables.map((t) => t.name))
  const cruftTables = [...localTables].filter((n) => !descriptorTableSet.has(n)).sort()
  const cruftColumns: Array<{ table: string; column: string }> = []
  for (const t of descriptor.tables) {
    const have = localColumns.get(t.name)
    if (!have) continue
    const want = new Set(t.columns.map((c) => c.name))
    for (const localCol of have) {
      if (!want.has(localCol)) cruftColumns.push({ table: t.name, column: localCol })
    }
  }

  // Phase 4a: replay full_ddl (creates missing tables/indexes, no-ops the
  // rest). A failure here means the server's own DDL could not run — suspect
  // the payload, never destroy the device's data on suspicion of bad DDL.
  try {
    await db.run('BEGIN')
    await applyDdl(db, descriptor.fullDdl)
    await db.run('COMMIT')
  } catch (err) {
    try {
      await db.run('ROLLBACK')
    } catch {
      // the batch already unwound itself (buffering adapters discard on error)
    }
    return emptyResult('BAD_DESCRIPTOR', `full_ddl failed: ${errorText(err)}`)
  }

  // Phase 4b: apply the column additions and persist the descriptor uuid in
  // one transaction, so a rejected ALTER never advances the stored identity.
  if (alterStatements.length > 0) {
    try {
      await db.run('BEGIN')
      for (const stmt of alterStatements) {
        await db.run(stmt)
      }
      await setSchemaUuid(db, descriptor.schemaUuid)
      await db.run('COMMIT')
    } catch (err) {
      try {
        await db.run('ROLLBACK')
      } catch {
        // the batch already unwound itself
      }
      return emptyResult('REBUILD_REQUIRED', `column reconcile failed: ${errorText(err)}`)
    }
    return { outcome: 'OK', addedTables, addedColumns, cruftTables, cruftColumns }
  }

  // No column additions needed — just advance the stored uuid.
  try {
    await setSchemaUuid(db, descriptor.schemaUuid)
  } catch (err) {
    return emptyResult('REBUILD_REQUIRED', `persisting schema uuid failed: ${errorText(err)}`)
  }
  return { outcome: 'OK', addedTables, addedColumns, cruftTables, cruftColumns }
}
