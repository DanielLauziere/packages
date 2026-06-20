import { DbAdapter } from './dbAdapter.js';
import { AddPaymentPayload } from './types.js';
export interface TicketLogEntry {
    uuid: string;
    ticketUuid: string;
    locationGroupUuid: string;
    action: string;
    payload: any;
    timeStamp: number;
    adminUuid?: string;
}
export declare function applyTicketLog(adapter: DbAdapter, entry: TicketLogEntry): void;
export declare function hasLogBeenApplied(adapter: DbAdapter, uuid: string): boolean;
export declare function applyLogsBatch(adapter: DbAdapter, logs: TicketLogEntry[]): {
    applied: number;
    skipped: number;
    errors: {
        entry: TicketLogEntry;
        error: unknown;
    }[];
};
export declare function handleAddPaymentLog(adapter: DbAdapter, entry: TicketLogEntry, payload: AddPaymentPayload): void;
//# sourceMappingURL=applyTicketLog.d.ts.map