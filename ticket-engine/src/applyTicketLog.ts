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
  ticket_uuid: string
  location_group_uuid: string
  action: string
  payload: any
  time_stamp: number
  admin_uuid?: string
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

async function exists(
  adapter: DbAdapter,
  sql: string,
  params: any[],
): Promise<boolean> {
  const rows = await adapter.query(sql, params)
  return (rows?.length ?? 0) > 0
}

async function ensureTicketExists(
  adapter: DbAdapter,
  entry: TicketLogEntry,
): Promise<void> {
  if (await exists(adapter, `SELECT uuid FROM ticket WHERE uuid = ? LIMIT 1`, [entry.ticket_uuid])) return

  await adapter.run(
    `INSERT INTO "ticket" (uuid, id, time_stamp, location_group_uuid, admin_uuid, status, price_whole, price_hundredths, is_dirty, is_local)
     VALUES (?, ?, ?, ?, (SELECT uuid FROM admin WHERE uuid = ?), 'INCOMPLETE', 0, 0, 1, 1)`,
    [entry.ticket_uuid, ticketIdFromUUID(entry.ticket_uuid), entry.time_stamp, entry.location_group_uuid, entry.admin_uuid ?? null],
  )
}

async function upsertGuest(
  adapter: DbAdapter,
  username: string,
  email?: string,
  phone?: string,
): Promise<string> {
  const finalUuid = uuidv5(username, '6ba7b810-9dad-11d1-80b4-00c04fd430c8')

  await adapter.run(
    `INSERT INTO guest (uuid, user_name, email, phone)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_name) DO UPDATE SET user_name = excluded.user_name`,
    [finalUuid, username, email ?? null, phone ?? null],
  )

  const rows = await adapter.query(`SELECT uuid FROM guest WHERE user_name = ? LIMIT 1`, [username])
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

export async function applyTicketLog(
  adapter: DbAdapter,
  entry: TicketLogEntry,
): Promise<void> {
  const { action, payload, ticket_uuid: ticketUuid } = entry

  try {
    switch (action) {
      case 'SET_TABLE': {
        const p = payload as { table_uuid: string }
        await ensureTicketExists(adapter, entry)
        if (p.table_uuid && !await exists(adapter, `SELECT 1 FROM dining_table WHERE uuid = ?`, [p.table_uuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }
        await adapter.run(`UPDATE "ticket" SET table_uuid = ?, is_dirty = 1, admin_uuid = COALESCE(admin_uuid, (SELECT uuid FROM admin WHERE uuid = ?)) WHERE uuid = ?`, [p.table_uuid, entry.admin_uuid ?? null, ticketUuid])
        break
      }

      case 'SET_GUEST': {
        const p = payload as { guest_user_name: string; email?: string; phone?: string }
        if (!p.guest_user_name) break

        await ensureTicketExists(adapter, entry)

        const raw = p.guest_user_name.trim()
        let userName = raw
        let email = p.email ?? ''
        let phone = p.phone ?? ''
        const at = raw.indexOf('@')

        if (at !== -1) {
          userName = raw.toLowerCase()
          if (!email) email = userName
        } else if (/\d/.test(raw)) {
          const phoneCodeRows = await adapter.query(
            `SELECT c.phonecode as phoneCode
             FROM location_group lg
             INNER JOIN country c ON lg.country_uuid = c.uuid
             WHERE lg.uuid = ?`,
            [entry.location_group_uuid],
          )
          const countryCode = String((phoneCodeRows as any[])?.[0]?.phoneCode ?? '503')
          const normalized = normalizePhone(raw, countryCode)
          if (normalized) {
            userName = normalized
            email = ''
            phone = normalized
          }
        }

        const guest = await upsertGuest(adapter, userName, email, phone)

        await adapter.run(`UPDATE ticket SET guest_uuid = ?, admin_uuid = COALESCE(admin_uuid, (SELECT uuid FROM admin WHERE uuid = ?)) WHERE uuid = ?`, [guest, entry.admin_uuid ?? null, ticketUuid])
        break
      }

      case 'SET_FULFILLMENT': {
        const p = payload as { fulfillment_uuid: string }
        await ensureTicketExists(adapter, entry)
        if (p.fulfillment_uuid && !await exists(adapter, `SELECT 1 FROM fulfillment WHERE uuid = ?`, [p.fulfillment_uuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }
        await adapter.run(`UPDATE ticket SET fulfillment_uuid = ?, admin_uuid = COALESCE(admin_uuid, (SELECT uuid FROM admin WHERE uuid = ?)) WHERE uuid = ?`, [p.fulfillment_uuid, entry.admin_uuid ?? null, ticketUuid])
        break
      }

      case 'SET_ANONYMOUS_ADDRESS': {
        const p = payload as SetAnonymousAddressPayload
        await ensureTicketExists(adapter, entry)
        await adapter.run(`UPDATE "ticket" SET anonymous_address = ?, is_dirty = 1, admin_uuid = COALESCE(admin_uuid, (SELECT uuid FROM admin WHERE uuid = ?)) WHERE uuid = ?`, [p.address, entry.admin_uuid ?? null, ticketUuid])
        break
      }

      case 'ADD_ITEM': {
        const p = payload as AddItemPayload
        await ensureTicketExists(adapter, entry)

        if (!await exists(adapter, `SELECT 1 FROM menu_item WHERE uuid = ? LIMIT 1`, [p.menu_item_uuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }

        await adapter.run(
          `INSERT OR IGNORE INTO ticket_menu_item (uuid, ticket_uuid, menu_item_uuid) VALUES (?, ?, ?)`,
          [entry.uuid, ticketUuid, p.menu_item_uuid],
        )
        break
      }

      case 'REMOVE_ITEM': {
        const p = payload as RemoveItemPayload
        const { ticket_menu_item_uuid: ticketMenuItemUuid } = p

        await ensureTicketExists(adapter, entry)

        if (!await exists(adapter, `SELECT 1 FROM ticket_menu_item WHERE uuid = ? LIMIT 1`, [ticketMenuItemUuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }

        await adapter.run(`DELETE FROM "ticket_menu_item_modifier" WHERE ticket_menu_item_uuid = ?`, [ticketMenuItemUuid])
        await adapter.run(`DELETE FROM "ticket_promotion" WHERE ticket_menu_item_uuid = ?`, [ticketMenuItemUuid])
        await adapter.run(`DELETE FROM "ticket_menu_item" WHERE uuid = ?`, [ticketMenuItemUuid])
        break
      }

      case 'SET_ITEM_NOTE': {
        const p = payload as SetItemNotePayload

        await ensureTicketExists(adapter, entry)

        if (!await exists(adapter, `SELECT 1 FROM ticket_menu_item WHERE uuid = ? LIMIT 1`, [p.ticket_menu_item_uuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }

        await adapter.run(`UPDATE ticket_menu_item SET note = ? WHERE uuid = ?`, [p.note, p.ticket_menu_item_uuid])
        break
      }

      case 'ADD_MODIFIER': {
        const p = payload as AddModifierPayload
        await ensureTicketExists(adapter, entry)

        if (!await exists(adapter, `SELECT 1 FROM ticket_menu_item WHERE uuid = ? LIMIT 1`, [p.ticket_menu_item_uuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }

        if (!await exists(adapter, `SELECT 1 FROM modifier WHERE uuid = ? LIMIT 1`, [p.modifier_uuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }

        await adapter.run(
          `INSERT OR IGNORE INTO "ticket_menu_item_modifier" (uuid, ticket_uuid, modifier_uuid, ticket_menu_item_uuid, time_stamp) VALUES (?, ?, ?, ?, ?)`,
          [entry.uuid, ticketUuid, p.modifier_uuid, p.ticket_menu_item_uuid, new Date(entry.time_stamp).toISOString()],
        )
        break
      }

      case 'REMOVE_MODIFIER': {
        const p = payload as RemoveModifierPayload
        const { ticket_menu_item_modifier_uuid: ticketMenuItemModifierUuid } = p

        await ensureTicketExists(adapter, entry)

        if (!await exists(adapter, `SELECT 1 FROM ticket_menu_item_modifier WHERE uuid = ? LIMIT 1`, [ticketMenuItemModifierUuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }

        await adapter.run(`DELETE FROM "ticket_menu_item_modifier" WHERE uuid = ?`, [ticketMenuItemModifierUuid])
        break
      }

      case 'APPLY_PROMOTION': {
        const p = payload as ApplyPromotionPayload
        await ensureTicketExists(adapter, entry)

        if (p.ticket_menu_item_uuid && !await exists(adapter, `SELECT 1 FROM ticket_menu_item WHERE uuid = ? LIMIT 1`, [p.ticket_menu_item_uuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }

        if (!await exists(adapter, `SELECT 1 FROM promotion WHERE uuid = ? LIMIT 1`, [p.promotion_uuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }

        if (p.ticket_menu_item_uuid) {
          // Item-level promotion: replace any existing promotion on this menu item
          await adapter.run(
            `DELETE FROM "ticket_promotion" WHERE ticket_uuid = ? AND ticket_menu_item_uuid = ? AND ticket_menu_item_uuid IS NOT NULL`,
            [ticketUuid, p.ticket_menu_item_uuid],
          )
        } else {
          // Itemless promotion: dedup to prevent duplicate itemless reward
          const dedupSql = `SELECT uuid FROM "ticket_promotion" WHERE ticket_uuid = ? AND promotion_uuid = ? AND ticket_menu_item_uuid IS NULL`
          if (await exists(adapter, dedupSql, [ticketUuid, p.promotion_uuid])) {
            break
          }
        }

        await adapter.run(
          `INSERT OR IGNORE INTO "ticket_promotion" (uuid, time_stamp, ticket_uuid, promotion_uuid, ticket_menu_item_uuid) VALUES (?, ?, ?, ?, ?)`,
          [entry.uuid, new Date().toISOString(), ticketUuid, p.promotion_uuid, p.ticket_menu_item_uuid ?? null],
        )
        break
      }

      case 'REMOVE_PROMOTION': {
        const p = payload as RemovePromotionPayload
        await ensureTicketExists(adapter, entry)
        if (!await exists(adapter, `SELECT 1 FROM promotion WHERE uuid = ? LIMIT 1`, [p.promotion_uuid])) {
          throw new Error('MISSING_DEPENDENCY')
        }
        await adapter.run(`DELETE FROM "ticket_promotion" WHERE ticket_uuid = ? AND promotion_uuid = ?`, [ticketUuid, p.promotion_uuid])
        break
      }

      case 'ADD_PAYMENT': {
        const p = payload as AddPaymentPayload
        await handleAddPaymentLog(adapter, entry, p)
        break
      }

      case 'SET_STATUS_COMPLETE': {
        await ensureTicketExists(adapter, entry)
        await adapter.run(`UPDATE ticket SET status = 'COMPLETE', admin_uuid = COALESCE(admin_uuid, (SELECT uuid FROM admin WHERE uuid = ?)) WHERE uuid = ?`, [entry.admin_uuid ?? null, ticketUuid])
        break
      }

      case 'SET_STATUS_ACCEPTED': {
        await ensureTicketExists(adapter, entry)
        await adapter.run(`UPDATE ticket SET status = 'ACCEPTED', admin_uuid = COALESCE(admin_uuid, (SELECT uuid FROM admin WHERE uuid = ?)) WHERE uuid = ?`, [entry.admin_uuid ?? null, ticketUuid])
        break
      }

      case 'SET_STATUS_PAID': {
        await ensureTicketExists(adapter, entry)
        await adapter.run(`UPDATE ticket SET status = 'PAID', admin_uuid = COALESCE(admin_uuid, (SELECT uuid FROM admin WHERE uuid = ?)) WHERE uuid = ?`, [entry.admin_uuid ?? null, ticketUuid])
        break
      }

      default:
        throw new Error(`UNKNOWN_ACTION: ${action}`)
    }
  } catch (e) {
    const msg = (e as any)?.message
    if (msg === 'GUEST_UPSERT_FAILED') throw new Error('MISSING_DEPENDENCY')
    if (msg === 'MISSING_DEPENDENCY') throw e
    throw e
  }
}

export async function hasLogBeenApplied(
  adapter: DbAdapter,
  uuid: string,
): Promise<boolean> {
  return await exists(adapter, `SELECT 1 FROM ticket_log_applied WHERE uuid = ? AND time_stamp IS NOT NULL LIMIT 1`, [uuid])
}

async function claimLog(adapter: DbAdapter, entry: TicketLogEntry): Promise<void> {
  await adapter.run(`INSERT OR IGNORE INTO "ticket_log_applied" (uuid, time_stamp, retry_count) VALUES (?, NULL, 0)`, [entry.uuid])
}

async function markLogApplied(adapter: DbAdapter, entry: TicketLogEntry): Promise<void> {
  await adapter.run(`UPDATE "ticket_log_applied" SET time_stamp = ?, retry_count = NULL, next_retry_at = NULL, last_error = NULL WHERE uuid = ?`, [entry.time_stamp, entry.uuid])
}

async function failLog(adapter: DbAdapter, entry: TicketLogEntry, error: string): Promise<void> {
  await adapter.run(
    `UPDATE "ticket_log_applied" SET retry_count = COALESCE(retry_count, 0) + 1, next_retry_at = ? + (COALESCE(retry_count, 0) + 1) * 10000, last_error = ? WHERE uuid = ?`,
    [Date.now(), error.slice(0, 255), entry.uuid],
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

  if (!logs.length) return { applied, skipped, errors }

  const sorted = [...logs].sort((a, b) => {
    const pa = ACTION_PRIORITY[a.action] ?? 999
    const pb = ACTION_PRIORITY[b.action] ?? 999
    if (pa !== pb) return pa - pb
    if ((a.time_stamp ?? 0) < (b.time_stamp ?? 0)) return -1
    if ((a.time_stamp ?? 0) > (b.time_stamp ?? 0)) return 1
    if (a.uuid < b.uuid) return -1
    if (a.uuid > b.uuid) return 1
    return 0
  })

  for (const entry of sorted) {
    try {
      if (await hasLogBeenApplied(adapter, entry.uuid)) {
        skipped++
        continue
      }

      await claimLog(adapter, entry)

      await adapter.run('BEGIN')

      try {
        await applyTicketLog(adapter, entry)
        await markLogApplied(adapter, entry)
        await adapter.run('COMMIT')
        applied++
      } catch (error: any) {
        await adapter.run('ROLLBACK')

        if (error?.message === 'MISSING_DEPENDENCY') {
          skipped++
          continue
        }

        await failLog(adapter, entry, (error as any)?.message ?? 'Unknown error')
        errors.push({ entry, error })
      }
    } catch (fatal) {
      errors.push({ entry, error: fatal })
    }
  }

  return { applied, skipped, errors }
}

export async function handleAddPaymentLog(
  adapter: DbAdapter,
  entry: TicketLogEntry,
  payload: AddPaymentPayload,
): Promise<void> {
  await ensureTicketExists(adapter, entry)

  if (await exists(adapter, `SELECT 1 FROM "ticket_payment" WHERE ticket_uuid = ? AND payment_uuid = ?`, [entry.ticket_uuid, payload.payment_uuid])) return

  if (!await exists(adapter, `SELECT 1 FROM payment WHERE uuid = ? LIMIT 1`, [payload.payment_uuid])) {
    throw new Error('MISSING_DEPENDENCY')
  }

  await adapter.run(
    `INSERT INTO "ticket_payment" (uuid, ticket_uuid, payment_uuid, price_whole, price_hundredths, code, complete) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.uuid,
      entry.ticket_uuid,
      payload.payment_uuid,
      payload.price_whole,
      payload.price_hundredths,
      payload.code ?? null,
      payload.complete ? 1 : 0,
    ],
  )
}
