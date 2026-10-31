import {
  type BucketMap,
  type CompactTicketBucketMap,
  type CompactTicketLog,
  type CompactTicketLogGroup,
} from './syncBuckets.js'

/** Stable wire IDs; ADD/REMOVE_MENU_ITEM map to the local ADD/REMOVE_ITEM actions. */
export const TICKET_LOG_ACTION_IDS = {
  ADD_MENU_ITEM: 1,
  REMOVE_MENU_ITEM: 2,
  SET_TABLE: 3,
  SET_GUEST: 4,
  SET_FULFILLMENT: 5,
  SET_ANONYMOUS_ADDRESS: 6,
  SET_ITEM_NOTE: 7,
  ADD_MODIFIER: 8,
  REMOVE_MODIFIER: 9,
  APPLY_PROMOTION: 10,
  REMOVE_PROMOTION: 11,
  ADD_PAYMENT: 12,
  SET_STATUS_COMPLETE: 13,
  SET_STATUS_ACCEPTED: 14,
  SET_STATUS_READY: 15,
  SET_STATUS_PAID: 16,
  PRINT_SUCCESS: 17,
  PRINT_PASS: 18,
  PRINT_REQUEST: 19,
  PRINT_REASSIGN: 20,
} as const

const ACTION_ID_BY_NAME: Record<string, number> = {
  ADD_ITEM: TICKET_LOG_ACTION_IDS.ADD_MENU_ITEM,
  REMOVE_ITEM: TICKET_LOG_ACTION_IDS.REMOVE_MENU_ITEM,
  SET_TABLE: TICKET_LOG_ACTION_IDS.SET_TABLE,
  SET_GUEST: TICKET_LOG_ACTION_IDS.SET_GUEST,
  SET_FULFILLMENT: TICKET_LOG_ACTION_IDS.SET_FULFILLMENT,
  SET_ANONYMOUS_ADDRESS: TICKET_LOG_ACTION_IDS.SET_ANONYMOUS_ADDRESS,
  SET_ITEM_NOTE: TICKET_LOG_ACTION_IDS.SET_ITEM_NOTE,
  ADD_MODIFIER: TICKET_LOG_ACTION_IDS.ADD_MODIFIER,
  REMOVE_MODIFIER: TICKET_LOG_ACTION_IDS.REMOVE_MODIFIER,
  APPLY_PROMOTION: TICKET_LOG_ACTION_IDS.APPLY_PROMOTION,
  REMOVE_PROMOTION: TICKET_LOG_ACTION_IDS.REMOVE_PROMOTION,
  ADD_PAYMENT: TICKET_LOG_ACTION_IDS.ADD_PAYMENT,
  SET_STATUS_COMPLETE: TICKET_LOG_ACTION_IDS.SET_STATUS_COMPLETE,
  SET_STATUS_ACCEPTED: TICKET_LOG_ACTION_IDS.SET_STATUS_ACCEPTED,
  SET_STATUS_READY: TICKET_LOG_ACTION_IDS.SET_STATUS_READY,
  SET_STATUS_PAID: TICKET_LOG_ACTION_IDS.SET_STATUS_PAID,
  PRINT_SUCCESS: TICKET_LOG_ACTION_IDS.PRINT_SUCCESS,
  PRINT_PASS: TICKET_LOG_ACTION_IDS.PRINT_PASS,
  PRINT_REQUEST: TICKET_LOG_ACTION_IDS.PRINT_REQUEST,
  PRINT_REASSIGN: TICKET_LOG_ACTION_IDS.PRINT_REASSIGN,
}

const ACTION_NAME_BY_ID = new Map<number, string>(
  Object.entries(ACTION_ID_BY_NAME).map(([name, id]) => [id, name]),
)

export interface TicketLogWireInput {
  uuid: string
  action: string
  payload: unknown
  time_stamp: number
  admin_uuid?: string | null
}

export interface DecodedTicketLog extends TicketLogWireInput {
  ticket_uuid: string
  location_group_uuid: string
}

export const actionIdForTicketLog = (action: string): number => {
  const id = ACTION_ID_BY_NAME[action]
  if (id === undefined) {
    throw new Error(`unknown ticket-log action: ${action}`)
  }
  return id
}

const actionNameForTicketLog = (id: number): string => {
  const action = ACTION_NAME_BY_ID.get(id)
  if (!action) {
    throw new Error(`unknown ticket-log action ID: ${id}`)
  }
  return action
}

/**
 * The compact wire drops per-row timestamps — `decodeTicketLogGroup` stamps
 * every row with the group's last-adjustment time. The completion time must
 * therefore ride the payload: every SET_STATUS_COMPLETE that crosses the wire
 * carries `p.timeStamp` (its own pre-wire row time), which is what the shared
 * age-badge anchor (`TICKET_AGE_ANCHOR_SQL`) reads back. Existing payloads
 * keep their value; only rows without a usable one are backfilled (legacy
 * rows — the stored row time is the best completion value available).
 */
const withCompletionTimeStamp = (
  payload: unknown,
  time_stamp: number,
): unknown => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
    return payload
  const obj = payload as Record<string, unknown>
  const existing = obj.timeStamp
  if (
    typeof existing === 'number' &&
    Number.isSafeInteger(existing) &&
    existing > 0
  ) {
    return payload
  }
  return { ...obj, timeStamp: time_stamp }
}

export const encodeTicketLogGroup = (
  sourceLogs: TicketLogWireInput[],
): CompactTicketLogGroup => {
  if (sourceLogs.length === 0) {
    throw new Error('cannot encode an empty ticket-log group')
  }

  const logs = [...sourceLogs].sort(
    (left, right) =>
      left.time_stamp - right.time_stamp ||
      left.uuid.localeCompare(right.uuid),
  )

  const wireLogs: CompactTicketLog[] = []
  const adminUuids: string[] = []
  const seenAdmins = new Set<string>()
  let completedAt: number | undefined
  for (const log of logs) {
    if (!Number.isSafeInteger(log.time_stamp)) {
      throw new Error(`invalid ticket-log timestamp: ${log.uuid}`)
    }
    wireLogs.push({
      u: log.uuid,
      a: actionIdForTicketLog(log.action),
      p:
        log.action === 'SET_STATUS_COMPLETE'
          ? withCompletionTimeStamp(log.payload, log.time_stamp)
          : log.payload,
    })

    if (log.action === 'SET_STATUS_COMPLETE') {
      completedAt = Math.max(completedAt ?? log.time_stamp, log.time_stamp)
    }

    const adminUuid = log.admin_uuid
    if (adminUuid && !seenAdmins.has(adminUuid)) {
      seenAdmins.add(adminUuid)
      adminUuids.push(adminUuid)
    }
  }

  return {
    time_stamp: logs[logs.length - 1]!.time_stamp,
    admin_uuid: adminUuids,
    logs: wireLogs,
    ...(completedAt !== undefined ? { completed_at: completedAt } : {}),
  }
}

export const decodeTicketLogGroup = (
  ticketUuid: string,
  locationGroupUuid: string,
  group: CompactTicketLogGroup,
): DecodedTicketLog[] => {
  if (!Number.isSafeInteger(group.time_stamp)) {
    throw new Error(`invalid ticket timestamp: ${ticketUuid}`)
  }
  if (group.completed_at != null && !Number.isSafeInteger(group.completed_at)) {
    throw new Error(`invalid completed timestamp: ${ticketUuid}`)
  }
  if (!Array.isArray(group.logs) || group.logs.length === 0) {
    throw new Error(`invalid compact ticket-log group: ${ticketUuid}`)
  }
  if (
    !Array.isArray(group.admin_uuid) ||
    !group.admin_uuid.every((admin) => typeof admin === 'string')
  ) {
    throw new Error(`invalid compact ticket-log group: ${ticketUuid}`)
  }
  const creator = group.admin_uuid[0]

  return group.logs.map((log) => {
    if (
      typeof log?.u !== 'string' ||
      !Number.isInteger(log.a) ||
      !Object.prototype.hasOwnProperty.call(log, 'p')
    ) {
      throw new Error(`invalid compact ticket-log row: ${ticketUuid}`)
    }

    return {
      uuid: log.u,
      ticket_uuid: ticketUuid,
      location_group_uuid: locationGroupUuid,
      action: actionNameForTicketLog(log.a),
      payload: log.p,
      time_stamp: group.time_stamp,
      ...(creator ? { admin_uuid: creator } : {}),
    }
  })
}

export const encodeTicketLogBuckets = (
  buckets: BucketMap<TicketLogWireInput>,
): CompactTicketBucketMap => {
  const result: CompactTicketBucketMap = {}
  for (const [bucketKey, tickets] of Object.entries(buckets)) {
    const bucket = Number(bucketKey)
    result[bucket] = {}
    for (const [ticketUuid, logs] of Object.entries(tickets)) {
      if (logs.length > 0) {
        result[bucket]![ticketUuid] = encodeTicketLogGroup(logs)
      }
    }
    if (Object.keys(result[bucket]!).length === 0) delete result[bucket]
  }
  return result
}

export const decodeTicketLogBuckets = (
  buckets: CompactTicketBucketMap,
  locationGroupUuid: string,
): BucketMap<DecodedTicketLog> => {
  const result: BucketMap<DecodedTicketLog> = {}
  for (const [bucketKey, tickets] of Object.entries(buckets)) {
    const bucket = Number(bucketKey)
    result[bucket] = {}
    for (const [ticketUuid, group] of Object.entries(tickets)) {
      result[bucket]![ticketUuid] = decodeTicketLogGroup(
        ticketUuid,
        locationGroupUuid,
        group,
      )
    }
  }
  return result
}
