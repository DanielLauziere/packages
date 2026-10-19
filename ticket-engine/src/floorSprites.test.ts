import { describe, expect, it } from 'vitest'
import {
  FLOOR_ROOMS,
  FLOOR_SIZE_DEFAULT,
  FLOOR_SIZE_MULTIPLIERS,
  FLOOR_SPRITES,
  MAX_FLOOR_ITEMS,
  countOpenTicketsByTable,
  floorContentBox,
  floorItemBox,
  floorRotatedSize,
  floorSpriteKind,
  floorSpriteSize,
  isFloorTableSprite,
  isTableActive,
  normalizeFloorSize,
  placedTableUuids,
  ticketStartActions,
  unplacedTables,
  validateFloorItems,
  type FloorItem,
} from './floorSprites.js'

const TABLE_UUID = '00000000-0000-0000-0000-0000000000f1'
const KNOWN_TABLES = new Set([TABLE_UUID])

function item(overrides: Partial<FloorItem> = {}): FloorItem {
  return { uuid: 'i1', sprite: 'PLANT_SMALL', x: 400, y: 400, rotation: 0, size: FLOOR_SIZE_DEFAULT, ...overrides }
}

describe('sprite catalog', () => {
  it('locks the 14 sprite names (app asset contract)', () => {
    expect(Object.keys(FLOOR_SPRITES)).toHaveLength(14)
    for (const name of [
      'TABLE_SQUARE_TWO_CHAIR',
      'TABLE_SQUARE_EIGHT_CHAIR',
      'BAR',
      'WALL_1_METER',
      'WALL_4_METER',
      'PLANT_SMALL',
      'PLANT_LARGE',
    ]) {
      expect(FLOOR_SPRITES).toHaveProperty(name)
    }
    // Round tables were dropped from the locked catalog — square only now.
    expect(FLOOR_SPRITES).not.toHaveProperty('TABLE_ROUND_FOUR_CHAIR')
  })

  it('classifies kinds by name', () => {
    expect(floorSpriteKind('TABLE_SQUARE_FOUR_CHAIR')).toBe('table')
    expect(floorSpriteKind('BAR')).toBe('bar')
    expect(floorSpriteKind('WALL_2_METER')).toBe('wall')
    expect(floorSpriteKind('PLANT_LARGE')).toBe('plant')
    expect(floorSpriteKind('NOPE')).toBeNull()
    expect(isFloorTableSprite('TABLE_SQUARE_TWO_CHAIR')).toBe(true)
    expect(isFloorTableSprite('BAR')).toBe(true)
    expect(isFloorTableSprite('PLANT_SMALL')).toBe(false)
  })

  it('matches the Go catalog footprints (spot check)', () => {
    expect(FLOOR_SPRITES.TABLE_SQUARE_TWO_CHAIR).toEqual({ w: 120, h: 100, kind: 'table' })
    expect(FLOOR_SPRITES.WALL_4_METER).toEqual({ w: 400, h: 20, kind: 'wall' })
    expect(FLOOR_SPRITES.PLANT_SMALL).toEqual({ w: 40, h: 40, kind: 'plant' })
  })
})

describe('floorRotatedSize', () => {
  it('keeps or swaps the footprint on 90° steps', () => {
    expect(floorRotatedSize(100, 20, 0)).toEqual({ w: 100, h: 20 })
    expect(floorRotatedSize(100, 20, 4)).toEqual({ w: 100, h: 20 })
    expect(floorRotatedSize(100, 20, 2)).toEqual({ w: 20, h: 100 })
    expect(floorRotatedSize(100, 20, 6)).toEqual({ w: 20, h: 100 })
  })

  it('grows the bbox on 45° diagonals — ceil((w+h)·√2/2)', () => {
    // ceil(120 · 0.7071…) = 85 — identical integer to the Go side.
    expect(floorRotatedSize(100, 20, 1)).toEqual({ w: 85, h: 85 })
    expect(floorRotatedSize(100, 20, 3)).toEqual({ w: 85, h: 85 })
    expect(floorRotatedSize(80, 80, 7)).toEqual({ w: 114, h: 114 })
  })
})

describe('floorItemBox', () => {
  it('positions the top-left corner from the centre point', () => {
    expect(floorItemBox(item({ sprite: 'PLANT_SMALL', x: 400, y: 400, rotation: 0 }))).toEqual({
      x: 380,
      y: 380,
      w: 40,
      h: 40,
    })
  })
  it('ignores rotation — the render box is the unrotated footprint', () => {
    // A 4 m wall keeps its 400x20 box at every rotation; the renderer spins
    // it with CSS rotate so art never resizes.
    for (const rotation of [0, 1, 2, 3, 4, 5, 6, 7]) {
      expect(floorItemBox(item({ sprite: 'WALL_4_METER', x: 200, y: 100, rotation }))).toEqual({
        x: 0,
        y: 90,
        w: 400,
        h: 20,
      })
    }
  })
  it('returns null for unknown sprites', () => {
    expect(floorItemBox(item({ sprite: 'GHOST' }))).toBeNull()
  })
})

describe('validateFloorItems', () => {
  it('accepts a valid floor and empty floors', () => {
    const items = [
      item({ sprite: 'TABLE_SQUARE_FIVE_CHAIR', x: 100, y: 100, table_uuid: TABLE_UUID }),
      item({ uuid: 'i2', sprite: 'WALL_4_METER', x: 200, y: 50 }),
    ]
    expect(validateFloorItems('SQUARE', items, KNOWN_TABLES)).toBeNull()
    expect(validateFloorItems('SQUARE', [], KNOWN_TABLES)).toBeNull()
  })

  it('rejects unknown room kinds', () => {
    expect(validateFloorItems('PENTAGON', [], KNOWN_TABLES)).toContain('invalidRoomKind')
  })

  it('enforces the item cap', () => {
    const atCap = Array.from({ length: MAX_FLOOR_ITEMS }, (_, i) =>
      item({ x: 20, y: 20 + (i % 700) }),
    )
    expect(validateFloorItems('SQUARE', atCap, KNOWN_TABLES)).toBeNull()
    const overCap = Array.from({ length: MAX_FLOOR_ITEMS + 1 }, () => item())
    expect(validateFloorItems('SQUARE', overCap, KNOWN_TABLES)).toContain('tooManyItems')
  })

  it('rejects unknown sprites', () => {
    expect(validateFloorItems('SQUARE', [item({ sprite: 'TABLE_ROUND_NINE_CHAIR' })], KNOWN_TABLES)).toContain(
      'unknown sprite',
    )
  })

  it('rejects out-of-bounds centres (rotated bbox must fit the room)', () => {
    // 8×8 m room: a 40 cm plant needs its centre ≥ 20 cm from every wall.
    expect(validateFloorItems('SQUARE', [item({ x: 10, y: 400 })], KNOWN_TABLES)).toContain('horizontally')
    expect(validateFloorItems('SQUARE', [item({ x: 790, y: 400 })], KNOWN_TABLES)).toContain('horizontally')
    expect(validateFloorItems('SQUARE', [item({ x: 400, y: 795 })], KNOWN_TABLES)).toContain('vertically')
    // A 4 m wall centred at x=650 hangs past the 8 m wall.
    expect(
      validateFloorItems('SQUARE', [item({ sprite: 'WALL_4_METER', x: 650, y: 400 })], KNOWN_TABLES),
    ).toContain('horizontally')
    // 45° growth counts: PLANT_LARGE at (760,760) is out of bounds at 3.
    expect(
      validateFloorItems('SQUARE', [item({ sprite: 'PLANT_LARGE', x: 760, y: 760, rotation: 3 })], KNOWN_TABLES),
    ).toBeTruthy()
    expect(
      validateFloorItems('SQUARE', [item({ sprite: 'PLANT_LARGE', x: 740, y: 740, rotation: 3 })], KNOWN_TABLES),
    ).toBeNull()
  })

  it('rejects rotation outside 0-7', () => {
    expect(validateFloorItems('SQUARE', [item({ rotation: 8 })], KNOWN_TABLES)).toContain('0-7')
    expect(validateFloorItems('SQUARE', [item({ rotation: -1 })], KNOWN_TABLES)).toContain('0-7')
  })

  it('enforces table binding rules', () => {
    // table_uuid on a non-table sprite
    expect(
      validateFloorItems('SQUARE', [item({ table_uuid: TABLE_UUID })], KNOWN_TABLES),
    ).toContain('TABLE_*')
    // unknown table
    expect(
      validateFloorItems('SQUARE', [item({ sprite: 'TABLE_SQUARE_FIVE_CHAIR', table_uuid: 'dead' })], KNOWN_TABLES),
    ).toContain('does not belong')
    // duplicate binding
    expect(
      validateFloorItems(
        'SQUARE',
        [
          item({ sprite: 'TABLE_SQUARE_FIVE_CHAIR', x: 100, y: 100, table_uuid: TABLE_UUID }),
          item({ uuid: 'i2', sprite: 'TABLE_SQUARE_FOUR_CHAIR', x: 300, y: 300, table_uuid: TABLE_UUID }),
        ],
        KNOWN_TABLES,
      ),
    ).toContain('duplicate')
    // unbound TABLE_* sprite is fine (bind-on-tap comes later)
    expect(validateFloorItems('SQUARE', [item({ sprite: 'TABLE_SQUARE_FIVE_CHAIR', x: 100, y: 100 })], KNOWN_TABLES)).toBeNull()
    // BAR is table-like — a binding on it is valid
    expect(validateFloorItems('SQUARE', [item({ sprite: 'BAR', table_uuid: TABLE_UUID })], KNOWN_TABLES)).toBeNull()
  })
})

describe('placedTableUuids / unplacedTables', () => {
  it('lists bound uuids and filters the tray', () => {
    const items = [item({ sprite: 'TABLE_SQUARE_FIVE_CHAIR', table_uuid: TABLE_UUID })]
    expect(placedTableUuids(items)).toEqual([TABLE_UUID])
    const tables = [
      { uuid: TABLE_UUID, active: true },
      { uuid: 'other', active: true },
      { uuid: 'hidden', active: false },
      { uuid: 'legacy' }, // active undefined → treated active
    ]
    expect(unplacedTables(tables, items).map((t) => t.uuid)).toEqual(['other', 'legacy'])
  })

  it('isTableActive only hides on explicit false', () => {
    expect(isTableActive(undefined)).toBe(false)
    expect(isTableActive({ uuid: 'x' })).toBe(true)
    expect(isTableActive({ uuid: 'x', active: true })).toBe(true)
    expect(isTableActive({ uuid: 'x', active: false })).toBe(false)
  })
})

describe('countOpenTicketsByTable', () => {
  it('counts only tickets at bound tables', () => {
    const items = [item({ sprite: 'TABLE_SQUARE_FIVE_CHAIR', table_uuid: TABLE_UUID })]
    const tickets = [{ table_uuid: TABLE_UUID }, { table_uuid: TABLE_UUID }, { table_uuid: 'elsewhere' }, {}]
    expect(countOpenTicketsByTable(tickets, items)).toEqual({ [TABLE_UUID]: 2 })
  })
})

describe('ticketStartActions', () => {
  it('emits SET_TABLE then SET_FULFILLMENT EATIN', () => {
    expect(ticketStartActions(TABLE_UUID)).toEqual([
      { action: 'SET_TABLE', payload: { table_uuid: TABLE_UUID } },
      { action: 'SET_FULFILLMENT', payload: { fulfillment_uuid: 'ed345e57-4fb1-4111-8603-9c820417ed3e' } },
    ])
  })
})

describe('room templates', () => {
  it('locks the single square template (older kinds are gone)', () => {
    expect(Object.keys(FLOOR_ROOMS)).toEqual(['SQUARE'])
    expect(FLOOR_ROOMS.SQUARE).toEqual({ w: 800, h: 800 })
  })
})

describe('size ladder', () => {
  it('locks the multipliers and the size-5 anchor', () => {
    // ×1/8 steps: 2,3,4,6,8,12,16,24 eighths — exact binary fractions so
    // Go and TS agree with integer math alone.
    expect(FLOOR_SIZE_MULTIPLIERS).toEqual([2, 3, 4, 6, 8, 12, 16, 24])
    expect(FLOOR_SIZE_DEFAULT).toBe(5)
    // Size 5 is ×1: the art's natural footprint — saved layouts render
    // exactly as they did before the ladder existed.
    expect(floorSpriteSize(120, 100, 5)).toEqual({ w: 120, h: 100 })
    expect(floorSpriteSize(400, 20, 5)).toEqual({ w: 400, h: 20 })
  })

  it('spans ×1/4 (size 1, ~50 tables) to ×3 (size 8)', () => {
    expect(floorSpriteSize(120, 100, 1)).toEqual({ w: 30, h: 25 })
    expect(floorSpriteSize(120, 100, 2)).toEqual({ w: 45, h: 38 }) // (100·3+4)/8 = 38
    expect(floorSpriteSize(120, 100, 3)).toEqual({ w: 60, h: 50 })
    expect(floorSpriteSize(120, 100, 4)).toEqual({ w: 90, h: 75 })
    expect(floorSpriteSize(120, 100, 6)).toEqual({ w: 180, h: 150 })
    expect(floorSpriteSize(120, 100, 7)).toEqual({ w: 240, h: 200 })
    expect(floorSpriteSize(120, 100, 8)).toEqual({ w: 360, h: 300 })
  })

  it('normalizes missing/invalid sizes to the default on the read path', () => {
    expect(normalizeFloorSize(undefined)).toBe(FLOOR_SIZE_DEFAULT)
    expect(normalizeFloorSize(null)).toBe(FLOOR_SIZE_DEFAULT)
    expect(normalizeFloorSize(0)).toBe(FLOOR_SIZE_DEFAULT)
    expect(normalizeFloorSize(9)).toBe(FLOOR_SIZE_DEFAULT)
    expect(normalizeFloorSize(5.5)).toBe(FLOOR_SIZE_DEFAULT)
    expect(normalizeFloorSize(7)).toBe(7)
    expect(floorSpriteSize(120, 100, 99)).toEqual({ w: 120, h: 100 })
  })

  it('size 8 fits four smallest tables, one per quadrant, without touching', () => {
    const anchors = [
      { x: 200, y: 200 },
      { x: 600, y: 200 },
      { x: 200, y: 600 },
      { x: 600, y: 600 },
    ]
    const items = anchors.map((a, i) =>
      item({ uuid: `q${i}`, sprite: 'TABLE_SQUARE_TWO_CHAIR', ...a, size: 8 }),
    )
    expect(validateFloorItems('SQUARE', items, KNOWN_TABLES)).toBeNull()
    // 360×300 in a 400×400 quadrant: 40 cm horizontal gap, 100 cm vertical.
    const w = floorSpriteSize(120, 100, 8).w
    const h = floorSpriteSize(120, 100, 8).h
    expect(400 - w).toBe(40)
    expect(400 - h).toBe(100)
  })

  it('bounds use the SIZED footprint: size-8 4 m wall never fits an 8 m room', () => {
    const wall = item({ sprite: 'WALL_4_METER', x: 400, y: 400, size: 8 })
    expect(validateFloorItems('SQUARE', [wall], KNOWN_TABLES)).toContain('horizontally')
    // Size 7 (800 cm) fits flush.
    expect(validateFloorItems('SQUARE', [{ ...wall, size: 7 }], KNOWN_TABLES)).toBeNull()
  })

  it('rejects sizes outside 1-8', () => {
    for (const size of [-1, 0, 9, 5.5]) {
      expect(validateFloorItems('SQUARE', [item({ size })], KNOWN_TABLES)).toContain('size must be')
    }
  })
})

describe('floorContentBox (view-mode crop)', () => {
  it('is null when nothing is placed', () => {
    expect(floorContentBox([])).toBeNull()
  })

  it('returns the tight box of placed items — no padding', () => {
    // One 40 cm plant centred at (400,400) → exactly 40×40 at (380,380).
    expect(floorContentBox([item()])).toEqual({ x: 380, y: 380, w: 40, h: 40 })
  })

  it('produces the documented crop ratios', () => {
    // Items filling only the bottom half, spanning the width → 2:1.
    const bottomHalf = [
      item({ uuid: 'a', sprite: 'WALL_4_METER', x: 200, y: 410, size: 5 }),
      item({ uuid: 'b', sprite: 'WALL_4_METER', x: 600, y: 410, size: 5 }),
      item({ uuid: 'c', sprite: 'PLANT_SMALL', x: 400, y: 780, size: 5 }),
    ]
    const box = floorContentBox(bottomHalf)!
    expect(box).toEqual({ x: 0, y: 400, w: 800, h: 400 })
    expect(box.w / box.h).toBe(2)

    // Items only in the bottom-right quadrant → square (1:1).
    const quadrant = [
      item({ uuid: 'a', sprite: 'PLANT_SMALL', x: 420, y: 420, size: 5 }), // box 400..440
      item({ uuid: 'b', sprite: 'PLANT_SMALL', x: 780, y: 780, size: 5 }), // box 760..800
    ]
    const q = floorContentBox(quadrant)!
    expect(q).toEqual({ x: 400, y: 400, w: 400, h: 400 })
    expect(q.w / q.h).toBe(1)
  })

  it('uses the rotated bbox so a 45° sprite is not clipped', () => {
    // PLANT_LARGE at 45° grows to 114 cm — the crop must cover all of it.
    const box = floorContentBox([item({ sprite: 'PLANT_LARGE', x: 100, y: 100, rotation: 3 })])!
    expect(box.w).toBe(114)
    expect(box.x).toBe(100 - 57)
  })
})
