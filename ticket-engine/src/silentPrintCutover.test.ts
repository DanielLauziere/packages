// silent_print cutover pin: the setting lives ONLY on `location_group` (one
// switch per restaurant, settable by any admin). The legacy per-admin
// `admin.silent_print` param is gone from the descriptor — no client may read
// or write it (full cutover, no legacy logic). Guards the shared schema every
// client boots against (generatedSchema ← omni/data/schema/baseline.sql).
import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import {
  FULL_DDL,
  SEED_COLUMNS,
  applyDdl,
  bundledDescriptor,
  reconcileSchema,
  setSchemaUuid,
} from './index.js'
import { TABLES } from './schema.js'

function adapter(db: DatabaseSync) {
  return {
    run: async (s: string, p: unknown[] = []) => db.prepare(s).run(...(p as any)),
    query: async (s: string, p: unknown[] = []) => db.prepare(s).all(...(p as any)),
  }
}

function columnsOf(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info("${table}")`).all() as any[]).map((r) => r.name)
}

function tableColumnNames(table: string): string[] {
  const t = TABLES.find((x) => x.name === table)
  if (!t) throw new Error(`TABLES has no table "${table}"`)
  return t.columns.map((c) => c.name)
}

// Slice one CREATE TABLE statement out of FULL_DDL, bounded by the next
// table's CREATE so FK REFERENCES elsewhere in the script can't bleed in.
function ddlBlock(table: string, nextTable: string): string {
  const start = FULL_DDL.search(
    new RegExp(`CREATE TABLE IF NOT EXISTS "${table}" \\(`),
  )
  const end = FULL_DDL.indexOf(`CREATE TABLE IF NOT EXISTS "${nextTable}"`)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`could not slice "${table}" out of FULL_DDL`)
  }
  return FULL_DDL.slice(start, end)
}

describe('silent_print lives on location_group only', () => {
  it('TABLES metadata: admin has no silent_print, location_group owns it', () => {
    expect(tableColumnNames('admin')).not.toContain('silent_print')
    expect(tableColumnNames('location_group')).toContain('silent_print')
  })

  it('FULL_DDL: the shipped DDL matches the metadata split', () => {
    const adminDdl = ddlBlock('admin', 'admin_location')
    expect(adminDdl).not.toContain('silent_print')

    const lgDdl = ddlBlock('location_group', 'location_group_balance_history')
    expect(lgDdl).toContain('"silent_print" INTEGER DEFAULT 0 NOT NULL')
  })

  it('bundledDescriptor (what both clients reconcile) carries the LG column and no admin column', () => {
    const admin = bundledDescriptor.tables.find((t) => t.name === 'admin')
    const lg = bundledDescriptor.tables.find((t) => t.name === 'location_group')
    expect(admin?.columns.map((c) => c.name)).not.toContain('silent_print')
    const col = lg?.columns.find((c) => c.name === 'silent_print')
    expect(col).toMatchObject({ type: 'INTEGER', nullable: false })
  })

  it('SEED_COLUMNS: seeds may write the LG column, never the admin one', () => {
    expect(Object.keys(SEED_COLUMNS['admin'] ?? {})).not.toContain('silent_print')
    expect(Object.keys(SEED_COLUMNS['location_group'] ?? {})).toContain('silent_print')
  })
})

describe('legacy device reconcile (full cutover, no legacy column logic)', () => {
  it('adds location_group.silent_print, reports the dropped admin column as cruft, and converges', async () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    await applyDdl(adapter(db), FULL_DDL)

    // Recreate the pre-cutover local shape: admin.silent_print present,
    // location_group.silent_print absent, under an older schema uuid.
    db.exec(`ALTER TABLE "admin" ADD COLUMN "silent_print" INTEGER DEFAULT 0 NOT NULL`)
    db.exec(`ALTER TABLE "location_group" DROP COLUMN "silent_print"`)
    await setSchemaUuid(adapter(db), 'pre-cutover-schema-uuid')

    const res = await reconcileSchema(adapter(db), bundledDescriptor)

    expect(res.outcome).toBe('OK')
    // The setting's new home is added in place.
    expect(res.addedColumns).toContainEqual({
      table: 'location_group',
      column: 'silent_print',
    })
    // The dropped admin column is tolerated cruft — reported, never dropped
    // in place (additions-only reconcile) — and no code reads it anymore.
    expect(res.cruftColumns).toContainEqual({ table: 'admin', column: 'silent_print' })

    expect(columnsOf(db, 'location_group')).toContain('silent_print')

    // The uuid advanced: the next boot is a no-op.
    const again = await reconcileSchema(adapter(db), bundledDescriptor)
    expect(again.outcome).toBe('IN_SYNC')
  })
})
