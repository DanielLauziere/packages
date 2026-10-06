// F3 golden offline flows + corpus replay per fixture —
// LOCAL-MIGRATION-AND-SEED.md §F.3.
//
// Every eligible customer fixture must take a full offline session from
// empty DB → seat → item → modifier → promotion → payment → paid → print
// baton actions → a well-formed sync-buckets upload, all against the REAL
// prod rows in the bundle (real menu prices, real payment methods, real
// printers). Then the shared apply corpus replays against every fixture DB
// proving synthetic scenarios behave identically on top of real customer data
// (no cross-LG bleed, no expectation drift).
import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  applyDdl,
  seedGroupDatabase,
  applyLogsBatch,
  buildBuckets,
  buildBucketHashes,
  bucketForTicket,
  chunkBucketsForUpload,
  fastHashUuid,
  FULL_DDL,
  SEED_ORDER,
  type DbAdapter,
  type TicketLogEntry,
} from './index.js'

const monoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const FIXTURES_DIR = join(monoRoot, 'omni', 'data', 'seed-fixtures')

type Manifest = {
  location_groups: Array<{
    uuid: string
    name: string
    file: string
    seed_version: number
    row_counts: Record<string, number>
  }>
}
type Fixture = Record<string, any>

const manifest = JSON.parse(readFileSync(join(FIXTURES_DIR, 'manifest.json'), 'utf8')) as Manifest
const corpus = JSON.parse(
  readFileSync(join(monoRoot, 'omni/data/schema/out/apply-parity-scenarios.json'), 'utf8'),
) as {
  scenarios: {
    name: string
    refs: Record<string, unknown[]>
    logs: TicketLogEntry[]
    expect: {
      applied: number
      skipped: number
      errors: unknown[]
      tickets: Record<string, Record<string, unknown>>
    }
  }[]
}

function loadFixture(file: string): Fixture {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8'))
}

function makeAdapter(db: DatabaseSync): DbAdapter {
  return {
    async run(sql: string, params: unknown[] = []) {
      db.prepare(sql).run(...(params as any[]))
    },
    async query(sql: string, params: unknown[] = []): Promise<any[]> {
      return db.prepare(sql).all(...(params as any[])) as any[]
    },
  }
}

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

const all = (db: DatabaseSync, sql: string, ...p: any[]): any[] => db.prepare(sql).all(...p)
const one = (db: DatabaseSync, sql: string, ...p: any[]): any => db.prepare(sql).get(...p)

// Finds a (menu_item, modifier) pair actually linked through
// menu_item_modifier_group → modifier_group_modifier in this fixture, so the
// golden flow exercises the real modifier graph. Prefers a priced item.
function pickItemWithModifier(fixture: Fixture): { item: any; modifier: any } | null {
  const byGroup = new Map<string, string[]>()
  for (const mgm of fixture.modifier_group_modifier ?? []) {
    const list = byGroup.get(mgm.modifier_group_uuid) ?? []
    list.push(mgm.modifier_uuid)
    byGroup.set(mgm.modifier_group_uuid, list)
  }
  const modifierByUuid = new Map((fixture.modifier ?? []).map((m: any) => [m.uuid, m]))
  const itemByUuid = new Map((fixture.menu_item ?? []).map((m: any) => [m.uuid, m]))

  const candidates: Array<{ item: any; modifier: any }> = []
  for (const mmg of fixture.menu_item_modifier_group ?? []) {
    const modifiers = byGroup.get(mmg.modifier_group_uuid) ?? []
    const item = itemByUuid.get(mmg.menu_item_uuid)
    if (!item || !modifiers.length) continue
    const modifier = modifierByUuid.get(modifiers[0])
    if (modifier) candidates.push({ item, modifier })
  }
  if (!candidates.length) return null
  return candidates.find((c) => c.item.price_whole > 0 || c.item.price_hundredths > 0) ?? candidates[0]
}

function pickPricedItem(fixture: Fixture): any | null {
  const items = fixture.menu_item ?? []
  return items.find((m: any) => m.price_whole > 0 || m.price_hundredths > 0) ?? items[0] ?? null
}

describe('F3 golden offline flow (per fixture, real prod rows)', () => {
  for (const g of manifest.location_groups) {
    const fixture = loadFixture(g.file)
    const hasAdmin = (g.row_counts.admin ?? 0) > 0
    const hasItems = (g.row_counts.menu_item ?? 0) > 0
    const eligible = hasAdmin && hasItems

    it.runIf(eligible)(`${g.name}: seat → item → pay → print → upload payload`, async () => {
      const db = freshDb()
      await applyDdl(makeAdapter(db), FULL_DDL)
      await seedGroupDatabase(makeAdapter(db), fixture as any, SEED_ORDER)

      const lg = fixture.location_group[0].uuid
      const admin = fixture.admin[0].uuid

      // Real rows from this customer's bundle.
      const withMod = pickItemWithModifier(fixture)
      const item = withMod?.item ?? pickPricedItem(fixture)
      const modifier = withMod?.modifier ?? null
      const promotion = fixture.promotion?.[0] ?? null
      const diningTable = fixture.dining_table?.[0] ?? null
      const paymentMethod = fixture.payment[0].uuid

      const ticketUuid = '7f3a9c21-0000-4000-8000-00000000f301'
      let ts = 1_700_000_000_000
      const logs: TicketLogEntry[] = []
      const log = (action: string, payload: Record<string, unknown>) => {
        logs.push({
          uuid: `7f3a9c21-0000-4000-8000-${String(logs.length).padStart(12, '0')}`,
          ticket_uuid: ticketUuid,
          location_group_uuid: lg,
          admin_uuid: admin,
          action,
          payload,
          time_stamp: (ts += 1000),
        })
      }

      if (diningTable) log('SET_TABLE', { table_uuid: diningTable.uuid })
      log('ADD_ITEM', { menu_item_uuid: item.uuid })
      const tmiUuid = logs[logs.length - 1]!.uuid // ADD_ITEM's log uuid becomes the ticket_menu_item uuid
      if (modifier) log('ADD_MODIFIER', { ticket_menu_item_uuid: tmiUuid, modifier_uuid: modifier.uuid })
      if (promotion) log('APPLY_PROMOTION', { promotion_uuid: promotion.uuid })
      const totalWhole = (item.price_whole ?? 0) + (modifier?.price_whole ?? 0)
      const totalHundredths = (item.price_hundredths ?? 0) + (modifier?.price_hundredths ?? 0)
      log('ADD_PAYMENT', { payment_uuid: paymentMethod, price_whole: totalWhole, price_hundredths: totalHundredths, complete: true })
      log('SET_STATUS_PAID', {})
      log('PRINT_REQUEST', {})
      log('PRINT_SUCCESS', {})

      const res = await applyLogsBatch(makeAdapter(db), logs)
      expect(res.errors).toEqual([])
      expect(res.applied).toBe(logs.length)
      expect(res.skipped).toBe(0)

      // Final ticket state — paid, seated, billed to the real admin/LG.
      const ticket = one(db, 'SELECT status, table_uuid, admin_uuid, location_group_uuid FROM ticket WHERE uuid = ?', ticketUuid)
      expect(ticket.status).toBe('PAID')
      expect(ticket.admin_uuid).toBe(admin)
      expect(ticket.location_group_uuid).toBe(lg)
      if (diningTable) expect(ticket.table_uuid).toBe(diningTable.uuid)

      // Child rows landed against real bundle data.
      expect(all(db, 'SELECT menu_item_uuid FROM ticket_menu_item WHERE ticket_uuid = ?', ticketUuid)).toEqual([
        { menu_item_uuid: item.uuid },
      ])
      expect(all(db, 'SELECT modifier_uuid FROM ticket_menu_item_modifier WHERE ticket_uuid = ?', ticketUuid)).toEqual(
        modifier ? [{ modifier_uuid: modifier.uuid }] : [],
      )
      expect(all(db, 'SELECT promotion_uuid FROM ticket_promotion WHERE ticket_uuid = ?', ticketUuid)).toEqual(
        promotion ? [{ promotion_uuid: promotion.uuid }] : [],
      )
      const payment = one(db, 'SELECT payment_uuid, price_whole, price_hundredths, complete FROM ticket_payment WHERE ticket_uuid = ?', ticketUuid)
      expect(payment).toEqual({
        payment_uuid: paymentMethod,
        price_whole: totalWhole,
        price_hundredths: totalHundredths,
        complete: 1,
      })

      // Every log claimed + applied (the upload-side bookkeeping).
      const appliedRows = all(db, 'SELECT uuid, time_stamp FROM ticket_log_applied WHERE uuid IN (' + logs.map(() => '?').join(',') + ')', ...logs.map((l) => l.uuid))
      expect(appliedRows.length).toBe(logs.length)
      for (const row of appliedRows) expect(row.time_stamp).not.toBeNull()

      // Print baton: this LG's printers are resolvable from the bundle
      // (claim needs a target); admin printer pointers resolve too.
      const printers = g.row_counts.location_group_printer ?? 0
      expect(all(db, 'SELECT uuid FROM location_group_printer WHERE location_group_uuid = ?', lg).length).toBe(printers)
      for (const a of fixture.admin) {
        for (const col of ['kitchen_location_group_printer_uuid', 'guest_location_group_printer_uuid']) {
          if (a[col]) {
            expect(one(db, 'SELECT uuid FROM location_group_printer WHERE uuid = ?', a[col]), `${col} ${a[col]}`).toBeTruthy()
          }
        }
      }

      // Upload payload shape: the applied logs bucket exactly as a sync
      // request would carry them — one bucket, all logs once, non-zero hash.
      const buckets = buildBuckets({ [ticketUuid]: logs })
      const expectedBucket = bucketForTicket(ticketUuid)
      expect(Object.keys(buckets)).toEqual([String(expectedBucket)])
      expect(buckets[expectedBucket]![ticketUuid]).toHaveLength(logs.length)

      const chunks = chunkBucketsForUpload(buckets)
      expect(chunks).toHaveLength(1)
      const uploaded = chunks[0]![expectedBucket]![ticketUuid]!
      expect(uploaded.map((l) => l.uuid).sort()).toEqual(logs.map((l) => l.uuid).sort())

      const hashes = buildBucketHashes(buckets)
      expect(hashes[expectedBucket]).not.toBe(0)
      expect(hashes[expectedBucket]).toBe(
        logs.reduce((h, l) => (h ^ fastHashUuid(l.uuid)) >>> 0, 0) || 1,
      )

      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      db.close()
    })
  }
})

describe('F3 apply corpus replayed against every fixture DB', () => {
  function serializeTicket(db: DatabaseSync, ticketUuid: string, wanted: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if ('status' in wanted || 'table_uuid' in wanted || 'fulfillment_uuid' in wanted || 'guest_uuid' in wanted) {
      const t = one(db, 'SELECT status, table_uuid, fulfillment_uuid, guest_uuid FROM ticket WHERE uuid = ?', ticketUuid)
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

  for (const g of manifest.location_groups) {
    const fixture = loadFixture(g.file)
    const fixtureLgCount = 1
    const fixtureItems = g.row_counts.menu_item ?? 0

    for (const scenario of corpus.scenarios) {
      it(`${g.name} × "${scenario.name}"`, async () => {
        const db = freshDb()
        await applyDdl(makeAdapter(db), FULL_DDL)
        // Real customer data first, then the scenario's synthetic refs on top.
        await seedGroupDatabase(makeAdapter(db), fixture as any, SEED_ORDER)
        await seedGroupDatabase(makeAdapter(db), scenario.refs as any)

        const res = await applyLogsBatch(makeAdapter(db), scenario.logs)
        expect(res.applied).toBe(scenario.expect.applied)
        expect(res.skipped).toBe(scenario.expect.skipped)
        expect(res.errors).toEqual(scenario.expect.errors)

        for (const [ticketUuid, wanted] of Object.entries(scenario.expect.tickets)) {
          expect(serializeTicket(db, ticketUuid, wanted)).toEqual(wanted)
        }

        // No cross-LG bleed: the fixture's own catalog is untouched by the
        // scenario (scenario rows only add), FK integrity holds after both
        // seeds and the apply.
        expect(one(db, 'SELECT COUNT(*) c FROM location_group').c).toBe(fixtureLgCount + 1)
        expect(one(db, 'SELECT COUNT(*) c FROM menu_item').c).toBe(fixtureItems + (scenario.refs.menu_item?.length ?? 0))
        expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
        db.close()
      })
    }
  }
})
