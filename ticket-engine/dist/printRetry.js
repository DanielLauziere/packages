// ── Print Record CRUD ──
export function isTicketPrinted(adapter, ticketUuid) {
    const rows = adapter.query('SELECT 1 FROM printRecord WHERE ticketUuid = ? AND decision = ? LIMIT 1', [ticketUuid, 'printed']);
    return (rows?.length ?? 0) > 0;
}
export function markTicketPrinted(adapter, ticketUuid, source) {
    adapter.run(`INSERT OR REPLACE INTO printRecord (ticketUuid, decision, printedAt, synced)
     VALUES (?, 'printed', ?, ?)`, [ticketUuid, Date.now(), source === 'online' ? 1 : 0]);
}
export function getPendingSyncRecords(adapter) {
    return adapter.query('SELECT ticketUuid, decision, printedAt, synced FROM printRecord WHERE synced = 0');
}
export function markSynced(adapter, ticketUuid) {
    adapter.run('UPDATE printRecord SET synced = 1 WHERE ticketUuid = ?', [ticketUuid]);
}
export function clearAllPrintRecords(adapter) {
    adapter.run('DELETE FROM printRecord');
}
export async function printTicketWithRetry(adapter, ticketUuid, deviceId, locationGroupUuid, options, apis) {
    const { maxRetries = 60, retryDelayMs = 2000, onOfflineDecision } = options;
    let attempt = 0;
    let networkFailures = 0;
    const delay = (ms) => new Promise((res) => setTimeout(res, ms));
    while (attempt < maxRetries && !isTicketPrinted(adapter, ticketUuid)) {
        try {
            const claimData = await apis.claimTicket(locationGroupUuid, ticketUuid, deviceId);
            if (claimData === null) {
                networkFailures++;
                if (networkFailures >= 3 && onOfflineDecision) {
                    const decision = await onOfflineDecision();
                    if (decision === 'print') {
                        await apis.printTicket();
                        markTicketPrinted(adapter, ticketUuid, 'offline');
                    }
                    return;
                }
                attempt++;
                await delay(retryDelayMs);
                continue;
            }
            networkFailures = 0;
            if (claimData.alreadyPrinted) {
                markTicketPrinted(adapter, ticketUuid, 'online');
                return;
            }
            if (!claimData.claimed) {
                attempt++;
                await delay(retryDelayMs + Math.random() * 500);
                continue;
            }
            await apis.printTicket();
            const confirmed = await apis.confirmPrinted(locationGroupUuid, ticketUuid);
            if (!confirmed) {
                throw new Error('Failed to confirm print');
            }
            markTicketPrinted(adapter, ticketUuid, 'online');
            return;
        }
        catch (err) {
            attempt++;
            if (attempt < maxRetries) {
                await delay(retryDelayMs);
            }
            else {
                throw err;
            }
        }
    }
}
//# sourceMappingURL=printRetry.js.map