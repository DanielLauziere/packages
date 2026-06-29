import { DbAdapter } from './dbAdapter.js';
export declare function isTicketPrinted(adapter: DbAdapter, ticketUuid: string): boolean;
export declare function markTicketPrinted(adapter: DbAdapter, ticketUuid: string, source: 'online' | 'offline'): void;
export declare function getPendingSyncRecords(adapter: DbAdapter): {
    ticketUuid: string;
    decision: string;
    printedAt: number | null;
    synced: number;
}[];
export declare function markSynced(adapter: DbAdapter, ticketUuid: string): void;
export declare function clearAllPrintRecords(adapter: DbAdapter): void;
export type PrintClaimData = {
    alreadyPrinted: boolean;
    claimed: boolean;
};
export type PrintRetryOptions = {
    maxRetries?: number;
    retryDelayMs?: number;
    onOfflineDecision?: () => Promise<'print' | 'skip'>;
};
export type PrintRetryApis = {
    claimTicket: (locationGroupUuid: string, ticketUuid: string, deviceId: string) => Promise<PrintClaimData | null>;
    confirmPrinted: (locationGroupUuid: string, ticketUuid: string) => Promise<boolean>;
    printTicket: () => Promise<void>;
};
export declare function printTicketWithRetry(adapter: DbAdapter, ticketUuid: string, deviceId: string, locationGroupUuid: string, options: PrintRetryOptions, apis: PrintRetryApis): Promise<void>;
//# sourceMappingURL=printRetry.d.ts.map