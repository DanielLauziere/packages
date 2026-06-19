import { v4 as uuidv4 } from 'uuid'

import { DbAdapter } from './dbAdapter.js'
import {
  AddItemPayload,
  AddModifierPayload,
  AddPaymentPayload,
  ApplyPromotionPayload,
  RemoveItemPayload,
  RemoveModifierPayload,
  RemovePromotionPayload,
  SetAnonymousAddressPayload,
  SetItemNotePayload,
} from './types.js'

export interface TicketLogEntry {
  uuid: string
  ticketUuid: string
  locationGroupUuid: string
  action: string
  payload: any
  timeStamp: number
  adminUuid?: string
}

function exists(adapter: DbAdapter, sql: string, params: any[]): boolean {
  const rows = adapter.query(sql, params)
  return (rows?.length ?? 0) > 0
}

function crc32(str: string): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    crc ^= ch
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function ticketIdFromUUID(ticketUuid: string): number {
  return (crc32(ticketUuid) % 90000) + 10000
}

function ensureTicketExists(adapter: DbAdapter, entry: TicketLogEntry): void {
  if (
    exists(adapter, `SELECT uuid FROM ticket WHERE uuid = ? LIMIT 1`, [
      entry.ticketUuid,
    ])
  )
    return

  adapter.run(
    `INSERT INTO "ticket" (uuid, id, "timeStamp", "locationGroupUuid", status, "isDirty", "isLocal")
     VALUES (?, ?, ?, ?, 'INCOMPLETE', 1, 1)`,
    [
      entry.ticketUuid,
      ticketIdFromUUID(entry.ticketUuid),
      entry.timeStamp,
      entry.locationGroupUuid,
    ],
  )
}

function clearString(str: string): string {
  return str.replace(/[^0-9]+/g, '')
}

function updateEsNumber(str: string, code: number): string {
  const t = String(code)
  const codeRegex = new RegExp(t, 'g')
  const codeRemoved = clearString(str).replace(codeRegex, '')
  return t + codeRemoved
}

function isEmail(str: string): boolean {
  const reg = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return reg.test(str)
}

function upsertGuest(
  adapter: DbAdapter,
  uuid: string | null,
  username: string,
): string {
  let normalized = username

  if (isEmail(username)) {
    normalized = username
  } else {
    normalized = updateEsNumber(username, 503)
  }

  const finalUuid = uuid || uuidv4()

  adapter.run(
    `INSERT INTO guest (uuid, username, email, phone)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       username = excluded.username`,
    [
      finalUuid,
      normalized,
      isEmail(username) ? normalized : null,
      !isEmail(username) ? normalized : null,
    ],
  )

  const rows = adapter.query(
    `SELECT uuid FROM guest WHERE username = ? LIMIT 1`,
    [normalized],
  )

  const found = rows?.[0]?.uuid
  if (!found) {
    throw new Error('GUEST_UPSERT_FAILED')
  }
  return found
}

export function hasLogBeenApplied(
  adapter: DbAdapter,
  uuid: string,
): boolean {
  return exists(
    adapter,
    `SELECT 1 FROM ticketLogApplied WHERE uuid = ? LIMIT 1`,
    [uuid],
  )
}

function markLogApplied(adapter: DbAdapter, entry: TicketLogEntry) {
  adapter.run(
    `INSERT OR IGNORE INTO ticketLogApplied (uuid, timeStamp) VALUES (?, ?)`,
    [entry.uuid, entry.timeStamp],
  )
}

export async function applyTicketLog(
  adapter: DbAdapter,
  entry: TicketLogEntry,
): Promise<void> {
  const { action, payload } = entry

  try {
    switch (action) {
      case 'SET_TABLE': {
        const p = payload as { tableUuid: string }
        if (
          p.tableUuid &&
          !exists(adapter, `SELECT 1 FROM "table" WHERE uuid = ?`, [
            p.tableUuid,
          ])
        ) {
          throw new Error('MISSING_DEPENDENCY')
        }
        adapter.run(
          `UPDATE "ticket" SET "tableUuid" = ?, "isDirty" = ? WHERE uuid = ?`,
          [p.tableUuid, 1, entry.ticketUuid],
        )
        break
      }

      case 'SET_GUEST': {
        const p = payload as {
          guestUserName: string
          guestUuid: string | null
        }
        if (!p.guestUserName && !p.guestUuid) break

        const guest = upsertGuest(adapter, p.guestUuid, p.guestUserName)

        adapter.run(`UPDATE ticket SET "guestUuid" = ? WHERE uuid = ?`, [
          guest,
          entry.ticketUuid,
        ])
        break
      }

      case 'SET_FULFILLMENT': {
        const p = payload as { fulfillmentUuid: string }
        if (
          p.fulfillmentUuid &&
          !exists(adapter, `SELECT 1 FROM fulfillment WHERE uuid = ?`, [
            p.fulfillmentUuid,
          ])
        ) {
          throw new Error('MISSING_DEPENDENCY')
        }
        adapter.run(`UPDATE ticket SET fulfillmentUuid = ? WHERE uuid = ?`, [
          p.fulfillmentUuid,
          entry.ticketUuid,
        ])
        break
      }

      case 'SET_ANONYMOUS_ADDRESS': {
        const p = payload as SetAnonymousAddressPayload
        adapter.run(
          `UPDATE "ticket" SET "anonymousAddress" = ?, "isDirty" = 1 WHERE uuid = ?`,
          [p.address, entry.ticketUuid],
        )
        break
      }

      case 'ADD_ITEM': {
        const p = payload as AddItemPayload
        ensureTicketExists(adapter, entry)

        if (
          !exists(adapter, `SELECT 1 FROM menuItem WHERE uuid = ? LIMIT 1`, [
            p.menuItemUuid,
          ])
        ) {
          throw new Error('MISSING_DEPENDENCY')
        }

        adapter.run(
          `INSERT OR IGNORE INTO ticketMenuItem (uuid, ticketUuid, menuItemUuid)
           VALUES (?, ?, ?)`,
          [entry.uuid, entry.ticketUuid, p.menuItemUuid],
        )
        break
      }

      case 'REMOVE_ITEM': {
        const p = payload as RemoveItemPayload
        const { ticketMenuItemUuid } = p

        if (
          !exists(
            adapter,
            `SELECT 1 FROM ticketMenuItem WHERE uuid = ? LIMIT 1`,
            [ticketMenuItemUuid],
          )
        ) {
          return
        }

        adapter.run(
          `DELETE FROM "ticketMenuItemModifier" WHERE "ticketMenuItemUuid" = ?`,
          [ticketMenuItemUuid],
        )
        adapter.run(
          `DELETE FROM "ticketPromotion" WHERE "ticketMenuItemUuid" = ?`,
          [ticketMenuItemUuid],
        )
        adapter.run(`DELETE FROM "ticketMenuItem" WHERE uuid = ?`, [
          ticketMenuItemUuid,
        ])
        break
      }

      case 'SET_ITEM_NOTE': {
        const p = payload as SetItemNotePayload

        if (
          !exists(
            adapter,
            `SELECT 1 FROM ticketMenuItem WHERE uuid = ? LIMIT 1`,
            [p.ticketMenuItemUuid],
          )
        ) {
          throw new Error('MISSING_DEPENDENCY')
        }

        adapter.run(
          `UPDATE ticketMenuItem SET note = ? WHERE uuid = ?`,
          [p.note, p.ticketMenuItemUuid],
        )
        break
      }

      case 'ADD_MODIFIER': {
        const p = payload as AddModifierPayload
        ensureTicketExists(adapter, entry)

        if (
          !exists(
            adapter,
            `SELECT 1 FROM ticketMenuItem WHERE uuid = ? LIMIT 1`,
            [p.ticketMenuItemUuid],
          )
        ) {
          throw new Error('MISSING_DEPENDENCY')
        }

        if (
          !exists(adapter, `SELECT 1 FROM modifier WHERE uuid = ? LIMIT 1`, [
            p.modifierUuid,
          ])
        ) {
          throw new Error('MISSING_DEPENDENCY')
        }

        adapter.run(
          `INSERT OR IGNORE INTO "ticketMenuItemModifier"
           (uuid, "ticketUuid", "modifierUuid", "ticketMenuItemUuid")
           VALUES (?, ?, ?, ?)`,
          [entry.uuid, entry.ticketUuid, p.modifierUuid, p.ticketMenuItemUuid],
        )
        break
      }

      case 'REMOVE_MODIFIER': {
        const p = payload as RemoveModifierPayload
        const { ticketMenuItemModifierUuid } = p

        if (
          ticketMenuItemModifierUuid &&
          !exists(
            adapter,
            `SELECT 1 FROM ticketMenuItemModifier WHERE uuid = ? LIMIT 1`,
            [ticketMenuItemModifierUuid],
          )
        ) {
          return
        }

        adapter.run(
          `DELETE FROM "ticketMenuItemModifier" WHERE uuid = ?`,
          [ticketMenuItemModifierUuid],
        )
        break
      }

      case 'APPLY_PROMOTION': {
        const p = payload as ApplyPromotionPayload
        ensureTicketExists(adapter, entry)

        if (
          p.ticketMenuItemUuid &&
          !exists(
            adapter,
            `SELECT 1 FROM ticketMenuItem WHERE uuid = ? LIMIT 1`,
            [p.ticketMenuItemUuid],
          )
        ) {
          throw new Error('MISSING_DEPENDENCY')
        }

        if (
          !exists(adapter, `SELECT 1 FROM promotion WHERE uuid = ? LIMIT 1`, [
            p.promotionUuid,
          ])
        ) {
          throw new Error('MISSING_DEPENDENCY')
        }

        const sql = `SELECT uuid FROM "ticketPromotion" WHERE "ticketUuid" = ? AND "promotionUuid" = ? AND ("ticketMenuItemUuid" = ? OR ("ticketMenuItemUuid" IS NULL AND ? IS NULL))`
        const params = [
          entry.ticketUuid,
          p.promotionUuid,
          p.ticketMenuItemUuid ?? null,
          p.ticketMenuItemUuid ?? null,
        ]
        if (!exists(adapter, sql, params)) {
          adapter.run(
            `INSERT OR IGNORE INTO "ticketPromotion" ("uuid", "timeStamp", "ticketUuid", "promotionUuid", "ticketMenuItemUuid")
             VALUES (?, ?, ?, ?, ?)`,
            [
              entry.uuid,
              new Date().toISOString(),
              entry.ticketUuid,
              p.promotionUuid,
              p.ticketMenuItemUuid ?? null,
            ],
          )
        }
        break
      }

      case 'REMOVE_PROMOTION': {
        const p = payload as RemovePromotionPayload
        adapter.run(
          `DELETE FROM "ticketPromotion" WHERE "promotionUuid" = ?`,
          [p.promotionUuid],
        )
        break
      }

      case 'ADD_PAYMENT': {
        const p = payload as AddPaymentPayload
        handleAddPaymentLog(adapter, entry, p)
        break
      }

      case 'SET_STATUS_COMPLETE': {
        adapter.run(
          `UPDATE ticket SET status = 'COMPLETE' WHERE uuid = ?`,
          [entry.ticketUuid],
        )
        break
      }

      case 'SET_STATUS_ACCEPTED': {
        adapter.run(
          `UPDATE ticket SET status = 'ACCEPTED' WHERE uuid = ?`,
          [entry.ticketUuid],
        )
        break
      }

      case 'SET_STATUS_PAID': {
        adapter.run(
          `UPDATE ticket SET status = 'PAID' WHERE uuid = ?`,
          [entry.ticketUuid],
        )
        break
      }

      default: {
        return
      }
    }
  } catch (e) {
    const msg = (e as any)?.message

    if (msg === 'GUEST_UPSERT_FAILED') {
      throw new Error('MISSING_DEPENDENCY')
    }

    if (msg === 'MISSING_DEPENDENCY') {
      throw e
    }

    throw e
  }
}

export function handleAddPaymentLog(
  adapter: DbAdapter,
  entry: TicketLogEntry,
  payload: AddPaymentPayload,
): void {
  const existsPayment = exists(
    adapter,
    `SELECT 1 FROM "ticketPayment" WHERE "ticketUuid" = ? AND "paymentUuid" = ?`,
    [entry.ticketUuid, payload.paymentUuid],
  )

  if (existsPayment) return

  if (
    !exists(adapter, `SELECT 1 FROM payment WHERE uuid = ? LIMIT 1`, [
      payload.paymentUuid,
    ])
  ) {
    throw new Error('MISSING_DEPENDENCY')
  }

  adapter.run(
    `INSERT INTO "ticketPayment"
     ("uuid", "ticketUuid", "paymentUuid", "priceWhole", "priceHundredths", "code", "complete")
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.uuid,
      entry.ticketUuid,
      payload.paymentUuid,
      payload.priceWhole,
      payload.priceHundredths,
      payload.code ?? null,
      payload.complete ? 1 : 0,
    ],
  )
}

export async function applyLogsBatch(
  adapter: DbAdapter,
  logs: TicketLogEntry[],
): Promise<{
  applied: number
  skipped: number
  errors: { entry: TicketLogEntry; error: unknown }[]
}> {
  let applied = 0
  let skipped = 0
  const errors: { entry: TicketLogEntry; error: unknown }[] = []

  if (!logs.length) {
    return { applied, skipped, errors }
  }

  const sorted = [...logs].sort((a, b) => {
    if (a.timeStamp !== b.timeStamp) {
      return a.timeStamp < b.timeStamp ? -1 : 1
    }
    return 0
  })

  for (const entry of sorted) {
    try {
      if (hasLogBeenApplied(adapter, entry.uuid)) {
        skipped++
        continue
      }

      adapter.run('BEGIN')

      try {
        await applyTicketLog(adapter, entry)
        markLogApplied(adapter, entry)

        adapter.run('COMMIT')
        applied++
      } catch (error: any) {
        adapter.run('ROLLBACK')

        if (error?.message === 'MISSING_DEPENDENCY') {
          skipped++
          continue
        }

        errors.push({ entry, error })
      }
    } catch (fatal) {
      throw fatal
    }
  }

  return { applied, skipped, errors }
}
