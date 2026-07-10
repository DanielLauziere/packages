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
  timeStamp: '2026-01-01T12:00:00.000Z',
  status: 'COMPLETE',
  locationGroupUuid: uSeq(1),
  locationUuid: '',
  appUniqueUuid: '',
  fulfillmentUuid: '',
  fulfillmentType: '',
  guestUuid: '',
  guestAddressUuid: '',
  tableUuid: '',
  userName: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  address: '',
  anonymousAddress: '',
  points: 0,
  paymentUuid: '',
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
  priceWhole: pw,
  priceHundredths: ph,
  ...overrides,
})

const makeTMI = (
  seq: number,
  ticketSeq: number,
  menuItemSeq: number,
  overrides?: Partial<TicketMenuItemDB>,
): TicketMenuItemDB => ({
  uuid: uSeq(seq),
  ticketUuid: uSeq(ticketSeq),
  menuItemUuid: uSeq(menuItemSeq),
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
  menuItemUuid: uSeq(menuItemSeq),
  name: 'Mod',
  active: true,
  priceWhole: pw,
  priceHundredths: ph,
  amountRequired: req,
})

const makeTMIMod = (
  seq: number,
  tmiSeq: number,
  modSeq: number,
): TicketMenuItemModifierDB => ({
  uuid: uSeq(seq),
  ticketMenuItemUuid: uSeq(tmiSeq),
  modifierUuid: uSeq(modSeq),
  ticketUuid: '',
})

const makeTP = (
  seq: number,
  ticketSeq: number,
  promoSeq: number,
  overrides?: Partial<TicketPromotionDB>,
): TicketPromotionDB => ({
  uuid: uSeq(seq),
  ticketUuid: uSeq(ticketSeq),
  promotionUuid: uSeq(promoSeq),
  ticketMenuItemUuid: null,
  timeStamp: '2026-01-01T12:00:00.000Z',
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
  bogoBuy: '',
  bogoGet: '',
  pointsRequired: 0,
  pointsMultiplier: 0,
  promotionIsPercentage: false,
  discountPercent: 0,
  discountWhole: 0,
  discountHundredths: 0,
  locationGroupUuid: uSeq(1),
  ...overrides,
})

const makeBogo = (
  seq: number,
  bogoSeq: number,
  miSeq: number,
): BogoMenuItemDB => ({
  uuid: uSeq(seq),
  bogoUuid: uSeq(bogoSeq),
  menuItemUuid: uSeq(miSeq),
})

const makeTable = (seq: number, name: string): TableDB => ({
  uuid: uSeq(seq),
  name,
})

const run = (overrides: {
  tickets?: CompleteTicket[]
  ticketMenuItems?: TicketMenuItemDB[]
  menuItems?: MenuItemDB[]
  bogoMenuItems?: BogoMenuItemDB[]
  ticketPromotions?: TicketPromotionDB[]
  promotions?: PromotionDB[]
  tables?: TableDB[]
  modifiers?: MenuItemModifierGroupModifierDB[]
  ticketMenuItemsModifier?: TicketMenuItemModifierDB[]
  comboComboMenuItems?: ComboComboMenuItemDB[]
  tipPercentage?: number
  taxPercentage?: number
}) =>
  calculateLocationTickets({
    tickets: overrides.tickets ?? [],
    ticketMenuItems: overrides.ticketMenuItems ?? [],
    menuItems: overrides.menuItems ?? [],
    bogoMenuItems: overrides.bogoMenuItems ?? [],
    ticketPromotions: overrides.ticketPromotions ?? [],
    promotions: overrides.promotions ?? [],
    tables: overrides.tables ?? [],
    modifiers: overrides.modifiers ?? [],
    ticketMenuItemsModifier: overrides.ticketMenuItemsModifier ?? [],
    comboComboMenuItems: overrides.comboComboMenuItems ?? [],
    tipPercentage: overrides.tipPercentage ?? 0,
    taxPercentage: overrides.taxPercentage ?? 0,
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
    expect(ts[0]!.totalCents).toBe(0)
  })
})

// ---------- BASIC ITEMS ----------

describe('basic items', () => {
  it('one item', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 50)],
    })
    expect(ts).toHaveLength(1)
    expect(ts[0]!.totalCents).toBe(10 * 100 + 50)
    expect(ts[0]!.menuItems).toHaveLength(1)
  })

  it('multiple items sum', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20), makeTMI(11, 1, 21), makeTMI(12, 1, 22)],
      menuItems: [makeMenuItem(20, 5, 0), makeMenuItem(21, 3, 50), makeMenuItem(22, 10, 99)],
    })
    expect(ts[0]!.totalCents).toBe(500 + 350 + 1099)
  })

  it('zero price item', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 0, 0)],
    })
    expect(ts[0]!.totalCents).toBe(0)
  })

  it('menu item not found skips silently', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 999)],
      menuItems: [makeMenuItem(20, 10, 0)],
    })
    expect(ts[0]!.menuItems).toHaveLength(0)
  })

  it('item with note', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20, { note: 'No onions' })],
      menuItems: [makeMenuItem(20, 10, 0)],
    })
    expect(ts[0]!.menuItems[0]!.ticketMenuItemNote).toBe('No onions')
  })

  it('item note null', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
    })
    expect(ts[0]!.menuItems[0]!.ticketMenuItemNote).toBeNull()
  })

  it('inactive menu item still priced', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0, { active: false })],
    })
    expect(ts[0]!.totalCents).toBe(1000)
  })

  it('large prices', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 999999, 99)],
    })
    expect(ts[0]!.totalCents).toBe(999999 * 100 + 99)
  })

  it('multiple tickets', () => {
    const ts = run({
      tickets: [makeTicket(1), makeTicket(2)],
      ticketMenuItems: [makeTMI(10, 1, 20), makeTMI(11, 2, 21)],
      menuItems: [makeMenuItem(20, 10, 0), makeMenuItem(21, 20, 0)],
    })
    expect(ts).toHaveLength(2)
    expect(ts[0]!.totalCents).toBe(1000)
    expect(ts[1]!.totalCents).toBe(2000)
  })
})

// ---------- MODIFIERS ----------

describe('modifiers', () => {
  it('one modifier', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      modifiers: [makeMod(30, 20, 2, 0)],
      ticketMenuItemsModifier: [makeTMIMod(40, 10, 30)],
    })
    expect(ts[0]!.totalCents).toBe(1000 + 200)
  })

  it('multiple modifiers', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      modifiers: [makeMod(30, 20, 2, 0), makeMod(31, 20, 1, 50)],
      ticketMenuItemsModifier: [makeTMIMod(40, 10, 30), makeTMIMod(41, 10, 31)],
    })
    expect(ts[0]!.totalCents).toBe(1000 + 200 + 150)
  })

  it('free modifier adds no cost', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      modifiers: [makeMod(30, 20, 0, 0)],
      ticketMenuItemsModifier: [makeTMIMod(40, 10, 30)],
    })
    expect(ts[0]!.totalCents).toBe(1000)
  })

  it('modifier for different menuItem ignored', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0), makeMenuItem(21, 5, 0)],
      modifiers: [makeMod(30, 21, 5, 0)],
      ticketMenuItemsModifier: [makeTMIMod(40, 10, 30)],
    })
    expect(ts[0]!.totalCents).toBe(1000)
  })

  it('modifier amountRequired propagated', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      modifiers: [makeMod(30, 20, 0, 0, 3)],
      ticketMenuItemsModifier: [makeTMIMod(40, 10, 30)],
    })
    expect(ts[0]!.menuItems[0]!.modifierGroupAmountRequired).toBe(3)
  })

  it('available modifiers populated', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      modifiers: [makeMod(30, 20, 0, 0), makeMod(31, 20, 0, 0)],
    })
    expect(ts[0]!.menuItems[0]!.availableModifiers).toHaveLength(2)
  })
})

// ---------- TABLES ----------

describe('tables', () => {
  it('table name lookup', () => {
    const ts = run({
      tickets: [makeTicket(1, { tableUuid: uSeq(50) })],
      tables: [makeTable(50, 'Patio-3')],
    })
    expect(ts[0]!.tableName).toBe('Patio-3')
  })

  it('no table uuid -> no table name', () => {
    const ts = run({ tickets: [makeTicket(1)] })
    expect(ts[0]!.tableName).toBeUndefined()
  })

  it('numeric sort', () => {
    const ts = run({
      tickets: [
        makeTicket(1, { tableUuid: uSeq(51) }),
        makeTicket(2, { tableUuid: uSeq(52) }),
        makeTicket(3, { tableUuid: uSeq(53) }),
      ],
      tables: [
        makeTable(51, '2'),
        makeTable(52, '10'),
        makeTable(53, '1'),
      ],
    })
    expect(ts[0]!.tableName).toBe('1')
    expect(ts[1]!.tableName).toBe('2')
    expect(ts[2]!.tableName).toBe('10')
  })

  it('alpha sort', () => {
    const ts = run({
      tickets: [
        makeTicket(1, { tableUuid: uSeq(51) }),
        makeTicket(2, { tableUuid: uSeq(52) }),
        makeTicket(3, { tableUuid: uSeq(53) }),
      ],
      tables: [
        makeTable(51, 'Zebra'),
        makeTable(52, 'Alpha'),
        makeTable(53, 'Bravo'),
      ],
    })
    expect(ts[0]!.tableName).toBe('Alpha')
    expect(ts[1]!.tableName).toBe('Bravo')
    expect(ts[2]!.tableName).toBe('Zebra')
  })

  it('empty table names last', () => {
    const ts = run({
      tickets: [
        makeTicket(1, { tableUuid: uSeq(51) }),
        makeTicket(2),
        makeTicket(3, { tableUuid: uSeq(52) }),
      ],
      tables: [
        makeTable(51, '3'),
        makeTable(52, '1'),
      ],
    })
    expect(ts[0]!.tableName).toBe('1')
    expect(ts[1]!.tableName).toBe('3')
    expect(ts[2]!.tableName).toBeUndefined()
  })

  it('mixed sort numbers then text', () => {
    const ts = run({
      tickets: [
        makeTicket(1, { tableUuid: uSeq(51) }),
        makeTicket(2, { tableUuid: uSeq(52) }),
        makeTicket(3, { tableUuid: uSeq(53) }),
        makeTicket(4, { tableUuid: uSeq(54) }),
      ],
      tables: [
        makeTable(51, 'Patio-1'),
        makeTable(52, '3'),
        makeTable(53, '15'),
        makeTable(54, '1'),
      ],
    })
    expect(ts[0]!.tableName).toBe('1')
    expect(ts[1]!.tableName).toBe('3')
    expect(ts[2]!.tableName).toBe('15')
    expect(ts[3]!.tableName).toBe('Patio-1')
  })

  it('tiebreak with same table name', () => {
    const ts = run({
      tickets: [
        makeTicket(1, { tableUuid: uSeq(51) }),
        makeTicket(2, { tableUuid: uSeq(51) }),
      ],
      tables: [makeTable(51, 'Same')],
    })
    expect(ts[0]!.tableName).toBe('Same')
    expect(ts[1]!.tableName).toBe('Same')
  })
})

// ---------- PROMOTIONS ----------

describe('promotions on items', () => {
  it('fixed discount', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      ticketPromotions: [makeTP(50, 1, 60, { ticketMenuItemUuid: uSeq(10) })],
      promotions: [makePromo(60, { discountWhole: 3 })],
    })
    expect(ts[0]!.menuItems[0]!.priceWhole).toBe(7)
    expect(ts[0]!.menuItems[0]!.originalPriceWhole).toBe(10)
    expect(ts[0]!.totalCents).toBe(700)
  })

  it('percentage discount', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 20, 0)],
      ticketPromotions: [makeTP(50, 1, 60, { ticketMenuItemUuid: uSeq(10) })],
      promotions: [makePromo(60, { promotionIsPercentage: true, discountPercent: 25 })],
    })
    expect(ts[0]!.menuItems[0]!.priceWhole).toBe(15)
    expect(ts[0]!.totalCents).toBe(1500)
  })

  it('percentage rounding', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 99)],
      ticketPromotions: [makeTP(50, 1, 60, { ticketMenuItemUuid: uSeq(10) })],
      promotions: [makePromo(60, { promotionIsPercentage: true, discountPercent: 33 })],
    })
    const cents = 10 * 100 + 99
    const disc = Math.floor((cents * 33) / 100)
    expect(ts[0]!.totalCents).toBe(cents - disc)
  })

  it('promotion not found skips', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      ticketPromotions: [makeTP(50, 1, 999)],
      promotions: [],
    })
    expect(ts[0]!.totalCents).toBe(1000)
  })

  it('loyalty type promo on item does NOT apply discount', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      ticketPromotions: [makeTP(50, 1, 60, { ticketMenuItemUuid: uSeq(10) })],
      promotions: [makePromo(60, { type: 'LOYALTY', discountWhole: 3 })],
    })
    expect(ts[0]!.totalCents).toBe(1000)
    expect(ts[0]!.menuItems[0]!.appliedPromotions).toHaveLength(1)
  })
})

// ---------- ITEMLESS PROMOTIONS ----------

describe('itemless promotions', () => {
  it('itemless reward applied', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 20, 0)],
      ticketPromotions: [makeTP(50, 1, 60)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, discountWhole: 5 })],
    })
    expect(ts[0]!.totalCents).toBe(2000 - 500)
    expect(ts[0]!.appliedPromotions).toHaveLength(1)
  })

  it('itemless only for REWARD type', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      ticketPromotions: [makeTP(50, 1, 60)],
      promotions: [makePromo(60, { type: 'PROMOTION', itemless: true })],
    })
    expect(ts[0]!.totalCents).toBe(1000)
  })

  it('itemless linked to ticket no items (zero discount)', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [],
      menuItems: [],
      ticketPromotions: [makeTP(50, 1, 60)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, discountWhole: 0 })],
    })
    expect(ts[0]!.appliedPromotions).toHaveLength(1)
  })

  it('multiple itemless promos on same ticket', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 30, 0)],
      ticketPromotions: [makeTP(50, 1, 60), makeTP(51, 1, 61)],
      promotions: [
        makePromo(60, { type: 'REWARD', itemless: true, discountWhole: 5 }),
        makePromo(61, { type: 'REWARD', itemless: true, discountWhole: 3 }),
      ],
    })
    expect(ts[0]!.totalCents).toBe(3000 - 500 - 300)
    expect(ts[0]!.appliedPromotions).toHaveLength(2)
  })
})

// ---------- INACTIVE + ORIGINAL PRICE ----------

describe('inactive and original price', () => {
  it('inactive promo ineligible', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      promotions: [makePromo(60, { type: 'REWARD', active: false })],
    })
    expect(ts[0]!.eligablePromotions).toHaveLength(0)
    expect(ts[0]!.ineligablePromotions).toHaveLength(1)
  })

  it('original price preserved after discount', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 25, 50)],
      ticketPromotions: [makeTP(50, 1, 60, { ticketMenuItemUuid: uSeq(10) })],
      promotions: [makePromo(60, { promotionIsPercentage: true, discountPercent: 20 })],
    })
    expect(ts[0]!.menuItems[0]!.originalPriceWhole).toBe(25)
    expect(ts[0]!.menuItems[0]!.priceWhole).not.toBe(25)
  })

  it('regular promo no bogo no itemless -> ineligible', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      promotions: [makePromo(60, { type: 'PROMOTION', itemless: false })],
    })
    expect(ts[0]!.eligablePromotions).toHaveLength(0)
    expect(ts[0]!.ineligablePromotions).toHaveLength(1)
  })
})

// ---------- BOGO ----------

describe('bogo', () => {
  it('bogo buy eligible', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      bogoMenuItems: [makeBogo(80, 60, 20)],
      promotions: [makePromo(60, { type: 'PROMOTION', bogoBuy: uSeq(60) })],
    })
    expect(ts[0]!.eligablePromotions).toHaveLength(1)
  })

  it('bogo not eligible when already applied', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      bogoMenuItems: [makeBogo(80, 60, 20)],
      ticketPromotions: [makeTP(50, 1, 60, { ticketMenuItemUuid: uSeq(10) })],
      promotions: [makePromo(60, { type: 'PROMOTION', bogoBuy: uSeq(60) })],
    })
    expect(ts[0]!.eligablePromotions).toHaveLength(0)
  })

  it('bogo reward insufficient points', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 5 })],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      bogoMenuItems: [makeBogo(80, 60, 20)],
      promotions: [makePromo(60, { type: 'REWARD', bogoGet: uSeq(60), pointsRequired: 100 })],
    })
    expect(ts[0]!.eligablePromotions).toHaveLength(0)
  })

  it('bogo get eligible', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 100 })],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      bogoMenuItems: [makeBogo(80, 60, 20)],
      promotions: [makePromo(60, { type: 'REWARD', bogoGet: uSeq(60), pointsRequired: 50 })],
    })
    expect(ts[0]!.eligablePromotions).toHaveLength(1)
  })

  it('bogo buy uuid not matching', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      bogoMenuItems: [makeBogo(80, 99, 20)],
      promotions: [makePromo(60, { type: 'PROMOTION', bogoBuy: uSeq(60) })],
    })
    expect(ts[0]!.eligablePromotions).toHaveLength(0)
  })

  it('bogo get uuid not matching', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 100 })],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      bogoMenuItems: [makeBogo(80, 99, 20)],
      promotions: [makePromo(60, { type: 'REWARD', bogoGet: uSeq(60), pointsRequired: 0 })],
    })
    expect(ts[0]!.eligablePromotions).toHaveLength(0)
  })
})

// ---------- POINTS ----------

describe('points', () => {
  it('points with multiplier', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 100 })],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      promotions: [makePromo(60, { type: 'LOYALTY', pointsMultiplier: 5 })],
    })
    const want = Math.floor((1000 * 5) / 100)
    expect(ts[0]!.totalPoints).toBe(want)
    expect(ts[0]!.endPoints).toBe(100 + want)
  })

  it('no multiplier', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 50 })],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
    })
    expect(ts[0]!.totalPoints).toBe(0)
    expect(ts[0]!.endPoints).toBe(50)
  })

  it('redeemed points', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 200 })],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 20, 0)],
      ticketPromotions: [makeTP(50, 1, 60)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, pointsRequired: 50, discountWhole: 5 })],
    })
    expect(ts[0]!.redeemedPoints).toBe(50)
    expect(ts[0]!.guestsPoints).toBe(200)
  })

  it('best multiplier selected', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      promotions: [
        makePromo(60, { type: 'LOYALTY', pointsMultiplier: 2 }),
        makePromo(61, { type: 'LOYALTY', pointsMultiplier: 10 }),
        makePromo(62, { type: 'LOYALTY', pointsMultiplier: 5 }),
      ],
    })
    expect(ts[0]!.totalPoints).toBe(Math.floor((1000 * 10) / 100))
  })

  it('inactive loyalty ignored', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      promotions: [
        makePromo(60, { type: 'LOYALTY', pointsMultiplier: 3 }),
        makePromo(61, { type: 'LOYALTY', active: false, pointsMultiplier: 100 }),
      ],
    })
    expect(ts[0]!.totalPoints).toBe(Math.floor((1000 * 3) / 100))
  })

  it('zero guest points', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 0 })],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      promotions: [makePromo(60, { type: 'LOYALTY', pointsMultiplier: 3 })],
    })
    expect(ts[0]!.guestsPoints).toBe(0)
    expect(ts[0]!.endPoints).toBe(ts[0]!.totalPoints)
  })
})

// ---------- TIP / TAX ----------

describe('tip / tax', () => {
  it('tip applied for eatin fulfillment', () => {
    const ts = run({
      tickets: [makeTicket(1, { fulfillmentUuid: EATIN })],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 20, 0)],
      tipPercentage: 15,
    })
    expect(ts[0]!.tipTotal).toBe('3.00')
  })

  it('no tip for non-eatin', () => {
    const ts = run({
      tickets: [makeTicket(1, { fulfillmentUuid: uSeq(99) })],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 20, 0)],
      tipPercentage: 15,
    })
    expect(ts[0]!.tipTotal).toBe('0.00')
  })

  it('no tip when fulfillment uuid empty', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      tipPercentage: 15,
    })
    expect(ts[0]!.tipTotal).toBe('0.00')
  })

  it('tax applied', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 20, 0)],
      taxPercentage: 10,
    })
    expect(ts[0]!.taxTotalCents).toBe(Math.floor((10 * 2000) / 100))
    expect(ts[0]!.taxTotal).toBe('2.00')
  })

  it('tip and tax together', () => {
    const ts = run({
      tickets: [makeTicket(1, { fulfillmentUuid: EATIN })],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 20, 0)],
      tipPercentage: 15,
      taxPercentage: 10,
    })
    const tot = 2000
    const tip = Math.floor((15 * tot) / 100)
    const tax = Math.floor((10 * tot) / 100)
    expect(ts[0]!.grandTotalCents).toBe(tot + tip + tax)
  })

  it('zero tip and tax', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
    })
    expect(ts[0]!.grandTotalCents).toBe(1000)
  })
})

// ---------- ELIGIBILITY ----------

describe('eligibility', () => {
  it('reward eligible with enough grand total and points', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 100 })],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 20, 0)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, discountWhole: 5, pointsRequired: 50 })],
    })
    expect(ts[0]!.eligablePromotions).toHaveLength(1)
  })

  it('reward ineligible when grand total too small', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 100 })],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 3, 0)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, discountWhole: 10, pointsRequired: 50 })],
    })
    expect(ts[0]!.eligablePromotions).toHaveLength(0)
  })

  it('already applied promo not eligible again', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 100 })],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 20, 0)],
      ticketPromotions: [makeTP(50, 1, 60)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, discountWhole: 5, pointsRequired: 50 })],
    })
    for (const ep of ts[0]!.eligablePromotions) {
      expect(ep.uuid).not.toBe(uSeq(60))
    }
  })
})

// ---------- GUEST INFO ----------

describe('guest info', () => {
  it('guest info passthrough', () => {
    const ts = run({
      tickets: [makeTicket(1, {
        userName: 'jdoe',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@ex.com',
        phone: '+15551234567',
        fulfillmentType: 'delivery',
        address: '123 Main',
      })],
    })
    expect(ts[0]!.userName).toBe('jdoe')
    expect(ts[0]!.firstName).toBe('John')
    expect(ts[0]!.lastName).toBe('Doe')
    expect(ts[0]!.email).toBe('john@ex.com')
    expect(ts[0]!.phone).toBe('+15551234567')
    expect(ts[0]!.fulfillmentType).toBe('delivery')
    expect(ts[0]!.address).toBe('123 Main')
  })

  it('guest info empty strings', () => {
    const ts = run({ tickets: [makeTicket(1)] })
    expect(ts[0]!.userName).toBe('')
    expect(ts[0]!.firstName).toBe('')
  })
})

// ---------- SINGLE-DIGIT CENTS ----------

describe('single-digit cents formatting', () => {
  it('total and grand total', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 0, 5)],
    })
    expect(ts[0]!.total).toBe('0.05')
    expect(ts[0]!.grandTotal).toBe('0.05')
  })

  it('tip cents', () => {
    const ts = run({
      tickets: [makeTicket(1, { fulfillmentUuid: EATIN })],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 0, 5)],
      tipPercentage: 50,
    })
    expect(ts[0]!.tipTotal).toBe('0.02')
  })

  it('tax cents', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 0, 5)],
      taxPercentage: 50,
    })
    expect(ts[0]!.taxTotal).toBe('0.02')
  })
})

// ---------- TABLE UUID NOT IN MAP ----------

describe('table edge cases', () => {
  it('table uuid valid but not in map', () => {
    const ts = run({
      tickets: [makeTicket(1, { tableUuid: uSeq(99) })],
      tables: [],
    })
    expect(ts[0]!.tableName).toBeUndefined()
  })
})

// ---------- TICKET-FILTERED ITEMS ----------

describe('ticket menu item filtering', () => {
  it('tmi belongs to different ticket', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 2, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
    })
    expect(ts[0]!.menuItems).toHaveLength(0)
    expect(ts[0]!.totalCents).toBe(0)
  })
})

// ---------- TICKET FIELDS ----------

describe('ticket fields passthrough', () => {
  it('all ticket fields', () => {
    const ts = run({
      tickets: [{
        uuid: uSeq(1),
        id: 5001,
        timeStamp: '2026-06-15T10:30:00.000Z',
        status: 'COMPLETE',
        locationGroupUuid: uSeq(2),
        locationUuid: uSeq(3),
        appUniqueUuid: uSeq(4),
        fulfillmentUuid: uSeq(5),
        guestUuid: uSeq(6),
        guestAddressUuid: uSeq(7),
        tableUuid: '',
        userName: '',
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        address: '',
        fulfillmentType: '',
        anonymousAddress: '123 Privet Dr',
        points: 0,
        paymentUuid: 'pay_abc',
      }],
    })
    expect(ts[0]!.uuid).toBe(uSeq(1))
    expect(ts[0]!.id).toBe(5001)
    expect(ts[0]!.timeStamp).toBe('2026-06-15T10:30:00.000Z')
    expect(ts[0]!.status).toBe('COMPLETE')
    expect(ts[0]!.anonymousAddress).toBe('123 Privet Dr')
    expect(ts[0]!.paymentUuid).toBe('pay_abc')
  })
})

// ---------- COMBO ----------

describe('combos', () => {
  it('combo items removed from pricing', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20), makeTMI(11, 1, 21)],
      menuItems: [makeMenuItem(20, 5, 0), makeMenuItem(21, 3, 0)],
      comboComboMenuItems: [
        { uuid: uSeq(100), name: 'Meal', description: '', active: true, priceWhole: 7, priceHundredths: 0, comboUuid: uSeq(110), menuItemUuid: uSeq(20) },
        { uuid: uSeq(101), name: 'Meal', description: '', active: true, priceWhole: 7, priceHundredths: 0, comboUuid: uSeq(110), menuItemUuid: uSeq(21) },
      ],
    })
    expect(ts[0]!.combos).toHaveLength(1)
    expect(ts[0]!.totalCents).toBe(700)
  })

  it('combo consumes some items leaves standalone', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20), makeTMI(11, 1, 21), makeTMI(12, 1, 22)],
      menuItems: [makeMenuItem(20, 5, 0), makeMenuItem(21, 3, 0), makeMenuItem(22, 8, 0)],
      comboComboMenuItems: [
        { uuid: uSeq(100), name: 'Meal', description: '', active: true, priceWhole: 7, priceHundredths: 0, comboUuid: uSeq(110), menuItemUuid: uSeq(20) },
        { uuid: uSeq(101), name: 'Meal', description: '', active: true, priceWhole: 7, priceHundredths: 0, comboUuid: uSeq(110), menuItemUuid: uSeq(21) },
      ],
    })
    expect(ts[0]!.totalCents).toBe(1500)
  })
})

// ---------- NEGATIVE GRAND TOTAL RECOVERY ----------

describe('negative grand total recovery', () => {
  it('removes itemless promotions to recover from negative', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 5, 0)],
      ticketPromotions: [makeTP(50, 1, 60)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, discountWhole: 100 })],
    })
    expect(ts[0]!.grandTotalCents).toBeGreaterThanOrEqual(0)
  })

  it('recovers with percentage itemless promotion', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 5, 0)],
      ticketPromotions: [makeTP(50, 1, 60)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, promotionIsPercentage: true, discountPercent: 200 })],
    })
    expect(ts[0]!.grandTotalCents).toBeGreaterThanOrEqual(0)
  })

  it('recovers with multiple itemless promos, stops when grandTotal >= 0', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      ticketPromotions: [makeTP(50, 1, 60), makeTP(51, 1, 61)],
      promotions: [
        makePromo(60, { type: 'REWARD', itemless: true, discountWhole: 12 }),
        makePromo(61, { type: 'REWARD', itemless: true, discountWhole: 12 }),
      ],
    })
    expect(ts[0]!.grandTotalCents).toBeGreaterThanOrEqual(0)
  })
})

// ---------- ITEM DESCRIPTION ----------

describe('item description', () => {
  it('description passthrough', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0, { description: 'Tasty food' })],
    })
    expect(ts[0]!.menuItems[0]!.description).toBe('Tasty food')
  })
})

// ---------- NEGATIVE GRAND TOTAL, NO ITEMLESS ----------

describe('negative grand total no itemless recovery', () => {
  it('stays negative when no itemless promos exist', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 5, 0)],
      ticketPromotions: [makeTP(50, 1, 60, { ticketMenuItemUuid: uSeq(10) })],
      promotions: [makePromo(60, { discountWhole: 100 })],
    })
    expect(ts[0]!.grandTotalCents).toBeLessThan(0)
  })

  it('all itemless removed still negative', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 5, 0)],
      ticketPromotions: [
        makeTP(50, 1, 60, { ticketMenuItemUuid: uSeq(10) }),
        makeTP(51, 1, 61),
      ],
      promotions: [
        makePromo(60, { type: 'REWARD', discountPercent: 200, promotionIsPercentage: true }),
        makePromo(61, { type: 'REWARD', itemless: true, discountWhole: 1000 }),
      ],
    })
    expect(ts[0]!.grandTotalCents).toBeLessThan(0)
  })
})

// ---------- ITEMLESS ELIGIBILITY EDGES ----------

describe('itemless eligibility edges', () => {
  it('percentage itemless reward eligible (discountWhole=0 <= grandTotal)', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 50 })],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, promotionIsPercentage: true, discountPercent: 20, pointsRequired: 10 })],
    })
    expect(ts[0]!.eligablePromotions).toHaveLength(1)
  })

  it('itemless reward ineligible when insufficient points', () => {
    const ts = run({
      tickets: [makeTicket(1, { points: 5 })],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 20, 0)],
      promotions: [makePromo(60, { type: 'REWARD', itemless: true, discountWhole: 5, pointsRequired: 50 })],
    })
    expect(ts[0]!.eligablePromotions).toHaveLength(0)
  })
})

// ---------- BOGO INACTIVE ----------

describe('bogo inactive', () => {
  it('inactive bogo promo ineligible', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 10, 0)],
      bogoMenuItems: [makeBogo(80, 60, 20)],
      promotions: [makePromo(60, { type: 'PROMOTION', active: false, bogoBuy: uSeq(60) })],
    })
    expect(ts[0]!.eligablePromotions).toHaveLength(0)
    expect(ts[0]!.ineligablePromotions).toHaveLength(1)
  })
})

// ---------- COMBO EDGES ----------

describe('combo edges', () => {
  it('multiple combo groups', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20), makeTMI(11, 1, 21), makeTMI(12, 1, 22), makeTMI(13, 1, 23)],
      menuItems: [makeMenuItem(20, 5, 0), makeMenuItem(21, 3, 0), makeMenuItem(22, 4, 0), makeMenuItem(23, 6, 0)],
      comboComboMenuItems: [
        { uuid: uSeq(100), name: 'Meal', description: 'combo1 desc', active: true, priceWhole: 7, priceHundredths: 0, comboUuid: uSeq(110), menuItemUuid: uSeq(20) },
        { uuid: uSeq(101), name: 'Meal', description: 'combo1 desc', active: true, priceWhole: 7, priceHundredths: 0, comboUuid: uSeq(110), menuItemUuid: uSeq(21) },
        { uuid: uSeq(102), name: 'Drink', description: 'combo2 desc', active: true, priceWhole: 5, priceHundredths: 0, comboUuid: uSeq(111), menuItemUuid: uSeq(22) },
        { uuid: uSeq(103), name: 'Drink', description: 'combo2 desc', active: true, priceWhole: 5, priceHundredths: 0, comboUuid: uSeq(111), menuItemUuid: uSeq(23) },
      ],
    })
    expect(ts[0]!.combos).toHaveLength(2)
    expect(ts[0]!.menuItems).toHaveLength(0)
    // combo1 = Meal (700) + combo2 = Drink (500)
    expect(ts[0]!.totalCents).toBe(1200)
  })

  it('inactive combo combo menu item still consumed', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20), makeTMI(11, 1, 21)],
      menuItems: [makeMenuItem(20, 5, 0), makeMenuItem(21, 3, 0)],
      comboComboMenuItems: [
        { uuid: uSeq(100), name: 'Meal', description: '', active: false, priceWhole: 7, priceHundredths: 0, comboUuid: uSeq(110), menuItemUuid: uSeq(20) },
        { uuid: uSeq(101), name: 'Meal', description: '', active: false, priceWhole: 7, priceHundredths: 0, comboUuid: uSeq(110), menuItemUuid: uSeq(21) },
      ],
    })
    expect(ts[0]!.combos).toHaveLength(1)
    expect(ts[0]!.combos[0]!.active).toBe(false)
    expect(ts[0]!.menuItems).toHaveLength(0)
  })

  it('combo description passthrough', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20), makeTMI(11, 1, 21)],
      menuItems: [makeMenuItem(20, 5, 0), makeMenuItem(21, 3, 0)],
      comboComboMenuItems: [
        { uuid: uSeq(100), name: 'Meal', description: 'Combo deal desc', active: true, priceWhole: 7, priceHundredths: 0, comboUuid: uSeq(110), menuItemUuid: uSeq(20) },
        { uuid: uSeq(101), name: 'Meal', description: 'Combo deal desc', active: true, priceWhole: 7, priceHundredths: 0, comboUuid: uSeq(110), menuItemUuid: uSeq(21) },
      ],
    })
    expect(ts[0]!.combos[0]!.description).toBe('Combo deal desc')
  })

  it('repeated combo instances from same group', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [
        makeTMI(10, 1, 20), makeTMI(11, 1, 21),
        makeTMI(12, 1, 20), makeTMI(13, 1, 21),
      ],
      menuItems: [makeMenuItem(20, 5, 0), makeMenuItem(21, 3, 0)],
      comboComboMenuItems: [
        { uuid: uSeq(100), name: 'Meal', description: '', active: true, priceWhole: 7, priceHundredths: 0, comboUuid: uSeq(110), menuItemUuid: uSeq(20) },
        { uuid: uSeq(101), name: 'Meal', description: '', active: true, priceWhole: 7, priceHundredths: 0, comboUuid: uSeq(110), menuItemUuid: uSeq(21) },
      ],
    })
    expect(ts[0]!.combos).toHaveLength(2)
    expect(ts[0]!.menuItems).toHaveLength(0)
  })
})

// ---------- FORMAT EDGE CASES ----------

describe('format edge cases', () => {
  it('format zero', () => {
    const ts = run({ tickets: [makeTicket(1)] })
    expect(ts[0]!.total).toBe('0.00')
    expect(ts[0]!.grandTotal).toBe('0.00')
  })

  it('format ninety nine cents', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 0, 99)],
    })
    expect(ts[0]!.total).toBe('0.99')
  })

  it('format exact dollar', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 1, 0)],
    })
    expect(ts[0]!.total).toBe('1.00')
  })

  it('format dollars and cents', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20)],
      menuItems: [makeMenuItem(20, 19, 99)],
    })
    expect(ts[0]!.total).toBe('19.99')
  })
})

// ---------- POINTS NULL/UNDEFINED ----------

describe('points fallback', () => {
  it('points zero when not provided', () => {
    const ts = run({
      tickets: [{
        uuid: uSeq(1), id: 1001, timeStamp: '', status: 'COMPLETE',
        locationGroupUuid: '', locationUuid: '', appUniqueUuid: '',
        fulfillmentUuid: '', fulfillmentType: '', guestUuid: '',
        guestAddressUuid: '', tableUuid: '', userName: '', firstName: '',
        lastName: '', email: '', phone: '', address: '', anonymousAddress: '',
        points: undefined as unknown as number, paymentUuid: '',
      }],
    })
    expect(ts[0]!.guestsPoints).toBe(0)
  })
})

// ---------- LOYALTY TYPE IN ELIGIBILITY ----------

describe('loyalty type eligibility', () => {
  it('LOYALTY promo falls to ineligable (no bogo, no itemless, no BOGO buy/get)', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      promotions: [makePromo(60, { type: 'LOYALTY', pointsMultiplier: 2 })],
    })
    expect(ts[0]!.eligablePromotions).toHaveLength(0)
    expect(ts[0]!.ineligablePromotions).toHaveLength(1)
  })
})

// ---------- CALCULATE COMBOS INTERNAL EDGES ----------

describe('calculateCombos internal edges', () => {
  it('count tiebreak sorts by uuid descending (larger uuid wins when same count)', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [
        makeTMI(10, 1, 20), makeTMI(11, 1, 21),
        makeTMI(12, 1, 22), makeTMI(13, 1, 23),
      ],
      menuItems: [
        makeMenuItem(20, 5, 0), makeMenuItem(21, 3, 0),
        makeMenuItem(22, 4, 0), makeMenuItem(23, 6, 0),
      ],
      comboComboMenuItems: [
        { uuid: uSeq(100), name: 'A', description: '', active: true, priceWhole: 7, priceHundredths: 0, comboUuid: uSeq(150), menuItemUuid: uSeq(20) },
        { uuid: uSeq(101), name: 'A', description: '', active: true, priceWhole: 7, priceHundredths: 0, comboUuid: uSeq(150), menuItemUuid: uSeq(21) },
        { uuid: uSeq(102), name: 'B', description: '', active: true, priceWhole: 5, priceHundredths: 0, comboUuid: uSeq(151), menuItemUuid: uSeq(22) },
        { uuid: uSeq(103), name: 'B', description: '', active: true, priceWhole: 5, priceHundredths: 0, comboUuid: uSeq(151), menuItemUuid: uSeq(23) },
      ],
    })
    expect(ts[0]!.combos).toHaveLength(2)
  })

  it('combo menuItem not found in menuItems still consumed', () => {
    const ts = run({
      tickets: [makeTicket(1)],
      ticketMenuItems: [makeTMI(10, 1, 20), makeTMI(11, 1, 21)],
      menuItems: [makeMenuItem(21, 3, 0)],
      comboComboMenuItems: [
        { uuid: uSeq(100), name: 'Meal', description: '', active: true, priceWhole: 7, priceHundredths: 0, comboUuid: uSeq(110), menuItemUuid: uSeq(20) },
        { uuid: uSeq(101), name: 'Meal', description: '', active: true, priceWhole: 7, priceHundredths: 0, comboUuid: uSeq(110), menuItemUuid: uSeq(21) },
      ],
    })
    expect(ts[0]!.combos).toHaveLength(1)
    expect(ts[0]!.combos[0]!.comboMenuItems).toHaveLength(1)
    expect(ts[0]!.combos[0]!.comboMenuItems[0]!.menuItemUuid).toBe(uSeq(21))
    expect(ts[0]!.combos[0]!.comboMenuItems[0]!.name).toBe('Item')
    expect(ts[0]!.menuItems).toHaveLength(0)
  })
})
