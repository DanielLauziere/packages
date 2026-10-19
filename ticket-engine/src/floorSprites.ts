/**
 * Floor map v2 (docs/features/TABLE-LAYOUT.md): the floor is a metric room
 * filled with PNG sprites — one placed sprite per DB row (floor_item) plus
 * one room-template row (floor_room). The catalog, the room templates, and
 * the validation rules below mirror the Go side
 * (omni/src/modals/floorModel.go) — change both together.
 *
 * All coordinates are centimetres. x,y is the sprite CENTRE; rotation is
 * 0-7 (45° steps, 0 = art as drawn).
 */

/** The locked sprite-name catalog. Asset files are named after these
 *  exactly: <SPRITE>.png. Table footprints grow with seat count; walls are
 *  named by their meter length, 20 cm thick. */
export const FLOOR_SPRITES = {
  TABLE_SQUARE_TWO_CHAIR: { w: 120, h: 100, kind: 'table' },
  TABLE_SQUARE_THREE_CHAIR: { w: 140, h: 110, kind: 'table' },
  TABLE_SQUARE_FOUR_CHAIR: { w: 140, h: 140, kind: 'table' },
  TABLE_SQUARE_FIVE_CHAIR: { w: 160, h: 140, kind: 'table' },
  TABLE_SQUARE_SIX_CHAIR: { w: 200, h: 140, kind: 'table' },
  TABLE_SQUARE_SEVEN_CHAIR: { w: 220, h: 140, kind: 'table' },
  TABLE_SQUARE_EIGHT_CHAIR: { w: 240, h: 140, kind: 'table' },
  BAR: { w: 200, h: 60, kind: 'bar' },
  WALL_1_METER: { w: 100, h: 20, kind: 'wall' },
  WALL_2_METER: { w: 200, h: 20, kind: 'wall' },
  WALL_3_METER: { w: 300, h: 20, kind: 'wall' },
  WALL_4_METER: { w: 400, h: 20, kind: 'wall' },
  PLANT_SMALL: { w: 40, h: 40, kind: 'plant' },
  PLANT_LARGE: { w: 80, h: 80, kind: 'plant' },
} as const

export type FloorSpriteName = keyof typeof FLOOR_SPRITES
export type FloorSpriteKind = 'table' | 'bar' | 'wall' | 'plant'

/** The single room template (8×8 m). The room is pure bounds — no auto
 *  walls. Older multi-template kinds (RECTANGLE/LONG_RECTANGLE) are gone;
 *  view mode crops the canvas to the placed items instead. */
export const FLOOR_ROOMS = {
  SQUARE: { w: 800, h: 800 },
} as const

export type FloorRoomKind = keyof typeof FLOOR_ROOMS

/** Sprite size ladder 1-8, as eighths of the catalog footprint (exact
 *  binary fractions, integer math only — the Go side uses the same table).
 *  Size 5 is ×1: the art's natural footprint. Size 8 (×3) is the
 *  "small restaurant" anchor: four size-8 smallest tables (360×300) fit one
 *  per quadrant of the 8×8 room without touching. Size 1 (×¼) fits ~50
 *  tables. */
export const FLOOR_SIZE_MULTIPLIERS = [2, 3, 4, 6, 8, 12, 16, 24] as const
export const FLOOR_SIZE_MIN = 1
export const FLOOR_SIZE_MAX = 8
/** Size of rows written before the ladder existed / unspecified. */
export const FLOOR_SIZE_DEFAULT = 5

/** The rendered footprint (cm) of a catalog sprite at a size 1-8.
 *  Round-half-up via integer math: (base·mult + 4) / 8. */
export function floorSpriteSize(baseW: number, baseH: number, size: number): { w: number; h: number } {
  const mult = FLOOR_SIZE_MULTIPLIERS[normalizeFloorSize(size) - 1]
  return {
    w: Math.floor((baseW * mult + 4) / 8),
    h: Math.floor((baseH * mult + 4) / 8),
  }
}

/** Missing/invalid sizes collapse to the default (lenient read path —
 *  validateFloorItems is the strict gate). */
export function normalizeFloorSize(size: number | null | undefined): number {
  return Number.isInteger(size) && (size as number) >= FLOOR_SIZE_MIN && (size as number) <= FLOOR_SIZE_MAX
    ? (size as number)
    : FLOOR_SIZE_DEFAULT
}

/** Hard cap on stored items so one floor can never bloat the ref snapshot. */
export const MAX_FLOOR_ITEMS = 500

/** One placed sprite — the floor_item row's wire shape. */
export interface FloorItem {
  uuid: string
  sprite: string
  /** Centre point, centimetres. */
  x: number
  /** Centre point, centimetres. */
  y: number
  /** 0-7, 45° steps (0 = art as drawn). */
  rotation: number
  /** Size ladder 1-8 (5 = the catalog footprint). */
  size: number
  /** Bound dining_table — only TABLE_* and BAR sprites. */
  table_uuid?: string | null
}

export interface FloorTableRef {
  uuid: string
  active?: boolean
  name?: string
}

/** Table-like sprites — the only ones allowed to bind a dining_table
 *  (mirrors IsFloorTableSprite() in the Go model). */
export function isFloorTableSprite(sprite: string): boolean {
  return sprite.startsWith('TABLE_') || sprite === 'BAR'
}

/** A bound table is visible/clickable only while its dining_table row exists
 *  and is active. Null/undefined active is treated as active — only explicit
 *  false/0 hides. */
export function isTableActive(table?: FloorTableRef | null): boolean {
  if (!table) return false
  return table.active === null || table.active === undefined
    ? true
    : Boolean(table.active)
}

export function floorSpriteKind(sprite: string): FloorSpriteKind | null {
  const entry = (FLOOR_SPRITES as Record<string, { kind: FloorSpriteKind } | undefined>)[sprite]
  return entry ? entry.kind : null
}

/** Axis-aligned bounding box (centimetres) of a sprite after rotating by
 *  45° steps (0-7). Mirrors FloorRotatedSize() in the Go model — the same
 *  Math.ceil so both sides agree on the integer. */
export function floorRotatedSize(w: number, h: number, rotation: number): { w: number; h: number } {
  switch (((rotation % 8) + 8) % 8) {
    case 0:
    case 4:
      return { w, h }
    case 2:
    case 6:
      return { w: h, h: w }
    default:
      // 45° diagonals: bbox side = ceil((w+h)·√2/2).
      const diag = Math.ceil(((w + h) * Math.SQRT1_2))
      return { w: diag, h: diag }
  }
}

/** The item's render box (centimetres) with x,y the TOP-LEFT corner: the
 *  sprite's UNROTATED, SCALED footprint centred on the item point. Rotation
 *  is applied visually (CSS transform: rotate) — it spins the sprite in
 *  place and never resizes it. floorRotatedSize is the rotated bounding box
 *  and is used only for bounds validation and drag clamping. */
export function floorItemBox(item: Pick<FloorItem, 'sprite' | 'x' | 'y' | 'size'>): {
  x: number
  y: number
  w: number
  h: number
} | null {
  const spec = (FLOOR_SPRITES as Record<string, { w: number; h: number } | undefined>)[item.sprite]
  if (!spec) return null
  const size = floorSpriteSize(spec.w, spec.h, item.size)
  return { x: item.x - size.w / 2, y: item.y - size.h / 2, w: size.w, h: size.h }
}

/** View mode: the tight bounding box (cm) of every placed item — the canvas
 *  crops to this after saving so the staff view shows only the built
 *  footprint, at the item bbox's exact aspect ratio (e.g. items filling only
 *  the bottom half ⇒ 2:1). Null when the floor is empty (nothing to show). */
export function floorContentBox(items: FloorItem[]): {
  x: number
  y: number
  w: number
  h: number
} | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const it of items) {
    const spec = (FLOOR_SPRITES as Record<string, { w: number; h: number } | undefined>)[it.sprite]
    if (!spec) continue
    const size = floorSpriteSize(spec.w, spec.h, it.size)
    const rot = floorRotatedSize(size.w, size.h, it.rotation)
    minX = Math.min(minX, it.x - rot.w / 2)
    maxX = Math.max(maxX, it.x + rot.w / 2)
    minY = Math.min(minY, it.y - rot.h / 2)
    maxY = Math.max(maxY, it.y + rot.h / 2)
  }
  if (minX === Infinity) return null
  return {
    x: Math.round(minX),
    y: Math.round(minY),
    w: Math.round(maxX - minX),
    h: Math.round(maxY - minY),
  }
}

/** Client mirror of the server's PUT /floor validation (first failure wins).
 *  The server re-validates; this keeps bad floors out of the local draft. */
export function validateFloorItems(
  roomKind: string,
  items: FloorItem[],
  validTableUuids: Set<string>,
): string | null {
  const room = (FLOOR_ROOMS as Record<string, { w: number; h: number } | undefined>)[roomKind]
  if (!room) return `invalidRoomKind: ${roomKind}`
  if (items.length > MAX_FLOOR_ITEMS) return `tooManyItems: ${items.length} > ${MAX_FLOOR_ITEMS}`
  const seenTableUuids = new Set<string>()
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const spec = (FLOOR_SPRITES as Record<string, { w: number; h: number } | undefined>)[it.sprite]
    if (!spec) return `invalidItem[${i}]: unknown sprite ${it.sprite}`
    if (!Number.isInteger(it.rotation) || it.rotation < 0 || it.rotation > 7) {
      return `invalidItem[${i}]: rotation must be 0-7`
    }
    if (!Number.isInteger(it.size) || it.size < FLOOR_SIZE_MIN || it.size > FLOOR_SIZE_MAX) {
      return `invalidItem[${i}]: size must be ${FLOOR_SIZE_MIN}-${FLOOR_SIZE_MAX}`
    }
    const footprint = floorSpriteSize(spec.w, spec.h, it.size)
    const size = floorRotatedSize(footprint.w, footprint.h, it.rotation)
    if (2 * it.x < size.w || 2 * it.x + size.w > 2 * room.w) {
      return `invalidItem[${i}]: out of bounds horizontally`
    }
    if (2 * it.y < size.h || 2 * it.y + size.h > 2 * room.h) {
      return `invalidItem[${i}]: out of bounds vertically`
    }
    if (it.table_uuid) {
      if (!isFloorTableSprite(it.sprite)) {
        return `invalidItem[${i}]: table_uuid only allowed on TABLE_* or BAR sprites`
      }
      if (!validTableUuids.has(it.table_uuid)) {
        return `invalidItem[${i}]: table_uuid does not belong to this location group`
      }
      if (seenTableUuids.has(it.table_uuid)) {
        return `invalidItem[${i}]: duplicate table_uuid`
      }
      seenTableUuids.add(it.table_uuid)
    }
  }
  return null
}

/** table_uuids already bound on the canvas. */
export function placedTableUuids(items: FloorItem[]): string[] {
  const uuids: string[] = []
  for (const it of items) {
    if (it.table_uuid) uuids.push(it.table_uuid)
  }
  return uuids
}

/** The tray: active dining_table rows with no item bound on the canvas. */
export function unplacedTables<T extends FloorTableRef>(
  tables: T[],
  items: FloorItem[],
): T[] {
  const placed = new Set(placedTableUuids(items))
  return tables.filter((t) => isTableActive(t) && !placed.has(t.uuid))
}

// ---------------------------------------------------------------------------
// Open-ticket badges
// ---------------------------------------------------------------------------

/** Per-bound-table count of open tickets. Pass the tablero's/orders
 *  screen's existing open-ticket set (the same query both apps already
 *  use) filtered however that set is defined — the floor map agrees with
 *  the orders board by reusing its set, not inventing a new rule. */
export function countOpenTicketsByTable(
  tickets: Array<{ table_uuid?: string | null }>,
  items: FloorItem[],
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const it of items) {
    if (it.table_uuid) counts[it.table_uuid] = 0
  }
  for (const ticket of tickets) {
    if (ticket.table_uuid && counts[ticket.table_uuid] !== undefined) {
      counts[ticket.table_uuid]++
    }
  }
  return counts
}

// ---------------------------------------------------------------------------
// Start-ticket plan
// ---------------------------------------------------------------------------

const FULFILLMENT_UUID_EATIN = 'ed345e57-4fb1-4111-8603-9c820417ed3e'

/** One step of the pre-attached new-ticket plan. Each client executes the
 *  plan through its own DB/sync layer (appendLog etc.) — only the plan is
 *  shared. */
export type FloorStartAction =
  | { action: 'SET_TABLE'; payload: { table_uuid: string } }
  | { action: 'SET_FULFILLMENT'; payload: { fulfillment_uuid: string } }

/** The ordered [SET_TABLE, SET_FULFILLMENT EATIN] sequence written when
 *  starting a ticket at a table — the same sequence FulfillmentTableModal
 *  writes, so the new order opens exactly like a tapped one with no table
 *  re-picking. */
export function ticketStartActions(table_uuid: string): FloorStartAction[] {
  return [
    { action: 'SET_TABLE', payload: { table_uuid } },
    { action: 'SET_FULFILLMENT', payload: { fulfillment_uuid: FULFILLMENT_UUID_EATIN } },
  ]
}
