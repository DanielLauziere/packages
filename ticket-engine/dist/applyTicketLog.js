import { v4 as uuidv4 } from 'uuid';
export const ACTION_PRIORITY = {
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
};
function crc32(str) {
    let crc = 0xffffffff;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        crc ^= ch;
        for (let j = 0; j < 8; j++) {
            crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function ticketIdFromUUID(ticketUuid) {
    return (crc32(ticketUuid) % 90000) + 10000;
}
function exists(adapter, sql, params) {
    const rows = adapter.query(sql, params);
    return (rows?.length ?? 0) > 0;
}
function ensureTicketExists(adapter, entry) {
    if (exists(adapter, `SELECT uuid FROM ticket WHERE uuid = ? LIMIT 1`, [entry.ticketUuid]))
        return;
    adapter.run(`INSERT INTO "ticket" (uuid, id, "timeStamp", "locationGroupUuid", status, "isDirty", "isLocal")
     VALUES (?, ?, ?, ?, 'INCOMPLETE', 1, 1)`, [entry.ticketUuid, ticketIdFromUUID(entry.ticketUuid), entry.timeStamp, entry.locationGroupUuid]);
}
function upsertGuest(adapter, uuid, username, email, phone) {
    const finalUuid = uuid || uuidv4();
    adapter.run(`INSERT INTO guest (uuid, username, email, phone)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET username = excluded.username`, [finalUuid, username, email ?? null, phone ?? null]);
    const rows = adapter.query(`SELECT uuid FROM guest WHERE username = ? LIMIT 1`, [username]);
    const found = rows?.[0]?.uuid;
    if (!found)
        throw new Error('GUEST_UPSERT_FAILED');
    return found;
}
export function applyTicketLog(adapter, entry) {
    const { action, payload, ticketUuid } = entry;
    try {
        switch (action) {
            case 'SET_TABLE': {
                const p = payload;
                if (p.tableUuid && !exists(adapter, `SELECT 1 FROM "table" WHERE uuid = ?`, [p.tableUuid])) {
                    throw new Error('MISSING_DEPENDENCY');
                }
                adapter.run(`UPDATE "ticket" SET "tableUuid" = ?, "isDirty" = 1 WHERE uuid = ?`, [p.tableUuid, ticketUuid]);
                break;
            }
            case 'SET_GUEST': {
                const p = payload;
                if (!p.guestUserName && !p.guestUuid)
                    break;
                const guest = upsertGuest(adapter, p.guestUuid, p.guestUserName, p.email, p.phone);
                adapter.run(`UPDATE ticket SET "guestUuid" = ? WHERE uuid = ?`, [guest, ticketUuid]);
                break;
            }
            case 'SET_FULFILLMENT': {
                const p = payload;
                if (p.fulfillmentUuid && !exists(adapter, `SELECT 1 FROM fulfillment WHERE uuid = ?`, [p.fulfillmentUuid])) {
                    throw new Error('MISSING_DEPENDENCY');
                }
                adapter.run(`UPDATE ticket SET fulfillmentUuid = ? WHERE uuid = ?`, [p.fulfillmentUuid, ticketUuid]);
                break;
            }
            case 'SET_ANONYMOUS_ADDRESS': {
                const p = payload;
                adapter.run(`UPDATE "ticket" SET "anonymousAddress" = ?, "isDirty" = 1 WHERE uuid = ?`, [p.address, ticketUuid]);
                break;
            }
            case 'ADD_ITEM': {
                const p = payload;
                ensureTicketExists(adapter, entry);
                if (!exists(adapter, `SELECT 1 FROM menuItem WHERE uuid = ? LIMIT 1`, [p.menuItemUuid])) {
                    throw new Error('MISSING_DEPENDENCY');
                }
                adapter.run(`INSERT OR IGNORE INTO ticketMenuItem (uuid, ticketUuid, menuItemUuid) VALUES (?, ?, ?)`, [entry.uuid, ticketUuid, p.menuItemUuid]);
                break;
            }
            case 'REMOVE_ITEM': {
                const p = payload;
                const { ticketMenuItemUuid } = p;
                if (!exists(adapter, `SELECT 1 FROM ticketMenuItem WHERE uuid = ? LIMIT 1`, [ticketMenuItemUuid]))
                    return;
                adapter.run(`DELETE FROM "ticketMenuItemModifier" WHERE "ticketMenuItemUuid" = ?`, [ticketMenuItemUuid]);
                adapter.run(`DELETE FROM "ticketPromotion" WHERE "ticketMenuItemUuid" = ?`, [ticketMenuItemUuid]);
                adapter.run(`DELETE FROM "ticketMenuItem" WHERE uuid = ?`, [ticketMenuItemUuid]);
                break;
            }
            case 'SET_ITEM_NOTE': {
                const p = payload;
                if (!exists(adapter, `SELECT 1 FROM ticketMenuItem WHERE uuid = ? LIMIT 1`, [p.ticketMenuItemUuid])) {
                    throw new Error('MISSING_DEPENDENCY');
                }
                adapter.run(`UPDATE ticketMenuItem SET note = ? WHERE uuid = ?`, [p.note, p.ticketMenuItemUuid]);
                break;
            }
            case 'ADD_MODIFIER': {
                const p = payload;
                ensureTicketExists(adapter, entry);
                if (!exists(adapter, `SELECT 1 FROM ticketMenuItem WHERE uuid = ? LIMIT 1`, [p.ticketMenuItemUuid])) {
                    throw new Error('MISSING_DEPENDENCY');
                }
                if (!exists(adapter, `SELECT 1 FROM modifier WHERE uuid = ? LIMIT 1`, [p.modifierUuid])) {
                    throw new Error('MISSING_DEPENDENCY');
                }
                adapter.run(`INSERT OR IGNORE INTO "ticketMenuItemModifier" (uuid, "ticketUuid", "modifierUuid", "ticketMenuItemUuid") VALUES (?, ?, ?, ?)`, [entry.uuid, ticketUuid, p.modifierUuid, p.ticketMenuItemUuid]);
                break;
            }
            case 'REMOVE_MODIFIER': {
                const p = payload;
                const { ticketMenuItemModifierUuid } = p;
                if (ticketMenuItemModifierUuid && !exists(adapter, `SELECT 1 FROM ticketMenuItemModifier WHERE uuid = ? LIMIT 1`, [ticketMenuItemModifierUuid]))
                    return;
                adapter.run(`DELETE FROM "ticketMenuItemModifier" WHERE uuid = ?`, [ticketMenuItemModifierUuid]);
                break;
            }
            case 'APPLY_PROMOTION': {
                const p = payload;
                ensureTicketExists(adapter, entry);
                if (p.ticketMenuItemUuid && !exists(adapter, `SELECT 1 FROM ticketMenuItem WHERE uuid = ? LIMIT 1`, [p.ticketMenuItemUuid])) {
                    throw new Error('MISSING_DEPENDENCY');
                }
                if (!exists(adapter, `SELECT 1 FROM promotion WHERE uuid = ? LIMIT 1`, [p.promotionUuid])) {
                    throw new Error('MISSING_DEPENDENCY');
                }
                const dedupSql = `SELECT uuid FROM "ticketPromotion" WHERE "ticketUuid" = ? AND "promotionUuid" = ? AND ("ticketMenuItemUuid" = ? OR ("ticketMenuItemUuid" IS NULL AND ? IS NULL))`;
                const dedupParams = [ticketUuid, p.promotionUuid, p.ticketMenuItemUuid ?? null, p.ticketMenuItemUuid ?? null];
                if (!exists(adapter, dedupSql, dedupParams)) {
                    adapter.run(`INSERT OR IGNORE INTO "ticketPromotion" ("uuid", "timeStamp", "ticketUuid", "promotionUuid", "ticketMenuItemUuid") VALUES (?, ?, ?, ?, ?)`, [entry.uuid, new Date().toISOString(), ticketUuid, p.promotionUuid, p.ticketMenuItemUuid ?? null]);
                }
                break;
            }
            case 'REMOVE_PROMOTION': {
                const p = payload;
                if (!exists(adapter, `SELECT 1 FROM promotion WHERE uuid = ? LIMIT 1`, [p.promotionUuid])) {
                    throw new Error('MISSING_DEPENDENCY');
                }
                adapter.run(`DELETE FROM "ticketPromotion" WHERE "promotionUuid" = ?`, [p.promotionUuid]);
                break;
            }
            case 'ADD_PAYMENT': {
                const p = payload;
                handleAddPaymentLog(adapter, entry, p);
                break;
            }
            case 'SET_STATUS_COMPLETE': {
                adapter.run(`UPDATE ticket SET status = 'COMPLETE' WHERE uuid = ?`, [ticketUuid]);
                break;
            }
            case 'SET_STATUS_ACCEPTED': {
                adapter.run(`UPDATE ticket SET status = 'ACCEPTED' WHERE uuid = ?`, [ticketUuid]);
                break;
            }
            case 'SET_STATUS_PAID': {
                adapter.run(`UPDATE ticket SET status = 'PAID' WHERE uuid = ?`, [ticketUuid]);
                break;
            }
            default:
                break;
        }
    }
    catch (e) {
        const msg = e?.message;
        if (msg === 'GUEST_UPSERT_FAILED')
            throw new Error('MISSING_DEPENDENCY');
        if (msg === 'MISSING_DEPENDENCY')
            throw e;
        throw e;
    }
}
export function hasLogBeenApplied(adapter, uuid) {
    return exists(adapter, `SELECT 1 FROM ticketLogApplied WHERE uuid = ? LIMIT 1`, [uuid]);
}
function markLogApplied(adapter, entry) {
    adapter.run(`INSERT OR IGNORE INTO ticketLogApplied (uuid, timeStamp) VALUES (?, ?)`, [entry.uuid, entry.timeStamp]);
}
export function applyLogsBatch(adapter, logs) {
    let applied = 0;
    let skipped = 0;
    const errors = [];
    if (!logs.length)
        return { applied, skipped, errors };
    const sorted = [...logs].sort((a, b) => {
        const pa = ACTION_PRIORITY[a.action] ?? 999;
        const pb = ACTION_PRIORITY[b.action] ?? 999;
        if (pa !== pb)
            return pa - pb;
        if (a.uuid < b.uuid)
            return -1;
        if (a.uuid > b.uuid)
            return 1;
        return 0;
    });
    for (const entry of sorted) {
        try {
            if (hasLogBeenApplied(adapter, entry.uuid)) {
                skipped++;
                continue;
            }
            adapter.run('BEGIN');
            try {
                applyTicketLog(adapter, entry);
                markLogApplied(adapter, entry);
                adapter.run('COMMIT');
                applied++;
            }
            catch (error) {
                adapter.run('ROLLBACK');
                if (error?.message === 'MISSING_DEPENDENCY') {
                    skipped++;
                    continue;
                }
                errors.push({ entry, error });
            }
        }
        catch (fatal) {
            errors.push({ entry, error: fatal });
        }
    }
    return { applied, skipped, errors };
}
export function handleAddPaymentLog(adapter, entry, payload) {
    if (exists(adapter, `SELECT 1 FROM "ticketPayment" WHERE "ticketUuid" = ? AND "paymentUuid" = ?`, [entry.ticketUuid, payload.paymentUuid]))
        return;
    if (!exists(adapter, `SELECT 1 FROM payment WHERE uuid = ? LIMIT 1`, [payload.paymentUuid])) {
        throw new Error('MISSING_DEPENDENCY');
    }
    adapter.run(`INSERT INTO "ticketPayment" ("uuid", "ticketUuid", "paymentUuid", "priceWhole", "priceHundredths", "code", "complete") VALUES (?, ?, ?, ?, ?, ?, ?)`, [
        entry.uuid,
        entry.ticketUuid,
        payload.paymentUuid,
        payload.priceWhole,
        payload.priceHundredths,
        payload.code ?? null,
        payload.complete ? 1 : 0,
    ]);
}
//# sourceMappingURL=applyTicketLog.js.map