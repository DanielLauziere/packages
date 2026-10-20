import { describe, expect, it } from 'vitest'
import {
  FLOOR_ROOMS,
  FLOOR_SIZE_DEFAULT,
  floorSpriteSize,
  type FloorItem,
} from './floorSprites.js'
import {
  NEW_TABLE_SPRITE,
  clampFloorCentre,
  findFloorFreeSpot,
  floorBoxesOverlap,
  floorNewItemAt,
  floorSizeFitsRoom,
  floorSpriteBoxAt,
  floorSpriteLabel,
  stepFloorSize,
} from './floorMap.js'

const ROOM = FLOOR_ROOMS.SQUARE // 800×800 cm

const item = (over: Partial<FloorItem> = {}): FloorItem => ({
  uuid: 'i1',
  sprite: 'PLANT_SMALL',
  x: 400,
  y: 400,
  rotation: 0,
  size: FLOOR_SIZE_DEFAULT,
  ...over,
})

describe('floorSpriteBoxAt', () => {
  it('centres the unrotated footprint on the item point', () => {
    // PLANT_SMALL size 5 = 40×40 cm.
    expect(floorSpriteBoxAt(200, 300, 'PLANT_SMALL', 5, 0)).toEqual({
      x: 180,
      y: 280,
      w: 40,
      h: 40,
    })
  })

  it('returns null for unknown sprites', () => {
    expect(floorSpriteBoxAt(0, 0, 'NOPE', 5, 0)).toBeNull()
  })
})

describe('floorBoxesOverlap', () => {
  it('keeps the placement gap out of nearby boxes', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 }
    // 10 cm clear on x: closer than the 20 cm gap → overlap.
    expect(floorBoxesOverlap(a, { x: 110, y: 0, w: 100, h: 100 })).toBe(true)
    // 30 cm clear: beyond the gap → no overlap.
    expect(floorBoxesOverlap(a, { x: 130, y: 0, w: 100, h: 100 })).toBe(false)
    // Far apart on one axis never overlaps.
    expect(floorBoxesOverlap(a, { x: 500, y: 500, w: 100, h: 100 })).toBe(false)
  })
})

describe('findFloorFreeSpot', () => {
  it('lands on the free grid spot nearest the room centre when the floor is empty', () => {
    // The grid is 50 cm steps starting at ceil(footprint/2), so the exact
    // spot is grid-snapped — assert it hugs the centre and fits the room.
    const spot = findFloorFreeSpot(ROOM, [], NEW_TABLE_SPRITE, FLOOR_SIZE_DEFAULT)
    expect(Math.abs(spot.x - 400)).toBeLessThanOrEqual(50)
    expect(Math.abs(spot.y - 400)).toBeLessThanOrEqual(50)
    const box = floorSpriteBoxAt(spot.x, spot.y, NEW_TABLE_SPRITE, FLOOR_SIZE_DEFAULT, 0)!
    expect(box.x >= 0 && box.y >= 0 && box.x + box.w <= ROOM.w && box.y + box.h <= ROOM.h).toBe(
      true,
    )
  })

  it('never drops a new table on top of an existing one', () => {
    // A FOUR-chair table (140 cm + gap) parked at the centre forces the new
    // sprite clear — at least one axis moves by ≥90 cm.
    const taken = item({ sprite: 'TABLE_SQUARE_FOUR_CHAIR', x: 400, y: 400 })
    const spot = findFloorFreeSpot(ROOM, [taken], NEW_TABLE_SPRITE, FLOOR_SIZE_DEFAULT)
    expect(Math.abs(spot.x - 400) >= 90 || Math.abs(spot.y - 400) >= 90).toBe(true)
    const box = floorSpriteBoxAt(spot.x, spot.y, NEW_TABLE_SPRITE, FLOOR_SIZE_DEFAULT, 0)!
    expect(floorBoxesOverlap(box, floorSpriteBoxAt(400, 400, 'TABLE_SQUARE_FOUR_CHAIR', 5, 0)!)).toBe(
      false,
    )
  })
})

describe('floorSpriteLabel', () => {
  it('labels catalog sprites for humans', () => {
    expect(floorSpriteLabel('TABLE_SQUARE_FOUR_CHAIR')).toBe('Square 4')
    expect(floorSpriteLabel('TABLE_SQUARE_TWO_CHAIR')).toBe('Square 2')
    expect(floorSpriteLabel('WALL_2_METER')).toBe('Wall 2m')
    expect(floorSpriteLabel('PLANT_SMALL')).toBe('Plant S')
    expect(floorSpriteLabel('PLANT_LARGE')).toBe('Plant L')
    expect(floorSpriteLabel('BAR')).toBe('Bar')
  })
})

describe('clampFloorCentre', () => {
  it('allows a small sprite to sit near the wall', () => {
    // 40 cm footprint → centre can sit at 20.
    expect(clampFloorCentre(item(), 20, 20, ROOM.w, ROOM.h)).toEqual({ x: 20, y: 20 })
  })

  it('pushes a rotated sprite back inside (45° bbox is bigger)', () => {
    // rotation 1 → bbox 57 cm → centre must be ≥ ceil(57/2) = 29.
    expect(clampFloorCentre(item({ rotation: 1 }), 20, 20, ROOM.w, ROOM.h)).toEqual({
      x: 29,
      y: 29,
    })
  })

  it('caps growth at the far wall', () => {
    expect(clampFloorCentre(item(), 900, 400, ROOM.w, ROOM.h)).toEqual({ x: 780, y: 400 })
  })

  it('is a no-op without room bounds', () => {
    expect(clampFloorCentre(item(), 123, 456, 0, 0)).toEqual({ x: 123, y: 456 })
  })
})

describe('floorSizeFitsRoom / stepFloorSize', () => {
  it('refuses a size whose worst-case rotation no longer fits the room', () => {
    // WALL_4_METER size 7 fits the 8 m room; size 8 (1200 cm) never does.
    expect(floorSizeFitsRoom('WALL_4_METER', 7, ROOM)).toBe(true)
    expect(floorSizeFitsRoom('WALL_4_METER', 8, ROOM)).toBe(false)
  })

  it('steps the 1-8 ladder and refuses out-of-ladder / out-of-room steps', () => {
    expect(stepFloorSize('PLANT_SMALL', 5, 1, ROOM)).toBe(6)
    expect(stepFloorSize('PLANT_SMALL', 6, -1, ROOM)).toBe(5)
    // Ladder floor.
    expect(stepFloorSize('PLANT_SMALL', 1, -1, ROOM)).toBe(1)
    // Ladder ceiling that still fits.
    expect(stepFloorSize('PLANT_SMALL', 7, 1, ROOM)).toBe(8)
    // Room ceiling: size 8 can never fit, so the step is refused.
    expect(stepFloorSize('WALL_4_METER', 7, 1, ROOM)).toBe(7)
  })
})

describe('floorNewItemAt', () => {
  it('drops brand-new sprites at the room centre', () => {
    expect(floorNewItemAt('BAR', ROOM)).toEqual({
      sprite: 'BAR',
      x: 400,
      y: 400,
      rotation: 0,
      size: FLOOR_SIZE_DEFAULT,
    })
  })
})

describe('footprint parity with floorSprites', () => {
  it('uses the same size math as the catalog', () => {
    const spec = floorSpriteSize(140, 140, 5)
    expect(spec).toEqual({ w: 140, h: 140 })
  })
})
