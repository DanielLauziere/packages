import { v5 as uuidv5 } from 'uuid'
import { DbAdapter } from './dbAdapter.js'
import { ticketIdFromUUID } from './ticketId.js'

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

export const ACTION_PRIORITY: Record<string, number> = {
  SET_TABLE: 0,
  SET_GUEST: 0,
  SET_FULFILLMENT: 0,
  SET_ANONYMOUS_ADDRESS: 0,
  ADD_ITEM: 1,
  SET_ITEM_NOTE: 2,
  ADD_MODIFIER: 3,
  APPLY_PROMOTION: 4,
  REMOVE_PROMOTION: 5,
  REMOVE_MODIFIER: 6,
  REMOVE_ITEM: 7,
  ADD_PAYMENT: 8,
  SET_STATUS_COMPLETE: 9,
  SET_STATUS_ACCEPTED: 10,
  SET_STATUS_PAID: 11,
}

function exists(
  adapter: DbAdapter,
  sql: string,
  params: any[],
): boolean {
  const rows = adapter.query(sql, params)
  return (rows?.length ?? 0) > 0
}

function ensureTicketExists(
  adapter: DbAdapter,
  entry: TicketLogEntry,
): void {
  if (exists(adapter, `SELECT uuid FROM ticket WHERE uuid = ? LIMIT 1`, [entry.ticketUuid])) return

  adapter.run(
    `INSERT INTO "ticket" (uuid, id, "timeStamp", "locationGroupUuid", "adminUuid", status, "isDirty", "isLocal")
     VALUES (?, ?, ?, ?, (SELECT uuid FROM admin WHERE uuid = ?), 'INCOMPLETE', 1, 1)`,
    [entry.ticketUuid, ticketIdFromUUID(entry.ticketUuid), entry.timeStamp, entry.locationGroupUuid, entry.adminUuid ?? null],
  )
}

function upsertGuest(
  adapter: DbAdapter,
  username: string,
  email?: string,
  phone?: string,
): string {
  const finalUuid = uuidv5(username, '6ba7b810-9dad-11d1-80b4-00c04fd430c8')

  adapter.run(
    `INSERT INTO guest (uuid, username, email, phone)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET username = excluded.username`,
    [finalUuid, username, email ?? null, phone ?? null],
  )

  const rows = adapter.query(`SELECT uuid FROM guest WHERE username = ? LIMIT 1`, [username])
  const found: string | undefined = (rows as any[])?.[0]?.uuid
  if (!found) throw new Error('GUEST_UPSERT_FAILED')
  return found
}

export function normalizePhone(input: string, countryCode: string): string {
  const digits = input.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith(countryCode)) return digits
  return countryCode + digits
}

export function applyTicketLog(
  adapter: DbAdapter,
  entry: TicketLogEntry,
): void {
  const { action, payload, ticketUuid } = entry

  try {
    switch (action) {
      case 'SET_TABLE': {
        const p = payload as { tableUuid: string }
        ensureTicketExists(adapter, entry)
        if (p.tableUuid && !exists(adapter, `SELECT 1 FROM "table" WHERE uuid = ?`, [p.tableUuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }
        adapter.run(`UPDATE "ticket" SET "tableUuid" = ?, "isDirty" = 1, "adminUuid" = COALESCE("adminUuid", (SELECT uuid FROM admin WHERE uuid = ?)) WHERE uuid = ?`, [p.tableUuid, entry.adminUuid ?? null, ticketUuid])
        break
      }

      case 'SET_GUEST': {
        const p = payload as { guestUserName: string; email?: string; phone?: string }
        if (!p.guestUserName) break

        ensureTicketExists(adapter, entry)

        const raw = p.guestUserName.trim()
        let userName = raw
        let email = p.email ?? ''
        let phone = p.phone ?? ''
        const at = raw.indexOf('@')

        if (at !== -1) {
          userName = raw.toLowerCase()
          if (!email) email = userName
        } else if (/\d/.test(raw)) {
          const phoneCodeRows = adapter.query(
            `SELECT c."phonecode" as phoneCode
             FROM "locationGroup" lg
             INNER JOIN "country" c ON lg."countryUuid" = c."uuid"
             WHERE lg."uuid" = ?`,
            [entry.locationGroupUuid],
          )
          const countryCode = String((phoneCodeRows as any[])?.[0]?.phoneCode ?? '503')
          const normalized = normalizePhone(raw, countryCode)
          if (normalized) {
            userName = normalized
            email = ''
            phone = normalized
          }
        }

        const guest = upsertGuest(adapter, userName, email, phone)

        adapter.run(`UPDATE ticket SET "guestUuid" = ?, "adminUuid" = COALESCE("adminUuid", (SELECT uuid FROM admin WHERE uuid = ?)) WHERE uuid = ?`, [guest, entry.adminUuid ?? null, ticketUuid])
        break
      }

      case 'SET_FULFILLMENT': {
        const p = payload as { fulfillmentUuid: string }
        ensureTicketExists(adapter, entry)
        if (p.fulfillmentUuid && !exists(adapter, `SELECT 1 FROM fulfillment WHERE uuid = ?`, [p.fulfillmentUuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }
        adapter.run(`UPDATE ticket SET "fulfillmentUuid" = ?, "adminUuid" = COALESCE("adminUuid", (SELECT uuid FROM admin WHERE uuid = ?)) WHERE uuid = ?`, [p.fulfillmentUuid, entry.adminUuid ?? null, ticketUuid])
        break
      }

      case 'SET_ANONYMOUS_ADDRESS': {
        const p = payload as SetAnonymousAddressPayload
        ensureTicketExists(adapter, entry)
        adapter.run(`UPDATE "ticket" SET "anonymousAddress" = ?, "isDirty" = 1, "adminUuid" = COALESCE("adminUuid", (SELECT uuid FROM admin WHERE uuid = ?)) WHERE uuid = ?`, [p.address, entry.adminUuid ?? null, ticketUuid])
        break
      }

      case 'ADD_ITEM': {
        const p = payload as AddItemPayload
        ensureTicketExists(adapter, entry)

        if (!exists(adapter, `SELECT 1 FROM menuItem WHERE uuid = ? LIMIT 1`, [p.menuItemUuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }

        adapter.run(
          `INSERT OR IGNORE INTO ticketMenuItem (uuid, ticketUuid, menuItemUuid) VALUES (?, ?, ?)`,
          [entry.uuid, ticketUuid, p.menuItemUuid],
        )
        break
      }

      case 'REMOVE_ITEM': {
        const p = payload as RemoveItemPayload
        const { ticketMenuItemUuid } = p

        if (!exists(adapter, `SELECT 1 FROM ticketMenuItem WHERE uuid = ? LIMIT 1`, [ticketMenuItemUuid])) return

        adapter.run(`DELETE FROM "ticketMenuItemModifier" WHERE "ticketMenuItemUuid" = ?`, [ticketMenuItemUuid])
        adapter.run(`DELETE FROM "ticketPromotion" WHERE "ticketMenuItemUuid" = ?`, [ticketMenuItemUuid])
        adapter.run(`DELETE FROM "ticketMenuItem" WHERE uuid = ?`, [ticketMenuItemUuid])
        break
      }

      case 'SET_ITEM_NOTE': {
        const p = payload as SetItemNotePayload

        if (!exists(adapter, `SELECT 1 FROM ticketMenuItem WHERE uuid = ? LIMIT 1`, [p.ticketMenuItemUuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }

        adapter.run(`UPDATE ticketMenuItem SET note = ? WHERE uuid = ?`, [p.note, p.ticketMenuItemUuid])
        break
      }

      case 'ADD_MODIFIER': {
        const p = payload as AddModifierPayload
        ensureTicketExists(adapter, entry)

        if (!exists(adapter, `SELECT 1 FROM ticketMenuItem WHERE uuid = ? LIMIT 1`, [p.ticketMenuItemUuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }

        if (!exists(adapter, `SELECT 1 FROM modifier WHERE uuid = ? LIMIT 1`, [p.modifierUuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }

        adapter.run(
          `INSERT OR IGNORE INTO "ticketMenuItemModifier" (uuid, "ticketUuid", "modifierUuid", "ticketMenuItemUuid", "timeStamp") VALUES (?, ?, ?, ?, ?)`,
          [entry.uuid, ticketUuid, p.modifierUuid, p.ticketMenuItemUuid, new Date(entry.timeStamp).toISOString()],
        )
        break
      }

      case 'REMOVE_MODIFIER': {
        const p = payload as RemoveModifierPayload
        const { ticketMenuItemModifierUuid } = p

        if (ticketMenuItemModifierUuid && !exists(adapter, `SELECT 1 FROM ticketMenuItemModifier WHERE uuid = ? LIMIT 1`, [ticketMenuItemModifierUuid])) return

        adapter.run(`DELETE FROM "ticketMenuItemModifier" WHERE uuid = ?`, [ticketMenuItemModifierUuid])
        break
      }

      case 'APPLY_PROMOTION': {
        const p = payload as ApplyPromotionPayload
        ensureTicketExists(adapter, entry)

        if (p.ticketMenuItemUuid && !exists(adapter, `SELECT 1 FROM ticketMenuItem WHERE uuid = ? LIMIT 1`, [p.ticketMenuItemUuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }

        if (!exists(adapter, `SELECT 1 FROM promotion WHERE uuid = ? LIMIT 1`, [p.promotionUuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }

        if (p.ticketMenuItemUuid) {
          // Item-level promotion: replace any existing promotion on this menu item
          adapter.run(
            `DELETE FROM "ticketPromotion" WHERE "ticketUuid" = ? AND "ticketMenuItemUuid" = ? AND "ticketMenuItemUuid" IS NOT NULL`,
            [ticketUuid, p.ticketMenuItemUuid],
          )
        } else {
          // Itemless promotion: dedup to prevent duplicate itemless reward
          const dedupSql = `SELECT uuid FROM "ticketPromotion" WHERE "ticketUuid" = ? AND "promotionUuid" = ? AND "ticketMenuItemUuid" IS NULL`
          if (exists(adapter, dedupSql, [ticketUuid, p.promotionUuid])) {
            break
          }
        }

        adapter.run(
          `INSERT OR IGNORE INTO "ticketPromotion" ("uuid", "timeStamp", "ticketUuid", "promotionUuid", "ticketMenuItemUuid") VALUES (?, ?, ?, ?, ?)`,
          [entry.uuid, new Date().toISOString(), ticketUuid, p.promotionUuid, p.ticketMenuItemUuid ?? null],
        )
        break
      }

      case 'REMOVE_PROMOTION': {
        const p = payload as RemovePromotionPayload
        if (!exists(adapter, `SELECT 1 FROM promotion WHERE uuid = ? LIMIT 1`, [p.promotionUuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }
        adapter.run(`DELETE FROM "ticketPromotion" WHERE "ticketUuid" = ? AND "promotionUuid" = ?`, [ticketUuid, p.promotionUuid])
        break
      }

      case 'ADD_PAYMENT': {
        const p = payload as AddPaymentPayload
        handleAddPaymentLog(adapter, entry, p)
        break
      }

      case 'SET_STATUS_COMPLETE': {
        ensureTicketExists(adapter, entry)
        adapter.run(`UPDATE ticket SET status = 'COMPLETE', "adminUuid" = COALESCE("adminUuid", (SELECT uuid FROM admin WHERE uuid = ?)) WHERE uuid = ?`, [entry.adminUuid ?? null, ticketUuid])
        break
      }

      case 'SET_STATUS_ACCEPTED': {
        ensureTicketExists(adapter, entry)
        adapter.run(`UPDATE ticket SET status = 'ACCEPTED', "adminUuid" = COALESCE("adminUuid", (SELECT uuid FROM admin WHERE uuid = ?)) WHERE uuid = ?`, [entry.adminUuid ?? null, ticketUuid])
        break
      }

      case 'SET_STATUS_PAID': {
        ensureTicketExists(adapter, entry)
        adapter.run(`UPDATE ticket SET status = 'PAID', "adminUuid" = COALESCE("adminUuid", (SELECT uuid FROM admin WHERE uuid = ?)) WHERE uuid = ?`, [entry.adminUuid ?? null, ticketUuid])
        break
      }

      default:
        break
    }
  } catch (e) {
    const msg = (e as any)?.message
    if (msg === 'GUEST_UPSERT_FAILED') throw new Error('MISSING_DEPENDENCY')
    if (msg === 'MISSING_DEPENDENCY') throw e
    throw e
  }
}

export function hasLogBeenApplied(
  adapter: DbAdapter,
  uuid: string,
): boolean {
  return exists(adapter, `SELECT 1 FROM ticketLogApplied WHERE uuid = ? AND "timeStamp" IS NOT NULL LIMIT 1`, [uuid])
}

function claimLog(adapter: DbAdapter, entry: TicketLogEntry): void {
  adapter.run(`INSERT OR IGNORE INTO "ticketLogApplied" ("uuid", "timeStamp", "retryCount") VALUES (?, NULL, 0)`, [entry.uuid])
}

function markLogApplied(adapter: DbAdapter, entry: TicketLogEntry): void {
  adapter.run(`UPDATE "ticketLogApplied" SET "timeStamp" = ?, "retryCount" = NULL, "nextRetryAt" = NULL, "lastError" = NULL WHERE "uuid" = ?`, [entry.timeStamp, entry.uuid])
}

function failLog(adapter: DbAdapter, entry: TicketLogEntry, error: string): void {
  adapter.run(
    `UPDATE "ticketLogApplied" SET "retryCount" = COALESCE("retryCount", 0) + 1, "nextRetryAt" = ? + (COALESCE("retryCount", 0) + 1) * 10000, "lastError" = ? WHERE "uuid" = ?`,
    [Date.now(), error.slice(0, 255), entry.uuid],
  )
}

export function applyLogsBatch(
  adapter: DbAdapter,
  logs: TicketLogEntry[],
): {
  applied: number
  skipped: number
  errors: { entry: TicketLogEntry; error: unknown }[]
} {
  let applied = 0
  let skipped = 0
  const errors: { entry: TicketLogEntry; error: unknown }[] = []

  if (!logs.length) return { applied, skipped, errors }

  const sorted = [...logs].sort((a, b) => {
    const pa = ACTION_PRIORITY[a.action] ?? 999
    const pb = ACTION_PRIORITY[b.action] ?? 999
    if (pa !== pb) return pa - pb
    if (a.uuid < b.uuid) return -1
    if (a.uuid > b.uuid) return 1
    return 0
  })

  for (const entry of sorted) {
    try {
      if (hasLogBeenApplied(adapter, entry.uuid)) {
        skipped++
        continue
      }

      claimLog(adapter, entry)

      adapter.run('BEGIN')

      try {
        applyTicketLog(adapter, entry)
        markLogApplied(adapter, entry)
        adapter.run('COMMIT')
        applied++
      } catch (error: any) {
        adapter.run('ROLLBACK')

        if (error?.message === 'MISSING_DEPENDENCY') {
          skipped++
          continue
        }

        failLog(adapter, entry, (error as any)?.message ?? 'Unknown error')
        errors.push({ entry, error })
      }
    } catch (fatal) {
      errors.push({ entry, error: fatal })
    }
  }

  return { applied, skipped, errors }
}

export function handleAddPaymentLog(
  adapter: DbAdapter,
  entry: TicketLogEntry,
  payload: AddPaymentPayload,
): void {
  ensureTicketExists(adapter, entry)

  if (exists(adapter, `SELECT 1 FROM "ticketPayment" WHERE "ticketUuid" = ? AND "paymentUuid" = ?`, [entry.ticketUuid, payload.paymentUuid])) return

  if (!exists(adapter, `SELECT 1 FROM payment WHERE uuid = ? LIMIT 1`, [payload.paymentUuid])) {
    throw new Error('MISSING_DEPENDENCY')
  }

  adapter.run(
    `INSERT INTO "ticketPayment" ("uuid", "ticketUuid", "paymentUuid", "priceWhole", "priceHundredths", "code", "complete") VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
