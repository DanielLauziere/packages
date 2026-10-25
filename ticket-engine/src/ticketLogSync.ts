export interface TicketLogPushLog {
  uuid: string;
  ticket_uuid: string;
  action: string;
  payload?: unknown;
  time_stamp: number | string;
  admin_uuid?: string | null;
}

export interface TicketLogPullResponse<TLog = TicketLogPushLog> {
  logs: TLog[];
  next_seq: number;
  has_more: boolean;
  server_timestamp: number;
}

export const PUSH_BATCH_BYTES = 32 * 1024;
export const PULL_PAGE_BYTES = 32 * 1024;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/** Keep each push request within its client-side JSON byte budget. */
export function chunkTicketLogPush<T extends TicketLogPushLog>(
  logs: T[],
  maxBytes = PUSH_BATCH_BYTES,
): T[][] {
  const batches: T[][] = [];
  let batch: T[] = [];

  for (const log of logs) {
    const candidate = [...batch, log];
    const bytes = utf8ByteLength(JSON.stringify({ logs: candidate }));
    if (batch.length > 0 && bytes > maxBytes) {
      batches.push(batch);
      batch = [log];
    } else {
      batch = candidate;
    }
  }

  if (batch.length > 0) batches.push(batch);
  return batches;
}
