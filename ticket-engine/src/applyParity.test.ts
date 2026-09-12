import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  applyDdl,
  seedGroupDatabase,
  applyLogsBatch,
  FULL_DDL,
  type DbAdapter,
} from './index.js'

// Shared corpus lives in the omni repo (single source of truth for T4 parity).
// From packages/ticket-engine/src/ the monorepo root is ../../../.
const monoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const corpus = JSON.parse(
  readFileSync(join(monoRoot, 'omni/data/schema/out/apply-parity-scenarios.json'), 'utf8'),
) as {
  scenarios: {
    name: string
    refs: Record<string, unknown[]>
    logs: {
      uuid: string
      ticket_uuid: string
      location_group_uuid: string
      admin_uuid: string
      action: string
      payload: Record<string, unknown>
      time_stamp: number
    }[]
    expect: {
      applied: number
      skipped: number
      errors: unknown[]
      tickets: Record<string, Record<string, unknown>>
    }
  }[]
}

function makeAdapter(db: DatabaseSync): DbAdapter {
  return {
    run(sql: string, params: unknown[] = []) {
      db.prepare(sql).run(...(params as any[]))
    },
    query(sql: string, params: unknown[] = []): any[] {
      return db.prepare(sql).all(...(params as any[])) as any[]
    },
  }
}

function all(db: DatabaseSync, sql: string, ...p: any[]): any[] {
  return db.prepare(sql).all(...p)
}

// Builds the exact shape `expect.tickets[uuid]` promises, keyed only by the
// fields the corpus asserts, so adding fields to either side stays explicit.
function serializeTicket(db: DatabaseSync, ticketUuid: string, wanted: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  if ('status' in wanted || 'table_uuid' in wanted || 'fulfillment_uuid' in wanted || 'guest_uuid' in wanted) {
    const t = db.prepare('SELECT status, table_uuid, fulfillment_uuid, guest_uuid FROM ticket WHERE uuid = ?').get(ticketUuid) as any
    if ('status' in wanted) out.status = t.status
    if ('table_uuid' in wanted) out.table_uuid = t.table_uuid
    if ('fulfillment_uuid' in wanted) out.fulfillment_uuid = t.fulfillment_uuid
    if ('guest_uuid' in wanted) out.guest_uuid = t.guest_uuid
  }

  if ('items' in wanted) {
    out.items = all(db, 'SELECT menu_item_uuid FROM ticket_menu_item WHERE ticket_uuid = ? ORDER BY uuid', ticketUuid).map((r) => r.menu_item_uuid)
  }

  if ('modifiers' in wanted) {
    out.modifiers = all(db, 'SELECT modifier_uuid, ticket_menu_item_uuid FROM ticket_menu_item_modifier WHERE ticket_uuid = ? ORDER BY uuid', ticketUuid).map((r) => ({
      modifier_uuid: r.modifier_uuid,
      ticket_menu_item_uuid: r.ticket_menu_item_uuid,
    }))
  }

  if ('promotions' in wanted) {
    out.promotions = all(db, 'SELECT promotion_uuid FROM ticket_promotion WHERE ticket_uuid = ? ORDER BY uuid', ticketUuid).map((r) => r.promotion_uuid)
  }

  if ('payments' in wanted) {
    out.payments = all(db, 'SELECT payment_uuid FROM ticket_payment WHERE ticket_uuid = ? ORDER BY uuid', ticketUuid).map((r) => r.payment_uuid)
  }

  return out
}

describe('T4 parity corpus → TS engine on real SQLite', () => {
  let db: DatabaseSync

  beforeEach(async () => {
    db = new DatabaseSync(":memory:")
    db.exec("PRAGMA foreign_keys = ON")
    await applyDdl(makeAdapter(db), FULL_DDL)
  })

  afterEach(() => db.close())

  for (const scenario of corpus.scenarios) {
    it(`TS matches corpus "expect" for ${scenario.name}`, () => {
      seedGroupDatabase(makeAdapter(db), scenario.refs as any)

      const res = applyLogsBatch(makeAdapter(db), scenario.logs as any)

      expect(res.applied).toBe(scenario.expect.applied)
      expect(res.skipped).toBe(scenario.expect.skipped)
      expect(res.errors).toEqual(scenario.expect.errors)

      for (const [ticketUuid, wanted] of Object.entries(scenario.expect.tickets)) {
        expect(serializeTicket(db, ticketUuid, wanted)).toEqual(wanted)
      }
    })
  }
})