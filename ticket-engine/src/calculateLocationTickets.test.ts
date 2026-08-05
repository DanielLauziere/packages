import { describe, it, expect } from 'vitest'
import { calculateLocationTickets } from './calculateLocationTickets.js'
import type {
  CompleteTicket,
  TicketMenuItemDB,
  MenuItemDB,
  MenuItemModifierGroupModifierDB,
  TicketMenuItemModifierDB,
  PromotionDB,
  TicketPromotionDB,
  BogoMenuItemDB,
  TableDB,
  ComboComboMenuItemDB,
} from './types.js'

const EATIN = 'ed345e57-4fb1-4111-8603-9c820417ed3e'

const uSeq = (n: number): string =>
  '00000000-0000-0000-0000-000000000' +
  String(n).padStart(3, '0')

const makeTicket = (
  seq: number,
  overrides?: Partial<CompleteTicket>,
): CompleteTicket => ({
  uuid: uSeq(seq),
  id: 1000 + seq,
  time_stamp: '2026-01-01T12:00:00.000Z',
  status: 'COMPLETE',
  location_group_uuid: uSeq(1),
  locationUuid: '',
  app_unique_uuid: '',
  fulfillment_uuid: '',
  fulfillment_type: '',
  guest_uuid: '',
  guest_address_uuid: '',
  table_uuid: '',
  user_name: '',
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  address: '',
  anonymous_address: '',
  points: 0,
  payment_uuid: '',
  ...overrides,
})

const makeMenuItem = (
  seq: number,
  pw = 0,
  ph = 0,
  overrides?: Partial<MenuItemDB>,
): MenuItemDB => ({
  uuid: uSeq(seq),
  cache: uSeq(seq + 100),
  name: 'Item',
  description: '',
  active: true,
  price_whole: pw,
  price_hundredths: ph,
  ...overrides,
})

const makeTMI = (
  seq: number,
  ticketSeq: number,
  menuItemSeq: number,
  overrides?: Partial<TicketMenuItemDB>,
): TicketMenuItemDB => ({
  uuid: uSeq(seq),
  ticket_uuid: uSeq(ticketSeq),
  menu_item_uuid: uSeq(menuItemSeq),
  note: null,
  ...overrides,
})

const makeMod = (
  seq: number,
  menuItemSeq: number,
  pw = 0,
  ph = 0,
  req = 0,
): MenuItemModifierGroupModifierDB => ({
  uuid: uSeq(seq),
  menu_item_uuid: uSeq(menuItemSeq),
  name: 'Mod',
  active: true,
  price_whole: pw,
  price_hundredths: ph,
  amount_required: req,
})

const makeTMIMod = (
  seq: number,
  tmiSeq: number,
  modSeq: number,
): TicketMenuItemModifierDB => ({
  uuid: uSeq(seq),
  ticket_menu_item_uuid: uSeq(tmiSeq),
  modifier_uuid: uSeq(modSeq),
  ticket_uuid: '',
})

const makeTP = (
  seq: number,
  ticketSeq: number,
  promoSeq: number,
  overrides?: Partial<TicketPromotionDB>,
): TicketPromotionDB => ({
  uuid: uSeq(seq),
  ticket_uuid: uSeq(ticketSeq),
  promotion_uuid: uSeq(promoSeq),
  ticket_menu_item_uuid: null,
  time_stamp: '2026-01-01T12:00:00.000Z',
  ...overrides,
})

const makePromo = (
  seq: number,
  overrides?: Partial<PromotionDB>,
): PromotionDB => ({
  uuid: uSeq(seq),
  name: '',
  active: true,
  type: 'PROMOTION',
  itemless: false,
  bogo_buy: '',
  bogo_get: '',
  points_required: 0,
  points_multiplier: 0,
  promotion_is_percentage: false,
  discount_percent: 0,
  discount_whole: 0,
  discount_hundredths: 0,
  location_group_uuid: uSeq(1),
  ...overrides,
})

const makeBogo = (
  seq: number,
  bogoSeq: number,
  miSeq: number,
): BogoMenuItemDB => ({
  uuid: uSeq(seq),
  bogo_uuid: uSeq(bogoSeq),
  menu_item_uuid: uSeq(miSeq),
})

const makeTable = (seq: number, name: string): TableDB => ({
  uuid: uSeq(seq),
  name,
})

const run = (overrides: {
  tickets?: CompleteTicket[]
  ticket_menu_items?: TicketMenuItemDB[]
  menu_items?: MenuItemDB[]
  bogo_menu_items?: BogoMenuItemDB[]
  ticketPromotions?: TicketPromotionDB[]
  promotions?: PromotionDB[]
  tables?: TableDB[]
  modifiers?: MenuItemModifierGroupModifierDB[]
  ticketMenuItemsModifier?: TicketMenuItemModifierDB[]
  comboComboMenuItems?: ComboComboMenuItemDB[]
  tip_percentage?: number
  tax_percentage?: number
}) =>
  calculateLocationTickets({
    tickets: overrides.tickets ?? [],
    ticket_menu_items: overrides.ticket_menu_items ?? [],
    menu_items: overrides.menu_items ?? [],
    bogo_menu_items: overrides.bogo_menu_items ?? [],
    ticketPromotions: overrides.ticketPromotions ?? [],
    promotions: overrides.promotions ?? [],
    tables: overrides.tables ?? [],
    modifiers: overrides.modifiers ?? [],
    ticketMenuItemsModifier: overrides.ticketMenuItemsModifier ?? [],
    comboComboMenuItems: overrides.comboComboMenuItems ?? [],
    tip_percentage: overrides.tip_percentage ?? 0,
    tax_percentage: overrides.tax_percentage ?? 0,
  })

// ---------- EMPTY / EDGE ----------

describe('empty / edge', () => {
  it('empty tickets returns empty', () => {
    const ts = run({})
    expect(ts).toHaveLength(0)
  })

  it('one ticket no items', () => {
    const ts = run({ tickets: [makeTicket(1)] })
    expect(ts).toHaveLength(1)
    expect(ts[0]!.total_cents).toBe(0)
  })
})

// ---------- BASIC ITEMS ----------

describe('basic items', () => {
  it('one item', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 50)],
    })
    expect(ts).toHaveLength(1)
    expect(ts[0]!.total_cents).toBe(10 * 100 + 50)
    expect(ts[0]!.menu_items).toHaveLength(1)
  })

  it('multiple items sum', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20), makeTMI(11, 1, 21), makeTMI(12, 1, 22)],
      menu_items: [makeMenuItem(20, 5, 0), makeMenuItem(21, 3, 50), makeMenuItem(22, 10, 99)],
    })
    expect(ts[0]!.total_cents).toBe(500 + 350 + 1099)
  })

  it('zero price item', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 0, 0)],
    })
    expect(ts[0]!.total_cents).toBe(0)
  })

  it('menu item not found skips silently', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 999)],
      menu_items: [makeMenuItem(20, 10, 0)],
    })
    expect(ts[0]!.menu_items).toHaveLength(0)
  })

  it('item with note', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20, { note: 'No onions' })],
      menu_items: [makeMenuItem(20, 10, 0)],
    })
    expect(ts[0]!.menu_items[0]!.ticket_menu_item_note).toBe('No onions')
  })

  it('item note null', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
    })
    expect(ts[0]!.menu_items[0]!.ticket_menu_item_note).toBeNull()
  })

  it('inactive menu item still priced', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0, { active: false })],
    })
    expect(ts[0]!.total_cents).toBe(1000)
  })

  it('large prices', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 999999, 99)],
    })
    expect(ts[0]!.total_cents).toBe(999999 * 100 + 99)
  })

  it('multiple tickets', () => {
    const ts = run({
      tickets: [makeTicket(1), makeTicket(2)],
      ticket_menu_items: [makeTMI(10, 1, 20), makeTMI(11, 2, 21)],
      menu_items: [makeMenuItem(20, 10, 0), makeMenuItem(21, 20, 0)],
    })
    expect(ts).toHaveLength(2)
    expect(ts[0]!.total_cents).toBe(1000)
    expect(ts[1]!.total_cents).toBe(2000)
  })
})

// ---------- MODIFIERS ----------

describe('modifiers', () => {
  it('one modifier', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      modifiers: [makeMod(30, 20, 2, 0)],
      ticketMenuItemsModifier: [makeTMIMod(40, 10, 30)],
    })
    expect(ts[0]!.total_cents).toBe(1000 + 200)
  })

  it('multiple modifiers', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      modifiers: [makeMod(30, 20, 2, 0), makeMod(31, 20, 1, 50)],
      ticketMenuItemsModifier: [makeTMIMod(40, 10, 30), makeTMIMod(41, 10, 31)],
    })
    expect(ts[0]!.total_cents).toBe(1000 + 200 + 150)
  })

  it('free modifier adds no cost', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      modifiers: [makeMod(30, 20, 0, 0)],
      ticketMenuItemsModifier: [makeTMIMod(40, 10, 30)],
    })
    expect(ts[0]!.total_cents).toBe(1000)
  })

  it('modifier for different menu_item ignored', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0), makeMenuItem(21, 5, 0)],
      modifiers: [makeMod(30, 21, 5, 0)],
      ticketMenuItemsModifier: [makeTMIMod(40, 10, 30)],
    })
    expect(ts[0]!.total_cents).toBe(1000)
  })

  it('modifier amount_required propagated', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      modifiers: [makeMod(30, 20, 0, 0, 3)],
      ticketMenuItemsModifier: [makeTMIMod(40, 10, 30)],
    })
    expect(ts[0]!.menu_items[0]!.modifier_group_amount_required).toBe(3)
  })

  it('available modifiers populated', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      modifiers: [makeMod(30, 20, 0, 0), makeMod(31, 20, 0, 0)],
    })
    expect(ts[0]!.menu_items[0]!.available_modifiers).toHaveLength(2)
  })
})

// ---------- TABLES ----------

describe('tables', () => {
  it('table name lookup', () => {
    const ts = run({
      tickets: [makeTicket(1, { table_uuid: uSeq(50) })],
      tables: [makeTable(50, 'Patio-3')],
    })
    expect(ts[0]!.table_name).toBe('Patio-3')
  })

  it('no table uuid -> no table name', () => {
    const ts = run({ tickets: [makeTicket(1)] })
    expect(ts[0]!.table_name).toBeUndefined()
  })

  it('numeric sort', () => {
    const ts = run({
      tickets: [
        makeTicket(1, { table_uuid: uSeq(51) }),
        makeTicket(2, { table_uuid: uSeq(52) }),
        makeTicket(3, { table_uuid: uSeq(53) }),
      ],
      tables: [
        makeTable(51, '2'),
        makeTable(52, '10'),
        makeTable(53, '1'),
      ],
    })
    expect(ts[0]!.table_name).toBe('1')
    expect(ts[1]!.table_name).toBe('2')
    expect(ts[2]!.table_name).toBe('10')
  })

  it('alpha sort', () => {
    const ts = run({
      tickets: [
        makeTicket(1, { table_uuid: uSeq(51) }),
        makeTicket(2, { table_uuid: uSeq(52) }),
        makeTicket(3, { table_uuid: uSeq(53) }),
      ],
      tables: [
        makeTable(51, 'Zebra'),
        makeTable(52, 'Alpha'),
        makeTable(53, 'Bravo'),
      ],
    })
    expect(ts[0]!.table_name).toBe('Alpha')
    expect(ts[1]!.table_name).toBe('Bravo')
    expect(ts[2]!.table_name).toBe('Zebra')
  })

  it('empty table names last', () => {
    const ts = run({
      tickets: [
        makeTicket(1, { table_uuid: uSeq(51) }),
        makeTicket(2),
        makeTicket(3, { table_uuid: uSeq(52) }),
      ],
      tables: [
        makeTable(51, '3'),
        makeTable(52, '1'),
      ],
    })
    expect(ts[0]!.table_name).toBe('1')
    expect(ts[1]!.table_name).toBe('3')
    expect(ts[2]!.table_name).toBeUndefined()
  })

  it('mixed sort numbers then text', () => {
    const ts = run({
      tickets: [
        makeTicket(1, { table_uuid: uSeq(51) }),
        makeTicket(2, { table_uuid: uSeq(52) }),
        makeTicket(3, { table_uuid: uSeq(53) }),
        makeTicket(4, { table_uuid: uSeq(54) }),
      ],
      tables: [
        makeTable(51, 'Patio-1'),
        makeTable(52, '3'),
        makeTable(53, '15'),
        makeTable(54, '1'),
      ],
    })
    expect(ts[0]!.table_name).toBe('1')
    expect(ts[1]!.table_name).toBe('3')
    expect(ts[2]!.table_name).toBe('15')
    expect(ts[3]!.table_name).toBe('Patio-1')
  })

  it('tiebreak with same table name', () => {
    const ts = run({
      tickets: [
        makeTicket(1, { table_uuid: uSeq(51) }),
        makeTicket(2, { table_uuid: uSeq(51) }),
      ],
      tables: [makeTable(51, 'Same')],
    })
    expect(ts[0]!.table_name).toBe('Same')
    expect(ts[1]!.table_name).toBe('Same')
  })
})

// ---------- PROMOTIONS ----------

describe('promotions on items', () => {
  it('fixed discount', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      ticketPromotions: [makeTP(50, 1, 60, { ticket_menu_item_uuid: uSeq(10) })],
      promotions: [makePromo(60, { discount_whole: 3 })],
    })
    expect(ts[0]!.menu_items[0]!.price_whole).toBe(7)
    expect(ts[0]!.menu_items[0]!.original_price_whole).toBe(10)
    expect(ts[0]!.total_cents).toBe(700)
  })

  it('percentage discount', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 20, 0)],
      ticketPromotions: [makeTP(50, 1, 60, { ticket_menu_item_uuid: uSeq(10) })],
      promotions: [makePromo(60, { promotion_is_percentage: true, discount_percent: 25 })],
    })
    expect(ts[0]!.menu_items[0]!.price_whole).toBe(15)
    expect(ts[0]!.total_cents).toBe(1500)
  })

  it('percentage rounding', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 99)],
      ticketPromotions: [makeTP(50, 1, 60, { ticket_menu_item_uuid: uSeq(10) })],
      promotions: [makePromo(60, { promotion_is_percentage: true, discount_percent: 33 })],
    })
    const cents = 10 * 100 + 99
    const disc = Math.floor((cents * 33) / 100)
    expect(ts[0]!.total_cents).toBe(cents - disc)
  })

  it('promotion not found skips', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      ticketPromotions: [makeTP(50, 1, 999)],
      promotions: [],
    })
    expect(ts[0]!.total_cents).toBe(1000)
  })

  it('loyalty type promo on item does NOT apply discount', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      ticketPromotions: [makeTP(50, 1, 60, { ticket_menu_item_uuid: uSeq(10) })],
      promotions: [makePromo(60, { type: 'LOYALTY', discount_whole: 3 })],
    })
    expect(ts[0]!.total_cents).toBe(1000)
    expect(ts[0]!.menu_items[0]!.applied_promotions).toHaveLength(1)
  })
})

// ---------- ITEMLESS PROMOTIONS ----------

describe('itemless promotions', () => {
  it('itemless reward applied', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 20, 0)],
      ticketPromotions: [makeTP(50, 1, 60)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, discount_whole: 5 })],
    })
    expect(ts[0]!.total_cents).toBe(2000 - 500)
    expect(ts[0]!.applied_promotions).toHaveLength(1)
  })

  it('itemless only for REWARD type', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      ticketPromotions: [makeTP(50, 1, 60)],
      promotions: [makePromo(60, { type: 'PROMOTION', itemless: true })],
    })
    expect(ts[0]!.total_cents).toBe(1000)
  })

  it('itemless linked to ticket no items (zero discount)', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [],
      menu_items: [],
      ticketPromotions: [makeTP(50, 1, 60)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, discount_whole: 0 })],
    })
    expect(ts[0]!.applied_promotions).toHaveLength(1)
  })

  it('multiple itemless promos on same ticket', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 30, 0)],
      ticketPromotions: [makeTP(50, 1, 60), makeTP(51, 1, 61)],
      promotions: [
        makePromo(60, { type: 'REWARD', itemless: true, discount_whole: 5 }),
        makePromo(61, { type: 'REWARD', itemless: true, discount_whole: 3 }),
      ],
    })
    expect(ts[0]!.total_cents).toBe(3000 - 500 - 300)
    expect(ts[0]!.applied_promotions).toHaveLength(2)
  })
})

// ---------- INACTIVE + ORIGINAL PRICE ----------

describe('inactive and original price', () => {
  it('inactive promo ineligible', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      promotions: [makePromo(60, { type: 'REWARD', active: false })],
    })
    expect(ts[0]!.eligable_promotions).toHaveLength(0)
    expect(ts[0]!.ineligable_promotions).toHaveLength(1)
  })

  it('original price preserved after discount', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 25, 50)],
      ticketPromotions: [makeTP(50, 1, 60, { ticket_menu_item_uuid: uSeq(10) })],
      promotions: [makePromo(60, { promotion_is_percentage: true, discount_percent: 20 })],
    })
    expect(ts[0]!.menu_items[0]!.original_price_whole).toBe(25)
    expect(ts[0]!.menu_items[0]!.price_whole).not.toBe(25)
  })

  it('regular promo no bogo no itemless -> ineligible', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      promotions: [makePromo(60, { type: 'PROMOTION', itemless: false })],
    })
    expect(ts[0]!.eligable_promotions).toHaveLength(0)
    expect(ts[0]!.ineligable_promotions).toHaveLength(1)
  })
})

// ---------- BOGO ----------

describe('bogo', () => {
  it('bogo buy eligible', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      bogo_menu_items: [makeBogo(80, 60, 20)],
      promotions: [makePromo(60, { type: 'PROMOTION', bogo_buy: uSeq(60) })],
    })
    expect(ts[0]!.eligable_promotions).toHaveLength(1)
  })

  it('bogo not eligible when already applied', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      bogo_menu_items: [makeBogo(80, 60, 20)],
      ticketPromotions: [makeTP(50, 1, 60, { ticket_menu_item_uuid: uSeq(10) })],
      promotions: [makePromo(60, { type: 'PROMOTION', bogo_buy: uSeq(60) })],
    })
    expect(ts[0]!.eligable_promotions).toHaveLength(0)
  })

  it('bogo reward insufficient points', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 5 })],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      bogo_menu_items: [makeBogo(80, 60, 20)],
      promotions: [makePromo(60, { type: 'REWARD', bogo_get: uSeq(60), points_required: 100 })],
    })
    expect(ts[0]!.eligable_promotions).toHaveLength(0)
  })

  it('bogo get eligible', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 100 })],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      bogo_menu_items: [makeBogo(80, 60, 20)],
      promotions: [makePromo(60, { type: 'REWARD', bogo_get: uSeq(60), points_required: 50 })],
    })
    expect(ts[0]!.eligable_promotions).toHaveLength(1)
  })

  it('bogo buy uuid not matching', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      bogo_menu_items: [makeBogo(80, 99, 20)],
      promotions: [makePromo(60, { type: 'PROMOTION', bogo_buy: uSeq(60) })],
    })
    expect(ts[0]!.eligable_promotions).toHaveLength(0)
  })

  it('bogo get uuid not matching', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 100 })],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      bogo_menu_items: [makeBogo(80, 99, 20)],
      promotions: [makePromo(60, { type: 'REWARD', bogo_get: uSeq(60), points_required: 0 })],
    })
    expect(ts[0]!.eligable_promotions).toHaveLength(0)
  })
})

// ---------- POINTS ----------

describe('points', () => {
  it('points with multiplier', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 100 })],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      promotions: [makePromo(60, { type: 'LOYALTY', points_multiplier: 5 })],
    })
    const want = Math.floor((1000 * 5) / 100)
    expect(ts[0]!.total_points).toBe(want)
    expect(ts[0]!.end_points).toBe(100 + want)
  })

  it('no multiplier', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 50 })],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
    })
    expect(ts[0]!.total_points).toBe(0)
    expect(ts[0]!.end_points).toBe(50)
  })

  it('redeemed points', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 200 })],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 20, 0)],
      ticketPromotions: [makeTP(50, 1, 60)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, points_required: 50, discount_whole: 5 })],
    })
    expect(ts[0]!.redeemed_points).toBe(50)
    expect(ts[0]!.guests_points).toBe(200)
  })

  it('best multiplier selected', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      promotions: [
        makePromo(60, { type: 'LOYALTY', points_multiplier: 2 }),
        makePromo(61, { type: 'LOYALTY', points_multiplier: 10 }),
        makePromo(62, { type: 'LOYALTY', points_multiplier: 5 }),
      ],
    })
    expect(ts[0]!.total_points).toBe(Math.floor((1000 * 10) / 100))
  })

  it('inactive loyalty ignored', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      promotions: [
        makePromo(60, { type: 'LOYALTY', points_multiplier: 3 }),
        makePromo(61, { type: 'LOYALTY', active: false, points_multiplier: 100 }),
      ],
    })
    expect(ts[0]!.total_points).toBe(Math.floor((1000 * 3) / 100))
  })

  it('zero guest points', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 0 })],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      promotions: [makePromo(60, { type: 'LOYALTY', points_multiplier: 3 })],
    })
    expect(ts[0]!.guests_points).toBe(0)
    expect(ts[0]!.end_points).toBe(ts[0]!.total_points)
  })
})

// ---------- TIP / TAX ----------

describe('tip / tax', () => {
  it('tip applied for eatin fulfillment', () => {
    const ts = run({
      tickets: [makeTicket(1, { fulfillment_uuid: EATIN })],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 20, 0)],
      tip_percentage: 15,
    })
    expect(ts[0]!.tip_total).toBe('3.00')
  })

  it('no tip for non-eatin', () => {
    const ts = run({
      tickets: [makeTicket(1, { fulfillment_uuid: uSeq(99) })],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 20, 0)],
      tip_percentage: 15,
    })
    expect(ts[0]!.tip_total).toBe('0.00')
  })

  it('no tip when fulfillment uuid empty', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      tip_percentage: 15,
    })
    expect(ts[0]!.tip_total).toBe('0.00')
  })

  it('tax applied', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 20, 0)],
      tax_percentage: 10,
    })
    expect(ts[0]!.tax_total_cents).toBe(Math.floor((10 * 2000) / 100))
    expect(ts[0]!.tax_total).toBe('2.00')
  })

  it('tip and tax together', () => {
    const ts = run({
      tickets: [makeTicket(1, { fulfillment_uuid: EATIN })],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 20, 0)],
      tip_percentage: 15,
      tax_percentage: 10,
    })
    const tot = 2000
    const tip = Math.floor((15 * tot) / 100)
    const tax = Math.floor((10 * tot) / 100)
    expect(ts[0]!.grand_total_cents).toBe(tot + tip + tax)
  })

  it('zero tip and tax', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
    })
    expect(ts[0]!.grand_total_cents).toBe(1000)
  })
})

// ---------- ELIGIBILITY ----------

describe('eligibility', () => {
  it('reward eligible with enough grand total and points', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 100 })],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 20, 0)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, discount_whole: 5, points_required: 50 })],
    })
    expect(ts[0]!.eligable_promotions).toHaveLength(1)
  })

  it('reward ineligible when grand total too small', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 100 })],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 3, 0)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, discount_whole: 10, points_required: 50 })],
    })
    expect(ts[0]!.eligable_promotions).toHaveLength(0)
  })

  it('already applied promo not eligible again', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 100 })],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 20, 0)],
      ticketPromotions: [makeTP(50, 1, 60)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, discount_whole: 5, points_required: 50 })],
    })
    for (const ep of ts[0]!.eligable_promotions) {
      expect(ep.uuid).not.toBe(uSeq(60))
    }
  })
})

// ---------- GUEST INFO ----------

describe('guest info', () => {
  it('guest info passthrough', () => {
    const ts = run({
      tickets: [makeTicket(1, {
        user_name: 'jdoe',
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@ex.com',
        phone: '+15551234567',
        fulfillment_type: 'delivery',
        address: '123 Main',
      })],
    })
    expect(ts[0]!.user_name).toBe('jdoe')
    expect(ts[0]!.first_name).toBe('John')
    expect(ts[0]!.last_name).toBe('Doe')
    expect(ts[0]!.email).toBe('john@ex.com')
    expect(ts[0]!.phone).toBe('+15551234567')
    expect(ts[0]!.fulfillment_type).toBe('delivery')
    expect(ts[0]!.address).toBe('123 Main')
  })

  it('guest info empty strings', () => {
    const ts = run({ tickets: [makeTicket(1)] })
    expect(ts[0]!.user_name).toBe('')
    expect(ts[0]!.first_name).toBe('')
  })
})

// ---------- SINGLE-DIGIT CENTS ----------

describe('single-digit cents formatting', () => {
  it('total and grand total', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 0, 5)],
    })
    expect(ts[0]!.total).toBe('0.05')
    expect(ts[0]!.grand_total).toBe('0.05')
  })

  it('tip cents', () => {
    const ts = run({
      tickets: [makeTicket(1, { fulfillment_uuid: EATIN })],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 0, 5)],
      tip_percentage: 50,
    })
    expect(ts[0]!.tip_total).toBe('0.02')
  })

  it('tax cents', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 0, 5)],
      tax_percentage: 50,
    })
    expect(ts[0]!.tax_total).toBe('0.02')
  })
})

// ---------- TABLE UUID NOT IN MAP ----------

describe('table edge cases', () => {
  it('table uuid valid but not in map', () => {
    const ts = run({
      tickets: [makeTicket(1, { table_uuid: uSeq(99) })],
      tables: [],
    })
    expect(ts[0]!.table_name).toBeUndefined()
  })
})

// ---------- TICKET-FILTERED ITEMS ----------

describe('ticket menu item filtering', () => {
  it('tmi belongs to different ticket', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 2, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
    })
    expect(ts[0]!.menu_items).toHaveLength(0)
    expect(ts[0]!.total_cents).toBe(0)
  })
})

// ---------- TICKET FIELDS ----------

describe('ticket fields passthrough', () => {
  it('all ticket fields', () => {
    const ts = run({
      tickets: [{
        uuid: uSeq(1),
        id: 5001,
        time_stamp: '2026-06-15T10:30:00.000Z',
        status: 'COMPLETE',
        location_group_uuid: uSeq(2),
        locationUuid: uSeq(3),
        app_unique_uuid: uSeq(4),
        fulfillment_uuid: uSeq(5),
        guest_uuid: uSeq(6),
        guest_address_uuid: uSeq(7),
        table_uuid: '',
        user_name: '',
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        address: '',
        fulfillment_type: '',
        anonymous_address: '123 Privet Dr',
        points: 0,
        payment_uuid: 'pay_abc',
      }],
    })
    expect(ts[0]!.uuid).toBe(uSeq(1))
    expect(ts[0]!.id).toBe(5001)
    expect(ts[0]!.time_stamp).toBe('2026-06-15T10:30:00.000Z')
    expect(ts[0]!.status).toBe('COMPLETE')
    expect(ts[0]!.anonymous_address).toBe('123 Privet Dr')
    expect(ts[0]!.payment_uuid).toBe('pay_abc')
  })
})

// ---------- COMBO ----------

describe('combos', () => {
  it('combo items removed from pricing', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20), makeTMI(11, 1, 21)],
      menu_items: [makeMenuItem(20, 5, 0), makeMenuItem(21, 3, 0)],
      comboComboMenuItems: [
        { uuid: uSeq(100), name: 'Meal', description: '', active: true, price_whole: 7, price_hundredths: 0, combo_uuid: uSeq(110), menu_item_uuid: uSeq(20) },
        { uuid: uSeq(101), name: 'Meal', description: '', active: true, price_whole: 7, price_hundredths: 0, combo_uuid: uSeq(110), menu_item_uuid: uSeq(21) },
      ],
    })
    expect(ts[0]!.combos).toHaveLength(1)
    expect(ts[0]!.total_cents).toBe(700)
  })

  it('combo consumes some items leaves standalone', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20), makeTMI(11, 1, 21), makeTMI(12, 1, 22)],
      menu_items: [makeMenuItem(20, 5, 0), makeMenuItem(21, 3, 0), makeMenuItem(22, 8, 0)],
      comboComboMenuItems: [
        { uuid: uSeq(100), name: 'Meal', description: '', active: true, price_whole: 7, price_hundredths: 0, combo_uuid: uSeq(110), menu_item_uuid: uSeq(20) },
        { uuid: uSeq(101), name: 'Meal', description: '', active: true, price_whole: 7, price_hundredths: 0, combo_uuid: uSeq(110), menu_item_uuid: uSeq(21) },
      ],
    })
    expect(ts[0]!.total_cents).toBe(1500)
  })
})

// ---------- NEGATIVE GRAND TOTAL RECOVERY ----------

describe('negative grand total recovery', () => {
  it('removes itemless promotions to recover from negative', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 5, 0)],
      ticketPromotions: [makeTP(50, 1, 60)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, discount_whole: 100 })],
    })
    expect(ts[0]!.grand_total_cents).toBeGreaterThanOrEqual(0)
  })

  it('recovers with percentage itemless promotion', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 5, 0)],
      ticketPromotions: [makeTP(50, 1, 60)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, promotion_is_percentage: true, discount_percent: 200 })],
    })
    expect(ts[0]!.grand_total_cents).toBeGreaterThanOrEqual(0)
  })

  it('recovers with multiple itemless promos, stops when grand_total >= 0', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      ticketPromotions: [makeTP(50, 1, 60), makeTP(51, 1, 61)],
      promotions: [
        makePromo(60, { type: 'REWARD', itemless: true, discount_whole: 12 }),
        makePromo(61, { type: 'REWARD', itemless: true, discount_whole: 12 }),
      ],
    })
    expect(ts[0]!.grand_total_cents).toBeGreaterThanOrEqual(0)
  })
})

// ---------- ITEM DESCRIPTION ----------

describe('item description', () => {
  it('description passthrough', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0, { description: 'Tasty food' })],
    })
    expect(ts[0]!.menu_items[0]!.description).toBe('Tasty food')
  })
})

// ---------- NEGATIVE GRAND TOTAL, NO ITEMLESS ----------

describe('negative grand total no itemless recovery', () => {
  it('stays negative when no itemless promos exist', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 5, 0)],
      ticketPromotions: [makeTP(50, 1, 60, { ticket_menu_item_uuid: uSeq(10) })],
      promotions: [makePromo(60, { discount_whole: 100 })],
    })
    expect(ts[0]!.grand_total_cents).toBeLessThan(0)
  })

  it('all itemless removed still negative', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 5, 0)],
      ticketPromotions: [
        makeTP(50, 1, 60, { ticket_menu_item_uuid: uSeq(10) }),
        makeTP(51, 1, 61),
      ],
      promotions: [
        makePromo(60, { type: 'REWARD', discount_percent: 200, promotion_is_percentage: true }),
        makePromo(61, { type: 'REWARD', itemless: true, discount_whole: 1000 }),
      ],
    })
    expect(ts[0]!.grand_total_cents).toBeLessThan(0)
  })
})

// ---------- ITEMLESS ELIGIBILITY EDGES ----------

describe('itemless eligibility edges', () => {
  it('percentage itemless reward eligible (discount_whole=0 <= grand_total)', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 50 })],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, promotion_is_percentage: true, discount_percent: 20, points_required: 10 })],
    })
    expect(ts[0]!.eligable_promotions).toHaveLength(1)
  })

  it('itemless reward ineligible when insufficient points', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 5 })],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 20, 0)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, discount_whole: 5, points_required: 50 })],
    })
    expect(ts[0]!.eligable_promotions).toHaveLength(0)
  })
})

// ---------- BOGO INACTIVE ----------

describe('bogo inactive', () => {
  it('inactive bogo promo ineligible', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 10, 0)],
      bogo_menu_items: [makeBogo(80, 60, 20)],
      promotions: [makePromo(60, { type: 'PROMOTION', active: false, bogo_buy: uSeq(60) })],
    })
    expect(ts[0]!.eligable_promotions).toHaveLength(0)
    expect(ts[0]!.ineligable_promotions).toHaveLength(1)
  })
})

// ---------- COMBO EDGES ----------

describe('combo edges', () => {
  it('multiple combo groups', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20), makeTMI(11, 1, 21), makeTMI(12, 1, 22), makeTMI(13, 1, 23)],
      menu_items: [makeMenuItem(20, 5, 0), makeMenuItem(21, 3, 0), makeMenuItem(22, 4, 0), makeMenuItem(23, 6, 0)],
      comboComboMenuItems: [
        { uuid: uSeq(100), name: 'Meal', description: 'combo1 desc', active: true, price_whole: 7, price_hundredths: 0, combo_uuid: uSeq(110), menu_item_uuid: uSeq(20) },
        { uuid: uSeq(101), name: 'Meal', description: 'combo1 desc', active: true, price_whole: 7, price_hundredths: 0, combo_uuid: uSeq(110), menu_item_uuid: uSeq(21) },
        { uuid: uSeq(102), name: 'Drink', description: 'combo2 desc', active: true, price_whole: 5, price_hundredths: 0, combo_uuid: uSeq(111), menu_item_uuid: uSeq(22) },
        { uuid: uSeq(103), name: 'Drink', description: 'combo2 desc', active: true, price_whole: 5, price_hundredths: 0, combo_uuid: uSeq(111), menu_item_uuid: uSeq(23) },
      ],
    })
    expect(ts[0]!.combos).toHaveLength(2)
    expect(ts[0]!.menu_items).toHaveLength(0)
    // combo1 = Meal (700) + combo2 = Drink (500)
    expect(ts[0]!.total_cents).toBe(1200)
  })

  it('inactive combo combo menu item still consumed', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20), makeTMI(11, 1, 21)],
      menu_items: [makeMenuItem(20, 5, 0), makeMenuItem(21, 3, 0)],
      comboComboMenuItems: [
        { uuid: uSeq(100), name: 'Meal', description: '', active: false, price_whole: 7, price_hundredths: 0, combo_uuid: uSeq(110), menu_item_uuid: uSeq(20) },
        { uuid: uSeq(101), name: 'Meal', description: '', active: false, price_whole: 7, price_hundredths: 0, combo_uuid: uSeq(110), menu_item_uuid: uSeq(21) },
      ],
    })
    expect(ts[0]!.combos).toHaveLength(1)
    expect(ts[0]!.combos[0]!.active).toBe(false)
    expect(ts[0]!.menu_items).toHaveLength(0)
  })

  it('combo description passthrough', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20), makeTMI(11, 1, 21)],
      menu_items: [makeMenuItem(20, 5, 0), makeMenuItem(21, 3, 0)],
      comboComboMenuItems: [
        { uuid: uSeq(100), name: 'Meal', description: 'Combo deal desc', active: true, price_whole: 7, price_hundredths: 0, combo_uuid: uSeq(110), menu_item_uuid: uSeq(20) },
        { uuid: uSeq(101), name: 'Meal', description: 'Combo deal desc', active: true, price_whole: 7, price_hundredths: 0, combo_uuid: uSeq(110), menu_item_uuid: uSeq(21) },
      ],
    })
    expect(ts[0]!.combos[0]!.description).toBe('Combo deal desc')
  })

  it('repeated combo instances from same group', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [
        makeTMI(10, 1, 20), makeTMI(11, 1, 21),
        makeTMI(12, 1, 20), makeTMI(13, 1, 21),
      ],
      menu_items: [makeMenuItem(20, 5, 0), makeMenuItem(21, 3, 0)],
      comboComboMenuItems: [
        { uuid: uSeq(100), name: 'Meal', description: '', active: true, price_whole: 7, price_hundredths: 0, combo_uuid: uSeq(110), menu_item_uuid: uSeq(20) },
        { uuid: uSeq(101), name: 'Meal', description: '', active: true, price_whole: 7, price_hundredths: 0, combo_uuid: uSeq(110), menu_item_uuid: uSeq(21) },
      ],
    })
    expect(ts[0]!.combos).toHaveLength(2)
    expect(ts[0]!.menu_items).toHaveLength(0)
  })
})

// ---------- FORMAT EDGE CASES ----------

describe('format edge cases', () => {
  it('format zero', () => {
    const ts = run({ tickets: [makeTicket(1)] })
    expect(ts[0]!.total).toBe('0.00')
    expect(ts[0]!.grand_total).toBe('0.00')
  })

  it('format ninety nine cents', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 0, 99)],
    })
    expect(ts[0]!.total).toBe('0.99')
  })

  it('format exact dollar', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 1, 0)],
    })
    expect(ts[0]!.total).toBe('1.00')
  })

  it('format dollars and cents', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20)],
      menu_items: [makeMenuItem(20, 19, 99)],
    })
    expect(ts[0]!.total).toBe('19.99')
  })
})

// ---------- POINTS NULL/UNDEFINED ----------

describe('points fallback', () => {
  it('points zero when not provided', () => {
    const ts = run({
      tickets: [{
        uuid: uSeq(1), id: 1001, time_stamp: '', status: 'COMPLETE',
        location_group_uuid: '', locationUuid: '', app_unique_uuid: '',
        fulfillment_uuid: '', fulfillment_type: '', guest_uuid: '',
        guest_address_uuid: '', table_uuid: '', user_name: '', first_name: '',
        last_name: '', email: '', phone: '', address: '', anonymous_address: '',
        points: undefined as unknown as number, payment_uuid: '',
      }],
    })
    expect(ts[0]!.guests_points).toBe(0)
  })
})

// ---------- LOYALTY TYPE IN ELIGIBILITY ----------

describe('loyalty type eligibility', () => {
  it('LOYALTY promo falls to ineligable (no bogo, no itemless, no BOGO buy/get)', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      promotions: [makePromo(60, { type: 'LOYALTY', points_multiplier: 2 })],
    })
    expect(ts[0]!.eligable_promotions).toHaveLength(0)
    expect(ts[0]!.ineligable_promotions).toHaveLength(1)
  })
})

// ---------- CALCULATE COMBOS INTERNAL EDGES ----------

describe('calculateCombos internal edges', () => {
  it('count tiebreak sorts by uuid descending (larger uuid wins when same count)', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [
        makeTMI(10, 1, 20), makeTMI(11, 1, 21),
        makeTMI(12, 1, 22), makeTMI(13, 1, 23),
      ],
      menu_items: [
        makeMenuItem(20, 5, 0), makeMenuItem(21, 3, 0),
        makeMenuItem(22, 4, 0), makeMenuItem(23, 6, 0),
      ],
      comboComboMenuItems: [
        { uuid: uSeq(100), name: 'A', description: '', active: true, price_whole: 7, price_hundredths: 0, combo_uuid: uSeq(150), menu_item_uuid: uSeq(20) },
        { uuid: uSeq(101), name: 'A', description: '', active: true, price_whole: 7, price_hundredths: 0, combo_uuid: uSeq(150), menu_item_uuid: uSeq(21) },
        { uuid: uSeq(102), name: 'B', description: '', active: true, price_whole: 5, price_hundredths: 0, combo_uuid: uSeq(151), menu_item_uuid: uSeq(22) },
        { uuid: uSeq(103), name: 'B', description: '', active: true, price_whole: 5, price_hundredths: 0, combo_uuid: uSeq(151), menu_item_uuid: uSeq(23) },
      ],
    })
    expect(ts[0]!.combos).toHaveLength(2)
  })

  it('combo menu_item not found in menu_items still consumed', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticket_menu_items: [makeTMI(10, 1, 20), makeTMI(11, 1, 21)],
      menu_items: [makeMenuItem(21, 3, 0)],
      comboComboMenuItems: [
        { uuid: uSeq(100), name: 'Meal', description: '', active: true, price_whole: 7, price_hundredths: 0, combo_uuid: uSeq(110), menu_item_uuid: uSeq(20) },
        { uuid: uSeq(101), name: 'Meal', description: '', active: true, price_whole: 7, price_hundredths: 0, combo_uuid: uSeq(110), menu_item_uuid: uSeq(21) },
      ],
    })
    expect(ts[0]!.combos).toHaveLength(1)
    expect(ts[0]!.combos[0]!.combo_menu_items).toHaveLength(1)
    expect(ts[0]!.combos[0]!.combo_menu_items[0]!.menu_item_uuid).toBe(uSeq(21))
    expect(ts[0]!.combos[0]!.combo_menu_items[0]!.name).toBe('Item')
    expect(ts[0]!.menu_items).toHaveLength(0)
  })
})
