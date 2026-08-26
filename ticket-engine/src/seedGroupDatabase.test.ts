import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyDdl, FULL_DDL, seedGroupDatabase, validateSeedPayload, applyLogsBatch } from './index.js'

function adapter(db: DatabaseSync) {
  return {
    run: (s: string, p: unknown[] = []) => db.prepare(s).run(...(p as any)),
    query: (s: string, p: unknown[] = []) => db.prepare(s).all(...(p as any)),
  }
}

// location_group.country_uuid is NOT NULL with a hard-coded default that must
// resolve to an existing country row — include it in every fixture.
const COUNTRY = [{ uuid: 'ct-1', name: 'El Salvador', nombre: 'El Salvador', iso2: 'SV', iso3: 'SLV' }]
const LG = (extra: Record<string, unknown> = {}) => ({ uuid: 'lgg', name: 'X', url_name: 'x', country_uuid: 'ct-1', tax_percentage: 0, tip_percentage: 0, day_price_cents: 17, simple_print: 1, print_notes: 1, ...extra })

// A crash mid-seed = the surrounding transaction never commits. SQLite's own
// journal guarantees the file is atomic; even so, the engine must (a) surface
// the error, (b) leave the DB as it was before the seed (old version preserved,
// §2.3), and (c) let a subsequent seed complete and land.
it('mid-seed failure rolls back everything; the next seed completes (§4.2)', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyDdl(adapter(db), FULL_DDL)

  const seed: any = {
    country: COUNTRY,
    location_group: [LG()],
    dining_table: [{ uuid: 'dt1', name: 'T1', active: 1, location_group_uuid: 'lgg' }],
  }

  // Crash on COMMIT (e.g. process killed after all writes, before commit lands).
  // The engine must ROLLBACK atomically and re-throw, so the caller never
  // persists the new version — old version stays (SEED-REFACTOR §2.3/§4.2).
  const failAtCommit = (() => {
    return {
      run: (s: string, p: unknown[] = []) => {
        if (s.trim().toUpperCase().startsWith('COMMIT')) {
          throw new Error('simulated kill mid-seed')
        }
        return db.prepare(s).run(...(p as any))
      },
      query: (s: string, p: unknown[] = []) => db.prepare(s).all(...(p as any)),
    }
  })()

  expect(() => seedGroupDatabase(failAtCommit, seed)).toThrow('simulated kill mid-seed')

  // Rolled back atomically: nothing from the aborted seed persisted.
  const count = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get() as any).c
  expect(count('country')).toBe(0)
  expect(count('location_group')).toBe(0)
  expect(count('dining_table')).toBe(0)
  // Foreign-key enforcement was restored even though we never reached COMMIT.
  expect((db.prepare('PRAGMA foreign_keys').get() as any).foreign_keys).toBe(1)

  // Relaunch: the same seed against the healthy DB completes and lands.
  seedGroupDatabase(adapter(db), seed)
  expect(count('country')).toBe(1)
  expect(count('location_group')).toBe(1)
  expect(count('dining_table')).toBe(1)
})

describe('seedGroupDatabase (unified seeder)', () => {
  it('upserts promotion/dining_table without clobbering ticket-referenced rows', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    applyDdl(adapter(db), FULL_DDL)

    const seed = {
      language: [{ uuid: 'lg-1', name: 'es', nombre: 'es' }],
      country: [{ uuid: 'ct-1', name: 'El Salvador', nombre: 'El Salvador', iso2: 'SV', iso3: 'SLV', phone_code: 503, language_uuid: 'lg-1' }],
      location_group: [
        { uuid: 'lgg', name: 'X', url_name: 'x', country_uuid: 'ct-1', tax_percentage: 0, tip_percentage: 0, day_price_cents: 17, simple_print: 1, print_notes: 1 },
      ],
      promotion: [
        { uuid: 'promo-1', type: 'bogo', active: 1, name: 'Old name', description: 'old', location_group_uuid: 'lgg', promotion_is_percentage: 0, promotion_percentage: 0, promotion_price_whole: 0, promotion_price_hundredths: 0, minimum_amount: 1 },
      ],
      dining_table: [
        { uuid: 'dt1', name: 'T1', active: 1, location_group_uuid: 'lgg' },
      ],
      feature: [
        { uuid: 'ft-1', name: 'f', self_serve: 0 },
        { uuid: 'ft-2', name: 'g', self_serve: 0 },
      ],
      location_group_feature: [
        { uuid: 'lgf-1', location_group_uuid: 'lgg', feature_uuid: 'ft-1' },
        { uuid: 'lgf-2', location_group_uuid: 'lgg', feature_uuid: 'ft-2' },
      ],
      location_group_activation_history: [
        { uuid: 'ah-1', location_group_uuid: 'lgg', active: 1, day_price_cents: 17 },
      ],
      guest: [{ uuid: 'guest-1', user_name: 'guest@x.com' }],
      guest_address: [{ uuid: 'ga-1', address: '123 Main', guest_uuid: 'guest-1' }],
      fulfillment: [{ uuid: 'ed345e57-4fb1-4111-8603-9c820417ed3e', name: 'Dine-In' }],
      payment: [{ uuid: 'pay-1', name: 'Cash' }],
      admin: [{ uuid: 'admin-1', user_name: 'a', password_hash: 'x' }],
      // NOTE: ticket family is NEVER_TOUCH for the seeder — it is not seeded via
      // the snapshot. The ticket + its promotion below are created through the
      // real apply pipeline so the heal test can prove the seeder leaves them
      // untouched.
    }

    seedGroupDatabase(adapter(db), seed as any)

    // Create a live ticket + ticket_promotion through the apply pipeline (the
    // only sanctioned writer of the ticket family), so the heal reseed below
    // has rows it must not clobber.
    applyLogsBatch(adapter(db), [
      { uuid: 'l-guest', ticket_uuid: 'tkt-1', location_group_uuid: 'lgg', admin_uuid: 'admin-1', action: 'SET_GUEST', payload: { guest_user_name: 'guest@x.com' }, time_stamp: 1000 },
      { uuid: 'l-table', ticket_uuid: 'tkt-1', location_group_uuid: 'lgg', admin_uuid: 'admin-1', action: 'SET_TABLE', payload: { table_uuid: 'dt1' }, time_stamp: 1100 },
      { uuid: 'l-ful', ticket_uuid: 'tkt-1', location_group_uuid: 'lgg', admin_uuid: 'admin-1', action: 'SET_FULFILLMENT', payload: { fulfillment_uuid: 'ed345e57-4fb1-4111-8603-9c820417ed3e' }, time_stamp: 1200 },
      { uuid: 'l-promo', ticket_uuid: 'tkt-1', location_group_uuid: 'lgg', admin_uuid: 'admin-1', action: 'APPLY_PROMOTION', payload: { promotion_uuid: 'promo-1' }, time_stamp: 1300 },
    ] as any)

    // Server renamed the promotion + table and dropped one feature flag.
    const refSeed = {
      location_group: [
        { uuid: 'lgg', name: 'X', url_name: 'x', country_uuid: 'ct-1', tax_percentage: 0, tip_percentage: 0, day_price_cents: 17, simple_print: 1, print_notes: 1 },
      ],
      promotion: [
        { uuid: 'promo-1', type: 'bogo', active: 1, name: 'New name', description: 'new', location_group_uuid: 'lgg', promotion_is_percentage: 0, promotion_percentage: 0, promotion_price_whole: 0, promotion_price_hundredths: 0, minimum_amount: 1 },
      ],
      dining_table: [
        { uuid: 'dt1', name: 'T1-renamed', active: 1, location_group_uuid: 'lgg' },
      ],
      location_group_feature: [],
      location_group_activation_history: [
        { uuid: 'ah-2', location_group_uuid: 'lgg', active: 1, day_price_cents: 17 },
      ],
      guest: [{ uuid: 'guest-1', user_name: 'guest@x.com', first_name: 'New' }],
      guest_address: [{ uuid: 'ga-1', address: '456 New', guest_uuid: 'guest-1' }],
      fulfillment: [{ uuid: 'ed345e57-4fb1-4111-8603-9c820417ed3e', name: 'Dine-In' }],
      payment: [{ uuid: 'pay-2', name: 'Card' }],
      admin: [{ uuid: 'admin-1', user_name: 'a', password_hash: 'x', first_name: 'New' }],
      // note: no 'menu' family keys and no ticket_* keys — those tables are
      // either not in the payload (untouched) or trusted NEVER_TOUCH tables.
    }

    seedGroupDatabase(adapter(db), refSeed as any)

    const all = (s: string) => db.prepare(s).all() as any[]

    const promo = all(`SELECT name, description FROM promotion WHERE uuid = 'promo-1'`)[0]
    expect(promo.name).toBe('New name')
    expect(promo.description).toBe('new')

    const table = all(`SELECT name FROM dining_table WHERE uuid = 'dt1'`)[0]
    expect(table.name).toBe('T1-renamed')

    // Ticket + ticket_promotion untouched (UPSERT must not delete the FK target).
    expect(all(`SELECT COUNT(*) c FROM ticket`)[0].c).toBe(1)
    expect(all(`SELECT COUNT(*) c FROM ticket_promotion`)[0].c).toBe(1)

    // Admin / fulfillment / payment (ticket FK parents) are upserted, never deleted.
    const admin = all(`SELECT user_name, first_name FROM admin WHERE uuid = 'admin-1'`)[0]
    expect(admin.first_name).toBe('New')
    expect(all(`SELECT COUNT(*) c FROM fulfillment`)[0].c).toBe(1)
    expect(all(`SELECT COUNT(*) c FROM payment`)[0].c).toBe(2) // pay-1 kept, pay-2 upserted

    // The server is source of truth for join membership: feature flags were
    // stripped to [] in the ref payload, so both join rows are diff-deleted.
    // The feature entities themselves stay.
    expect(all(`SELECT COUNT(*) c FROM location_group_feature`)[0].c).toBe(0)
    expect(all(`SELECT COUNT(*) c FROM feature`)[0].c).toBe(2)
    expect(all(`SELECT COUNT(*) c FROM location_group_activation_history`)[0].c).toBe(1)
    expect(all(`SELECT uuid FROM location_group_activation_history`)[0].uuid).toBe('ah-2')

    expect(all('PRAGMA foreign_key_check')).toHaveLength(0)
  })

  it('entity tables are never deleted from; only join tables diff-delete', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    applyDdl(adapter(db), FULL_DDL)

    const seed = {
      country: COUNTRY,
      location_group: [LG()],
      dining_table: [
        { uuid: 'dt1', name: 'T1', active: 1, location_group_uuid: 'lgg' },
        { uuid: 'dt2', name: 'T2', active: 1, location_group_uuid: 'lgg' },
      ],
    }
    seedGroupDatabase(adapter(db), seed as any)

    // Re-seed with dt2 removed from the payload. Entity (dining_table) rows are
    // never deleted — the server instead sets active=0 — so dt2 must survive.
    const reseed = {
      country: COUNTRY,
      location_group: [LG()],
      dining_table: [{ uuid: 'dt1', name: 'T1', active: 1, location_group_uuid: 'lgg' }],
    }
    seedGroupDatabase(adapter(db), reseed as any)

    const all = (s: string) => db.prepare(s).all() as any[]
    expect(all(`SELECT COUNT(*) c FROM dining_table`)[0].c).toBe(2)
    expect(all(`SELECT COUNT(*) c FROM location_group`)[0].c).toBe(1)
    expect(all('PRAGMA foreign_key_check')).toHaveLength(0)
  })

  it('join tables diff-delete rows the server stopped sending, keyed by unique constraint', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    applyDdl(adapter(db), FULL_DDL)

    const base = {
      country: COUNTRY,
      location_group: [LG()],
      menu: [{ uuid: 'menu1', name: 'Menu', active: 1, location_group_uuid: 'lgg' }],
      menu_category: [{ uuid: 'cat1', name: 'Cats', active: 1, location_group_uuid: 'lgg' }],
      menu_item: [
        { uuid: 'mi1', name: 'Burger', price_whole: 5, price_hundredths: 0, cache: '{}', location_group_uuid: 'lgg' },
        { uuid: 'mi2', name: 'Soda', price_whole: 2, price_hundredths: 0, cache: '{}', location_group_uuid: 'lgg' },
      ],
      menu_menu_category: [
        { uuid: 'mmc1', menu_uuid: 'menu1', menu_category_uuid: 'cat1' },
      ],
      menu_item_menu_category: [
        { uuid: 'mimc1', menu_item_uuid: 'mi1', menu_category_uuid: 'cat1' },
        { uuid: 'mimc2', menu_item_uuid: 'mi2', menu_category_uuid: 'cat1' },
      ],
    }
    seedGroupDatabase(adapter(db), base as any)

    // Server removed mi2 from the category: its join row disappears, mi2 stays.
    const reseed = {
      country: COUNTRY,
      location_group: [LG()],
      menu: [{ uuid: 'menu1', name: 'Menu', active: 1, location_group_uuid: 'lgg' }],
      menu_category: [{ uuid: 'cat1', name: 'Cats', active: 1, location_group_uuid: 'lgg' }],
      menu_item: [
        { uuid: 'mi1', name: 'Burger', price_whole: 5, price_hundredths: 0, cache: '{}', location_group_uuid: 'lgg' },
        { uuid: 'mi2', name: 'Soda', price_whole: 2, price_hundredths: 0, cache: '{}', location_group_uuid: 'lgg' },
      ],
      menu_menu_category: [
        { uuid: 'mmc1', menu_uuid: 'menu1', menu_category_uuid: 'cat1' },
      ],
      menu_item_menu_category: [
        { uuid: 'mimc1', menu_item_uuid: 'mi1', menu_category_uuid: 'cat1' },
      ],
    }
    seedGroupDatabase(adapter(db), reseed as any)

    const all = (s: string) => db.prepare(s).all() as any[]
    expect(all(`SELECT COUNT(*) c FROM menu_item_menu_category`)[0].c).toBe(1)
    expect(all(`SELECT menu_item_uuid FROM menu_item_menu_category`)[0].menu_item_uuid).toBe('mi1')
    // Entity rows survive the re-seed.
    expect(all(`SELECT COUNT(*) c FROM menu_item`)[0].c).toBe(2)
    expect(all(`SELECT COUNT(*) c FROM menu_menu_category`)[0].c).toBe(1)
    expect(all('PRAGMA foreign_key_check')).toHaveLength(0)
  })

  it('menu family seeds idempotently across two identical payloads', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    applyDdl(adapter(db), FULL_DDL)

    const menuSeed: any = {
      seed_version: 42,
      country: COUNTRY,
      location_group: [LG()],
      menu: [{ uuid: 'menu1', name: 'Main Menu', active: 1, location_group_uuid: 'lgg' }],
      menu_category: [{ uuid: 'cat1', name: 'Burgers', active: 1, location_group_uuid: 'lgg' }],
      menu_item: [{ uuid: 'mi1', name: 'Cheeseburger', description: '', price_whole: 5, price_hundredths: 0, active: 1, complete: 0, location_group_uuid: 'lgg', cache: '{}' }],
      modifier_group: [{ uuid: 'mg1', name: 'Size', amount_required: 0, location_group_uuid: 'lgg' }],
      modifier: [{ uuid: 'mod1', name: 'Large', price_whole: 1, price_hundredths: 0, active: 1, location_group_uuid: 'lgg' }],
      menu_menu_category: [{ uuid: 'mmc1', menu_uuid: 'menu1', menu_category_uuid: 'cat1' }],
      menu_item_menu_category: [{ uuid: 'mimc1', menu_item_uuid: 'mi1', menu_category_uuid: 'cat1' }],
      menu_item_modifier_group: [{ uuid: 'mimg1', modifier_group_uuid: 'mg1', menu_item_uuid: 'mi1' }],
      modifier_group_modifier: [{ uuid: 'mgm1', modifier_group_uuid: 'mg1', modifier_uuid: 'mod1' }],
      sub_category: [],
      combo: [],
    }

    seedGroupDatabase(adapter(db), menuSeed)
    seedGroupDatabase(adapter(db), menuSeed)

    const row = (s: string) => db.prepare(s).get() as any
    expect(row(`SELECT COUNT(*) c FROM menu_item`).c).toBe(1)
    expect(row(`SELECT COUNT(*) c FROM menu`).c).toBe(1)
    expect(row(`SELECT COUNT(*) c FROM menu_item_menu_category`).c).toBe(1)
    expect(row(`SELECT COUNT(*) c FROM modifier_group_modifier`).c).toBe(1)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('never touches ticket/local tables even if a malicious payload includes them', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    applyDdl(adapter(db), FULL_DDL)

    const seed: any = {
      country: COUNTRY,
      location_group: [LG()],
      key_value: [{ key: 'device_uuid', value: 'local-device' }],
      session: [{ uuid: 's1', entity_uuid: 'admin-1', entity_type: 'admin', expires_at: '2099-01-01' }],
      print_record: [{ ticket_uuid: 't1', decision: 'printed', printing: 0, printed: 1 }],
      ticket: [{ uuid: 't1', id: 10001, time_stamp: 'now', status: 'INCOMPLETE', location_group_uuid: 'lgg' }],
      ticket_log: [{ uuid: 'tl1', location_group_uuid: 'lgg', ticket_uuid: 't1', action: 'ADD_ITEM', payload: '{}', time_stamp: 1 }],
      guest_location_group: [{ uuid: 'glg1', guest_uuid: 'g1', location_group_uuid: 'lgg', points: 999 }],
    }
    seedGroupDatabase(adapter(db), seed)

    const all = (s: string) => db.prepare(s).all() as any[]
    // The seeder still refuses to touch local device/auth + ticket state:
    expect(all(`SELECT COUNT(*) c FROM key_value`)[0].c).toBe(0)
    expect(all(`SELECT COUNT(*) c FROM session`)[0].c).toBe(0)
    expect(all(`SELECT COUNT(*) c FROM print_record`)[0].c).toBe(0)
    expect(all(`SELECT COUNT(*) c FROM ticket`)[0].c).toBe(0)
    expect(all(`SELECT COUNT(*) c FROM ticket_log`)[0].c).toBe(0)
    // guest_location_group IS a legit ref table (server-authoritative points, §9)
    // and is seeded like any other — a malicious payload can't clobber the
    // protected tables above, but it legitimately lands here.
    expect(all(`SELECT COUNT(*) c FROM guest_location_group`)[0].c).toBe(1)
    // The seed must have applied location_group too (not in NEVER_TOUCH).
    expect(all(`SELECT COUNT(*) c FROM location_group`)[0].c).toBe(1)
  })

  it('validateSeedPayload flags unknown tables, protected tables, un-keyed rows, and non-arrays', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    applyDdl(adapter(db), FULL_DDL)

    const seed: any = {
      seed_version: 42,
      location_group: [LG()],
      menu_item: [{ name: 'missing-uuid' }, { uuid: 'mi1', name: 'ok' }],
      ticket: [{ uuid: 't1' }],
      not_a_table: [{ uuid: 'x' }],
      session: 'scalar',
    }
    const problems = validateSeedPayload(adapter(db), seed)

    const issue = (table: string, i: string) => problems.some((p) => p.table === table && p.issue === i)
    expect(issue('seed_version', 'nonTable')).toBe(true)
    expect(issue('not_a_table', 'unknown')).toBe(true)
    expect(issue('ticket', 'neverTouch')).toBe(true)
    expect(issue('session', 'neverTouch')).toBe(true)
    expect(issue('menu_item', 'missingKeys')).toBe(true)
    // Every valid entity row keys cleanly; location_group has its uuid.
    expect(problems.filter((p) => p.issue === 'missingKeys' && p.table === 'location_group')).toHaveLength(0)

    // A well-formed snapshot validates clean.
    const good: any = {
      country: COUNTRY,
      location_group: [LG()],
      menu_item: [{ uuid: 'mi1', name: 'ok' }],
    }
    expect(validateSeedPayload(adapter(db), good)).toEqual([])
  })
})