/**
 * Floor map edit-mode helpers shared by both clients — the web FloorMap
 * (frontend/src/components/tablero/FloorMap.tsx) and the RN FloorMap
 * (rolonative/src/screens/FloorMap.tsx) import these so placement, labelling
 * and the size/rotation clamps behave identically. Pure math: rendering, DB
 * and HTTP stay in each client.
 *
 * Coordinates are centimetres; rotation is 0-7 (45° steps); size is the 1-8
 * ladder. See floorSprites.ts for the catalog and validation rules.
 */
import {
  FLOOR_SIZE_DEFAULT,
  FLOOR_SIZE_MAX,
  FLOOR_SIZE_MIN,
  FLOOR_SPRITES,
  floorRotatedSize,
  floorSpriteSize,
  type FloorItem,
  type FloorSpriteName,
} from './floorSprites.js'

/** Sprite a brand-new dining_table is dropped onto. */
export const NEW_TABLE_SPRITE: FloorSpriteName = 'TABLE_SQUARE_FOUR_CHAIR'

/** Gap (cm) auto-placement keeps between the new sprite and its neighbours. */
export const PLACEMENT_GAP = 20
/** Grid (cm) searched when looking for a free spot. */
export const PLACEMENT_STEP = 50

/** Rotated bounding box of a sprite at a centre point, as a top-left box. */
export function floorSpriteBoxAt(
  x: number,
  y: number,
  sprite: string,
  size: number,
  rotation: number,
): { x: number; y: number; w: number; h: number } | null {
  const spec = (FLOOR_SPRITES as Record<string, { w: number; h: number } | undefined>)[sprite]
  if (!spec) return null
  const foot = floorSpriteSize(spec.w, spec.h, size)
  const rot = floorRotatedSize(foot.w, foot.h, rotation)
  return { x: x - rot.w / 2, y: y - rot.h / 2, w: rot.w, h: rot.h }
}

/** Two rotated bounding boxes overlap when each axis intersects — the
 *  placement gap is folded into the comparison so auto-placement keeps
 *  PLACEMENT_GAP centimetres clear of every neighbour. */
export function floorBoxesOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    a.x < b.x + b.w + PLACEMENT_GAP &&
    b.x < a.x + a.w + PLACEMENT_GAP &&
    a.y < b.y + b.h + PLACEMENT_GAP &&
    b.y < a.y + a.h + PLACEMENT_GAP
  )
}

/** Centre (cm) for a brand-new table sprite: the free grid spot nearest the
 *  room centre, so a fresh table lands in view instead of a corner and never
 *  overlaps what's already placed. Packed floor → centre anyway: validation
 *  only checks bounds, and the sprite can be dragged into place. */
export function findFloorFreeSpot(
  room: { w: number; h: number },
  items: FloorItem[],
  sprite: string,
  size: number,
): { x: number; y: number } {
  const centre = { x: Math.round(room.w / 2), y: Math.round(room.h / 2) }
  const target = floorSpriteBoxAt(centre.x, centre.y, sprite, size, 0)
  if (!target) return centre
  const taken = items
    .map((it) => floorSpriteBoxAt(it.x, it.y, it.sprite, it.size, it.rotation))
    .filter((box): box is NonNullable<typeof box> => box !== null)
  const candidates: Array<{ x: number; y: number; d: number }> = []
  for (let y = Math.ceil(target.h / 2); y <= room.h - target.h / 2; y += PLACEMENT_STEP) {
    for (let x = Math.ceil(target.w / 2); x <= room.w - target.w / 2; x += PLACEMENT_STEP) {
      candidates.push({ x, y, d: (x - centre.x) ** 2 + (y - centre.y) ** 2 })
    }
  }
  candidates.sort((a, b) => a.d - b.d)
  const free = candidates.find((spot) => {
    const box = floorSpriteBoxAt(spot.x, spot.y, sprite, size, 0)!
    return taken.every((other) => !floorBoxesOverlap(box, other))
  })
  return free ? { x: free.x, y: free.y } : centre
}

/** Word seat count → digit: FOUR → 4. */
const SEAT_WORDS: Record<string, string> = {
  TWO: '2',
  THREE: '3',
  FOUR: '4',
  FIVE: '5',
  SIX: '6',
  SEVEN: '7',
  EIGHT: '8',
}

/** Human label for a sprite: TABLE_SQUARE_FOUR_CHAIR → "Square 4". */
export function floorSpriteLabel(sprite: string): string {
  if (sprite.startsWith('TABLE_SQUARE_')) {
    return `Square ${SEAT_WORDS[sprite.split('_')[2] ?? ''] ?? ''}`
  }
  if (sprite.startsWith('WALL_')) return `Wall ${sprite.split('_')[1] ?? ''}m`
  if (sprite === 'PLANT_SMALL') return 'Plant S'
  if (sprite === 'PLANT_LARGE') return 'Plant L'
  return sprite.charAt(0) + sprite.slice(1).toLowerCase()
}

/** Clamp an item centre so its SIZED + rotated bbox stays inside the room.
 *  Shared by drag, resize and rotate — a sprite grown near a wall would
 *  otherwise hang out of bounds and fail every save. roomW/roomH are the
 *  room dimensions in centimetres (0 disables clamping). */
export function clampFloorCentre(
  el: Pick<FloorItem, 'sprite' | 'size' | 'rotation'>,
  x: number,
  y: number,
  roomW: number,
  roomH: number,
): { x: number; y: number } {
  const spec = (FLOOR_SPRITES as Record<string, { w: number; h: number } | undefined>)[el.sprite]
  if (!spec || !roomW || !roomH) return { x, y }
  const foot = floorSpriteSize(spec.w, spec.h, el.size)
  const rot = floorRotatedSize(foot.w, foot.h, el.rotation)
  const axis = (v: number, sizeAxis: number, roomAxis: number) =>
    Math.min(Math.max(v, Math.ceil(sizeAxis / 2)), roomAxis - Math.ceil(sizeAxis / 2))
  return { x: axis(x, rot.w, roomW), y: axis(y, rot.h, roomH) }
}

/** A size is only reachable if the sprite fits the room at EVERY rotation —
 *  the ladder must never create an unsavable item (bbox larger than the
 *  room can't be dragged back in), and every reachable size must still
 *  spin through all 8 directions. Worst case = max(w, h, 45° diagonal). */
export function floorSizeFitsRoom(
  sprite: string,
  size: number,
  room: { w: number; h: number },
): boolean {
  const spec = (FLOOR_SPRITES as Record<string, { w: number; h: number } | undefined>)[sprite]
  if (!spec || !room.w || !room.h) return false
  const foot = floorSpriteSize(spec.w, spec.h, size)
  const diag = floorRotatedSize(foot.w, foot.h, 1).w
  return Math.max(foot.w, foot.h, diag) <= Math.min(room.w, room.h)
}

/** Step the size ladder by `delta`, refusing steps past the ladder ends
 *  (FLOOR_SIZE_MIN/MAX) or past floorSizeFitsRoom. Returns the current size
 *  unchanged when the step is refused. */
export function stepFloorSize(
  sprite: string,
  size: number,
  delta: number,
  room: { w: number; h: number },
): number {
  const next = Math.min(FLOOR_SIZE_MAX, Math.max(FLOOR_SIZE_MIN, size + delta))
  if (next === size || !floorSizeFitsRoom(sprite, next, room)) return size
  return next
}

/** Centre of a brand-new floor item: the room centre (edit-mode default
 *  drop point — free-spot search is applied on top when placing a table). */
export function floorNewItemAt(
  sprite: string,
  room: { w: number; h: number },
  size: number = FLOOR_SIZE_DEFAULT,
): Pick<FloorItem, 'sprite' | 'x' | 'y' | 'rotation' | 'size'> {
  return {
    sprite,
    x: Math.round(room.w / 2),
    y: Math.round(room.h / 2),
    rotation: 0,
    size,
  }
}
