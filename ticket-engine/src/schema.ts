export const SCHEMA_VERSION = 1

export const CREATE_TICKET_LOG = `
  CREATE TABLE IF NOT EXISTS ticketLog (
    uuid TEXT PRIMARY KEY,
    ticketUuid TEXT NOT NULL,
    locationGroupUuid TEXT NOT NULL,
    action TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    timeStamp INTEGER NOT NULL,
    adminUuid TEXT
  );
`

export const CREATE_TICKET_LOG_APPLIED = `
  CREATE TABLE IF NOT EXISTS ticketLogApplied (
    uuid TEXT PRIMARY KEY REFERENCES ticketLog(uuid),
    timeStamp INTEGER,
    nextRetryAt INTEGER,
    retryCount INTEGER DEFAULT 0
  );
`

export const CREATE_TICKET = `
  CREATE TABLE IF NOT EXISTS ticket (
    uuid TEXT PRIMARY KEY,
    id INTEGER NOT NULL,
    timeStamp INTEGER,
    locationGroupUuid TEXT,
    status TEXT NOT NULL DEFAULT 'INCOMPLETE',
    guestUuid TEXT,
    adminUuid TEXT,
    appUniqueUuid TEXT,
    tableUuid TEXT,
    fulfillmentUuid TEXT,
    guestAddressUuid TEXT,
    anonymousAddress TEXT,
    locationUuid TEXT,
    priceWhole INTEGER DEFAULT 0,
    priceHundredths INTEGER DEFAULT 0,
    isDirty INTEGER DEFAULT 0,
    isLocal INTEGER DEFAULT 0
  );
`

export const CREATE_TICKET_MENU_ITEM = `
  CREATE TABLE IF NOT EXISTS ticketMenuItem (
    uuid TEXT PRIMARY KEY,
    ticketUuid TEXT NOT NULL,
    menuItemUuid TEXT NOT NULL,
    note TEXT
  );
`

export const CREATE_TICKET_MENU_ITEM_MODIFIER = `
  CREATE TABLE IF NOT EXISTS ticketMenuItemModifier (
    uuid TEXT PRIMARY KEY,
    ticketUuid TEXT NOT NULL,
    ticketMenuItemUuid TEXT NOT NULL,
    modifierUuid TEXT NOT NULL
  );
`

export const CREATE_TICKET_PROMOTION = `
  CREATE TABLE IF NOT EXISTS ticketPromotion (
    uuid TEXT PRIMARY KEY,
    ticketUuid TEXT NOT NULL,
    promotionUuid TEXT NOT NULL,
    ticketMenuItemUuid TEXT,
    timeStamp TEXT NOT NULL
  );
`

export const CREATE_TICKET_PAYMENT = `
  CREATE TABLE IF NOT EXISTS ticketPayment (
    uuid TEXT PRIMARY KEY,
    ticketUuid TEXT NOT NULL,
    paymentUuid TEXT NOT NULL,
    priceWhole INTEGER NOT NULL,
    priceHundredths INTEGER NOT NULL,
    code TEXT,
    complete INTEGER NOT NULL DEFAULT 1
  );
`

export const CREATE_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_ticketLog_ticketUuid ON ticketLog(ticketUuid);
  CREATE INDEX IF NOT EXISTS idx_ticketLog_locationGroupUuid ON ticketLog(locationGroupUuid);
  CREATE INDEX IF NOT EXISTS idx_ticketLog_action ON ticketLog(action);
  CREATE INDEX IF NOT EXISTS idx_ticketLogApplied_nextRetryAt ON ticketLogApplied(nextRetryAt);
  CREATE INDEX IF NOT EXISTS idx_ticketMenuItem_ticketUuid ON ticketMenuItem(ticketUuid);
  CREATE INDEX IF NOT EXISTS idx_ticketMenuItemModifier_ticketMenuItemUuid ON ticketMenuItemModifier(ticketMenuItemUuid);
  CREATE INDEX IF NOT EXISTS idx_ticketPromotion_ticketUuid ON ticketPromotion(ticketUuid);
  CREATE INDEX IF NOT EXISTS idx_ticketPayment_ticketUuid ON ticketPayment(ticketUuid);
`

export const ALL_DDL = [
  CREATE_TICKET_LOG,
  CREATE_TICKET_LOG_APPLIED,
  CREATE_TICKET,
  CREATE_TICKET_MENU_ITEM,
  CREATE_TICKET_MENU_ITEM_MODIFIER,
  CREATE_TICKET_PROMOTION,
  CREATE_TICKET_PAYMENT,
  CREATE_INDEXES,
]
