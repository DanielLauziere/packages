import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyDdl, FULL_DDL, seedDatabase, seedRefDatabase } from './index.js'

function adapter(db: DatabaseSync) {
  return {
    run: (s: string, p: unknown[] = []) => db.prepare(s).run(...(p as any)),
    query: (s: string, p: unknown[] = []) => db.prepare(s).all(...(p as any)),
  }
}

describe('seedRefDatabase', () => {
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
      feature: [{ uuid: 'ft-1', name: 'f', description: '', feature_type: 'toggle' }],
      location_group_feature: [{ uuid: 'lgf-1', location_group_uuid: 'lgg', feature_uuid: 'ft-1' }],
      location_group_activation_history: [
        { uuid: 'ah-1', location_group_uuid: 'lgg', active: 1, day_price_cents: 17 },
      ],
      guest: [{ uuid: 'guest-1', user_name: 'guest@x.com' }],
      guest_address: [{ uuid: 'ga-1', address: '123 Main', guest_uuid: 'guest-1' }],
      fulfillment: [{ uuid: 'ed345e57-4fb1-4111-8603-9c820417ed3e', name: 'Dine-In' }],
      payment: [{ uuid: 'pay-1', name: 'Cash' }],
      admin: [{ uuid: 'admin-1', user_name: 'a', password_hash: 'x' }],
      ticket: [
        {
          uuid: 'tkt-1',
          id: 10001,
          time_stamp: '2026-08-10T00:00:00Z',
          status: 'INCOMPLETE',
          table_uuid: 'dt1',
          location_group_uuid: 'lgg',
          admin_uuid: 'admin-1',
          fulfillment_uuid: 'ed345e57-4fb1-4111-8603-9c820417ed3e',
          guest_uuid: 'guest-1',
          guest_address_uuid: 'ga-1',
        },
      ],
      ticket_promotion: [
        { uuid: 'tp-1', time_stamp: '2026-08-10T00:00:00Z', ticket_uuid: 'tkt-1', promotion_uuid: 'promo-1' },
      ],
    }

    seedDatabase(adapter(db), seed as any)

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
    }

    seedRefDatabase(adapter(db), refSeed as any)

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

    // Leaf tables: deleted then reinserted from the new snapshot.
    expect(all(`SELECT COUNT(*) c FROM location_group_feature`)[0].c).toBe(0)
    expect(all(`SELECT COUNT(*) c FROM location_group_activation_history`)[0].c).toBe(1)
    expect(all(`SELECT uuid FROM location_group_activation_history`)[0].uuid).toBe('ah-2')

    expect(all('PRAGMA foreign_key_check')).toHaveLength(0)
  })
})
