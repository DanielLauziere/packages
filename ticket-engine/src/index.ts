export { calculateCombos } from "./calculateCombos.js";
export {
  calculateLocationTickets,
  calculateLocationTicketsMemoized,
} from "./calculateLocationTickets.js";
export type {
  CalculateLocationTicketsInput,
  LocationTicketMemo,
} from "./calculateLocationTickets.js";
export { sanitizePayload } from "./sanitizePayload.js";
export {
  SCHEMA_UUID,
  FULL_DDL,
  SEED_ORDER,
  SEED_COLUMNS,
  SQLITE_MIN_VERSION,
  bundledDescriptor,
} from "./schema.js";
export type { Seed } from "./seedCommon.js";
export { seedGroupDatabase, validateSeedPayload } from "./seedGroupDatabase.js";
export {
  migrateSchema,
  applyDdl,
  getSchemaUuid,
  setSchemaUuid,
  splitStatements,
  dropAllTables,
  type MigrateResult,
  type SchemaDescriptor,
} from "./migrateSchema.js";
export {
  reconcileSchema,
  type ReconcileDescriptor,
  type ReconcileResult,
  type ReconcileOutcome,
  type ReconcileTable,
  type ReconcileColumn,
} from "./reconcileSchema.js";
export type { DbAdapter } from "./dbAdapter.js";
export {
  applyTicketLog,
  applyLogsBatch,
  hasLogBeenApplied,
  handleAddPaymentLog,
  normalizePhone,
  ACTION_PRIORITY,
} from "./applyTicketLog.js";
export {
  PRINT_SUCCESS,
  PRINT_PASS,
  PRINT_REQUEST,
  PRINT_REASSIGN,
  PRINT_ACTIONS,
  PRINT_ALERT_MS,
  foldPrintBaton,
  decidePrint,
  manualTakeoverAllowed,
} from "./printProtocol.js";
export type {
  PrintAction,
  PrintFoldState,
  PrintFold,
  PrintRow,
  PrintDeviceContext,
  PrintDecision,
} from "./printProtocol.js";
export {
  NUM_BUCKETS,
  fastHashUuid,
  BUCKET_HASH_SCALE,
  packBucketHash,
  bucketForTicket,
  buildBuckets,
  buildBucketHashes,
  flattenBuckets,
  getDirtyBuckets,
  stripBucketWireFields,
} from "./syncBuckets.js";
export type {
  BucketHashes,
  BucketMap,
  TicketLogBucketSyncResponse,
  SyncPullBlock,
  SyncPullCursor,
  SyncPullRequest,
} from "./syncBuckets.js";
export { CUTOFF_MS, THIRTY_MINUTES, SERVER_TIMESTAMP_OFFSET, RETRY_BACKOFF_CAP_STEPS } from "./consts.js";
export {
  getPriority,
  sortTicketLogs,
  normalizeLogs,
  groupLogsByTicket,
  isPaidTicket,
  filterTicketsByActivity,
} from "./syncQueue.js";
export type { SyncLogLike, SyncSummary, TicketsMapLike } from "./syncQueue.js";
export {
  switchLocationGroup,
} from "./locationGroupSwitch.js";
export type {
  VenueRef,
  SwitchResult,
  SwitchDeps,
} from "./locationGroupSwitch.js";
export { appendLog, insertLog, applyLog, applyTicketGroup } from "./ticketLogLedger.js";
export type { LedgerDeps, LedgerLogger, TicketLogRow, TicketGroupDeps } from "./ticketLogLedger.js";
export {
  DEFAULT_POD_URL,
  POD_URL_STORAGE_KEY,
  initialRosterState,
  applyPodMessage,
  normalizePodWsUrl,
  podQueueUrl,
  podStunUrl,
  reconnectDelayMs,
  RtcPodClient,
} from "./podClient.js";
export type {
  PodRosterState,
  PodEnvelope,
  PodMessage,
  PodClientHandlers,
} from "./podClient.js";
export {
  PRINT_ROWS_SQL,
  parsePrintPayload,
  mapPrintRows,
  readPrintFold,
  runBatonPrint,
  manualTakeover,
} from "./batonLoop.js";
export type { BatonResult, BatonDeps } from "./batonLoop.js";
export type { TicketLogEntry } from "./applyTicketLog.js";
export {
  rowFromDb,
  rowsFromDb,
  dbColumnName,
  dbTableName,
} from "./rowMapping.js";
export type * from "./types.js";
export * from "./escpos.js";
export { ticketIdFromUUID } from "./ticketId.js";
export { helpData, getHelpData } from "./help/index.js";
export { terminosData, getTerminosData } from "./terminos/index.js";
export {
  DTE_DEPARTAMENTOS,
  DTE_MUNICIPIOS,
  DTE_DISTRITOS,
  dteMunicipiosFor,
  dteDistritosFor,
  dteOptionLabel,
  dteOptionsWithCurrent,
} from "./dteAddressCatalog.js";
export type {
  DteAddressOption,
  DteMunicipioOption,
  DteDistritoOption,
} from "./dteAddressCatalog.js";
export type {
  HelpBlock,
  HelpBlockType,
  HelpSection,
  HelpData,
} from "./help/index.js";
export type {
  TerminosBlock,
  TerminosBlockType,
  TerminosSection,
  TerminosData,
} from "./terminos/index.js";
export {
  PLAN_NAMES,
  PLANS,
  formatCents,
  centsToDollar,
  getPlanLabel,
  getActivePriceOnDate,
  generateMonthlyInvoices,
  buildTimeline,
  formatDate,
} from "./billing.js";
export type {
  PlanChange,
  Balance,
  BillingResponse,
  PlanChangePreview,
  TimelineEvent,
} from "./billing.js";
export {
  FLOOR_SPRITES,
  FLOOR_ROOMS,
  FLOOR_SIZE_MULTIPLIERS,
  FLOOR_SIZE_MIN,
  FLOOR_SIZE_MAX,
  FLOOR_SIZE_DEFAULT,
  MAX_FLOOR_ITEMS,
  isFloorTableSprite,
  isTableActive,
  floorSpriteKind,
  floorSpriteSize,
  normalizeFloorSize,
  floorRotatedSize,
  floorItemBox,
  floorContentBox,
  validateFloorItems,
  placedTableUuids,
  unplacedTables,
  countOpenTicketsByTable,
  ticketStartActions,
  FULFILLMENT_UUID_EATIN,
} from "./floorSprites.js";
export type {
  FloorSpriteName,
  FloorSpriteKind,
  FloorRoomKind,
  FloorItem,
  FloorTableRef,
  FloorStartAction,
} from "./floorSprites.js";
export {
  NEW_TABLE_SPRITE,
  PLACEMENT_GAP,
  PLACEMENT_STEP,
  floorSpriteBoxAt,
  floorBoxesOverlap,
  findFloorFreeSpot,
  floorSpriteLabel,
  clampFloorCentre,
  floorSizeFitsRoom,
  stepFloorSize,
  floorNewItemAt,
} from "./floorMap.js";
export {
  PLACE_ORDER_FEATURES,
  planPlaceOrder,
} from "./placeOrderPlan.js";
export type {
  PlaceOrderFulfillment,
  PlaceOrderPlan,
  PlaceOrderPlanInput,
} from "./placeOrderPlan.js";
export {
  toCents,
  toSentenceCase,
  toTitleCase,
  shadeColor,
  isEmail,
  safe,
  coerceBools,
  getPrinterTypeName,
  getShortPermissionLabel,
  toPostgresTimestampTz,
  days,
  daysLetter,
} from "./utils.js";
