export const SCHEMA_VERSION = 2

export const CREATE_TICKET_LOG = `
  CREATE TABLE IF NOT EXISTS "ticketLog" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "ticketUuid" TEXT NOT NULL,
    "locationGroupUuid" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "timeStamp" INTEGER NOT NULL,
    "adminUuid" TEXT
  );
`

export const CREATE_TICKET_LOG_APPLIED = `
  CREATE TABLE IF NOT EXISTS "ticketLogApplied" (
    "uuid" TEXT PRIMARY KEY,
    "timeStamp" INTEGER,
    "retryCount" INTEGER DEFAULT 0,
    "lastError" TEXT,
    "nextRetryAt" INTEGER
  );
`

export const CREATE_TICKET = `
  CREATE TABLE IF NOT EXISTS "ticket" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "id" INTEGER NOT NULL DEFAULT 0,
    "timeStamp" TEXT,
    "status" TEXT,
    "guestUuid" TEXT,
    "appUniqueUuid" TEXT,
    "tableUuid" TEXT,
    "locationGroupUuid" TEXT NOT NULL,
    "locationUuid" TEXT,
    "fulfillmentUuid" TEXT,
    "guestAddressUuid" TEXT,
    "adminUuid" TEXT,
    "anonymousAddress" TEXT,
    "priceWhole" INTEGER NOT NULL DEFAULT 0,
    "priceHundredths" INTEGER NOT NULL DEFAULT 0,
    "isDirty" INTEGER NOT NULL DEFAULT 0,
    "isLocal" INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY ("fulfillmentUuid") REFERENCES "fulfillment"("uuid"),
    FOREIGN KEY ("guestAddressUuid") REFERENCES "guestAddress"("uuid"),
    FOREIGN KEY ("guestUuid") REFERENCES "guest"("uuid"),
    FOREIGN KEY ("locationUuid") REFERENCES "location"("uuid"),
    FOREIGN KEY ("locationGroupUuid") REFERENCES "locationGroup"("uuid"),
    FOREIGN KEY ("tableUuid") REFERENCES "table"("uuid"),
    FOREIGN KEY ("adminUuid") REFERENCES "admin"("uuid")
  );
`

export const CREATE_TICKET_MENU_ITEM = `
  CREATE TABLE IF NOT EXISTS "ticketMenuItem" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "ticketUuid" TEXT NOT NULL,
    "menuItemUuid" TEXT NOT NULL,
    "note" TEXT,
    FOREIGN KEY ("ticketUuid") REFERENCES "ticket"("uuid"),
    FOREIGN KEY ("menuItemUuid") REFERENCES "menuItem"("uuid")
  );
`

export const CREATE_TICKET_MENU_ITEM_MODIFIER = `
  CREATE TABLE IF NOT EXISTS "ticketMenuItemModifier" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "ticketUuid" TEXT NOT NULL,
    "modifierUuid" TEXT NOT NULL,
    "ticketMenuItemUuid" TEXT NOT NULL,
    "timeStamp" TEXT,
    FOREIGN KEY ("ticketUuid") REFERENCES "ticket"("uuid"),
    FOREIGN KEY ("modifierUuid") REFERENCES "modifier"("uuid"),
    FOREIGN KEY ("ticketMenuItemUuid") REFERENCES "ticketMenuItem"("uuid")
  );
`

export const CREATE_TICKET_PROMOTION = `
  CREATE TABLE IF NOT EXISTS "ticketPromotion" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "timeStamp" TEXT,
    "ticketUuid" TEXT NOT NULL,
    "promotionUuid" TEXT NOT NULL,
    "ticketMenuItemUuid" TEXT,
    FOREIGN KEY ("ticketUuid") REFERENCES "ticket"("uuid"),
    FOREIGN KEY ("promotionUuid") REFERENCES "promotion"("uuid"),
    FOREIGN KEY ("ticketMenuItemUuid") REFERENCES "ticketMenuItem"("uuid")
  );
`

export const CREATE_TICKET_PAYMENT = `
  CREATE TABLE IF NOT EXISTS "ticketPayment" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "ticketUuid" TEXT NOT NULL,
    "paymentUuid" TEXT NOT NULL,
    "priceWhole" INTEGER NOT NULL,
    "priceHundredths" INTEGER NOT NULL,
    "code" TEXT,
    "complete" BOOLEAN NOT NULL DEFAULT 0,
    FOREIGN KEY ("ticketUuid") REFERENCES "ticket"("uuid"),
    FOREIGN KEY ("paymentUuid") REFERENCES "payment"("uuid")
  );
`

export const CREATE_INDEXES = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ticketLog_uuid ON ticketLog(uuid);
  CREATE INDEX IF NOT EXISTS idx_ticketLog_ticketUuid ON ticketLog(ticketUuid);
  CREATE INDEX IF NOT EXISTS idx_ticketLog_locationGroupUuid ON ticketLog(locationGroupUuid);
  CREATE INDEX IF NOT EXISTS idx_ticketLog_location_time ON ticketLog(locationGroupUuid, timeStamp);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ticketLogApplied_uuid ON ticketLogApplied(uuid);
  CREATE INDEX IF NOT EXISTS idx_ticketLogApplied_nextRetryAt ON ticketLogApplied(nextRetryAt);
  CREATE INDEX IF NOT EXISTS idx_ticketMenuItem_ticketUuid ON ticketMenuItem(ticketUuid);
  CREATE INDEX IF NOT EXISTS idx_ticketMenuItemModifier_ticketMenuItemUuid ON ticketMenuItemModifier(ticketMenuItemUuid);
  CREATE INDEX IF NOT EXISTS idx_ticketPromotion_ticketUuid ON ticketPromotion(ticketUuid);
  CREATE INDEX IF NOT EXISTS idx_ticketPayment_ticketUuid ON ticketPayment(ticketUuid);
  CREATE INDEX IF NOT EXISTS idx_printRecord_synced ON printRecord(synced);
`

export const CREATE_PRINT_RECORD = `
  CREATE TABLE IF NOT EXISTS "printRecord" (
    "ticketUuid" TEXT NOT NULL PRIMARY KEY,
    "decision" TEXT NOT NULL DEFAULT 'pending',
    "printedAt" INTEGER,
    "synced" INTEGER NOT NULL DEFAULT 0
  );
`

export const ALL_DDL = [
  CREATE_TICKET_LOG,
  CREATE_TICKET_LOG_APPLIED,
  CREATE_TICKET,
  CREATE_TICKET_MENU_ITEM,
  CREATE_TICKET_MENU_ITEM_MODIFIER,
  CREATE_TICKET_PROMOTION,
  CREATE_TICKET_PAYMENT,
  CREATE_PRINT_RECORD,
  CREATE_INDEXES,
]

export const FULL_DDL = `
  CREATE TABLE IF NOT EXISTS "key_value" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS "language" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "nombre" TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS "country" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "iso2" TEXT NOT NULL,
    "iso3" TEXT NOT NULL,
    "phoneCode" INTEGER NOT NULL DEFAULT 0,
    "languageUuid" TEXT NOT NULL,
    FOREIGN KEY ("languageUuid") REFERENCES "language"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "locationGroup" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description1" TEXT,
    "description2" TEXT,
    "description3" TEXT,
    "description4" TEXT,
    "urlName" TEXT UNIQUE,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "ticketDescription" TEXT,
    "theme" INTEGER DEFAULT 0 NOT NULL,
    "timeStamp" TEXT,
    "qrCode" TEXT,
    "tipPercentage" INTEGER DEFAULT 0 NOT NULL,
    "countryUuid" TEXT,
    "dayPriceCents" INTEGER DEFAULT 0 NOT NULL,
    "simplePrint" BOOLEAN NOT NULL DEFAULT 1,
    "printNotes" BOOLEAN NOT NULL DEFAULT 1,
    "taxPercentage" INTEGER DEFAULT 0 NOT NULL,
    FOREIGN KEY ("countryUuid") REFERENCES "country"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "location" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "urlName" TEXT NOT NULL UNIQUE,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "countryUuid" TEXT NOT NULL,
    FOREIGN KEY ("countryUuid") REFERENCES "country"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "printerType" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS "locationGroupPrinter" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "host" TEXT,
    "port" INTEGER,
    "widthMillimeters" INTEGER DEFAULT 0 NOT NULL,
    "locationGroupUuid" TEXT NOT NULL,
    "locationUuid" TEXT,
    "printerTypeUuid" TEXT NOT NULL,
    FOREIGN KEY ("locationGroupUuid") REFERENCES "locationGroup"("uuid"),
    FOREIGN KEY ("locationUuid") REFERENCES "location"("uuid"),
    FOREIGN KEY ("printerTypeUuid") REFERENCES "printerType"("uuid")
  );

  CREATE TABLE IF NOT EXISTS admin (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "userName" TEXT NOT NULL UNIQUE,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "lastLoginDateTime" TEXT,
    "loginTries" INTEGER DEFAULT 0,
    "refreshToken" TEXT,
    "mute" BOOLEAN NOT NULL DEFAULT 1,
    "timeStamp" TEXT,
    "nativeRefreshToken" TEXT,
    "kitchenLocationGroupPrinterUuid" TEXT,
    "guestLocationGroupPrinterUuid" TEXT,
    "silentPrint" BOOLEAN NOT NULL DEFAULT 0,
    "isOwner" BOOLEAN NOT NULL DEFAULT 0,
    FOREIGN KEY ("kitchenLocationGroupPrinterUuid") REFERENCES "locationGroupPrinter"("uuid"),
    FOREIGN KEY ("guestLocationGroupPrinterUuid") REFERENCES "locationGroupPrinter"("uuid")
  );

  CREATE TABLE IF NOT EXISTS guest (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "userName" TEXT UNIQUE NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "lastLoginDateTime" TEXT,
    "loginTries" INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS menu (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT 1,
    "sh0" INTEGER NOT NULL DEFAULT 0,
    "sm0" INTEGER NOT NULL DEFAULT 0,
    "st0" TEXT,
    "eh0" INTEGER NOT NULL DEFAULT 0,
    "em0" INTEGER NOT NULL DEFAULT 0,
    "et0" TEXT,
    "sh1" INTEGER NOT NULL DEFAULT 0,
    "sm1" INTEGER NOT NULL DEFAULT 0,
    "st1" TEXT,
    "eh1" INTEGER NOT NULL DEFAULT 0,
    "em1" INTEGER NOT NULL DEFAULT 0,
    "et1" TEXT,
    "sh2" INTEGER NOT NULL DEFAULT 0,
    "sm2" INTEGER NOT NULL DEFAULT 0,
    "st2" TEXT,
    "eh2" INTEGER NOT NULL DEFAULT 0,
    "em2" INTEGER NOT NULL DEFAULT 0,
    "et2" TEXT,
    "sh3" INTEGER NOT NULL DEFAULT 0,
    "sm3" INTEGER NOT NULL DEFAULT 0,
    "st3" TEXT,
    "eh3" INTEGER NOT NULL DEFAULT 0,
    "em3" INTEGER NOT NULL DEFAULT 0,
    "et3" TEXT,
    "sh4" INTEGER NOT NULL DEFAULT 0,
    "sm4" INTEGER NOT NULL DEFAULT 0,
    "st4" TEXT,
    "eh4" INTEGER NOT NULL DEFAULT 0,
    "em4" INTEGER NOT NULL DEFAULT 0,
    "et4" TEXT,
    "sh5" INTEGER NOT NULL DEFAULT 0,
    "sm5" INTEGER NOT NULL DEFAULT 0,
    "st5" TEXT,
    "eh5" INTEGER NOT NULL DEFAULT 0,
    "em5" INTEGER NOT NULL DEFAULT 0,
    "et5" TEXT,
    "sh6" INTEGER NOT NULL DEFAULT 0,
    "sm6" INTEGER NOT NULL DEFAULT 0,
    "st6" TEXT,
    "eh6" INTEGER NOT NULL DEFAULT 0,
    "em6" INTEGER NOT NULL DEFAULT 0,
    "et6" TEXT,
    "locationGroupUuid" TEXT NOT NULL,
    "locationUuid" TEXT,
    FOREIGN KEY ("locationGroupUuid") REFERENCES "locationGroup"("uuid"),
    FOREIGN KEY ("locationUuid") REFERENCES "location"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "menuCategory" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT 1,
    "locationGroupUuid" TEXT NOT NULL,
    "locationUuid" TEXT,
    FOREIGN KEY ("locationGroupUuid") REFERENCES "locationGroup"("uuid"),
    FOREIGN KEY ("locationUuid") REFERENCES "location"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "menuItem" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT 1,
    "complete" BOOLEAN NOT NULL DEFAULT 0,
    "priceWhole" INTEGER,
    "priceHundredths" INTEGER,
    "locationGroupUuid" TEXT NOT NULL,
    "locationUuid" TEXT,
    "cache" TEXT,
    FOREIGN KEY ("locationGroupUuid") REFERENCES "locationGroup"("uuid"),
    FOREIGN KEY ("locationUuid") REFERENCES "location"("uuid")
  );

  CREATE TABLE IF NOT EXISTS fulfillment (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS "guestAddress" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    address TEXT NOT NULL,
    "guestUuid" TEXT NOT NULL,
    FOREIGN KEY ("guestUuid") REFERENCES "guest"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "table" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT 1,
    "locationGroupUuid" TEXT NOT NULL,
    "locationUuid" TEXT,
    FOREIGN KEY ("locationGroupUuid") REFERENCES "locationGroup"("uuid"),
    FOREIGN KEY ("locationUuid") REFERENCES "location"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "payment" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
  );

  ${[...ALL_DDL.slice(0, 7)].join('\n  ')}

  CREATE TABLE IF NOT EXISTS permission (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS "adminLocation" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "adminUuid" TEXT NOT NULL,
    "owner" BOOLEAN NOT NULL DEFAULT 0,
    "locationGroupUuid" TEXT NOT NULL,
    "locationUuid" TEXT,
    FOREIGN KEY ("adminUuid") REFERENCES "admin"("uuid"),
    FOREIGN KEY ("locationUuid") REFERENCES "location"("uuid"),
    FOREIGN KEY ("locationGroupUuid") REFERENCES "locationGroup"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "adminLocationPermission" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "adminLocationUuid" TEXT NOT NULL,
    "permissionUuid" TEXT NOT NULL,
    FOREIGN KEY ("adminLocationUuid") REFERENCES "adminLocation"("uuid"),
    FOREIGN KEY ("permissionUuid") REFERENCES "permission"("uuid")
  );

  CREATE TABLE IF NOT EXISTS promotion (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "autoApply" BOOLEAN NOT NULL DEFAULT 1,
    "promotionIsPercentage" BOOLEAN NOT NULL DEFAULT 0,
    "locationGroupUuid" TEXT NOT NULL,
    "locationUuid" TEXT,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "discountWhole" INTEGER NOT NULL DEFAULT 0,
    "discountHundredths" INTEGER NOT NULL DEFAULT 0,
    "pointsRequired" INTEGER NOT NULL DEFAULT 0,
    "pointsEarnable" INTEGER NOT NULL DEFAULT 0,
    "pointsMultiplier" INTEGER NOT NULL DEFAULT 0,
    "itemsRequired" INTEGER NOT NULL DEFAULT 0,
    "minimumPurchaseWhole" INTEGER NOT NULL DEFAULT 0,
    "minimumPurchaseHundredths" INTEGER NOT NULL DEFAULT 0,
    "bogoBuy" TEXT NOT NULL,
    "bogoBuyItemsAmmount" INTEGER NOT NULL DEFAULT 0,
    "bogoGet" TEXT NOT NULL,
    "bogoGetItemsAmmount" INTEGER NOT NULL DEFAULT 0,
    "allWeek" BOOLEAN NOT NULL DEFAULT 1,
    "mon" BOOLEAN NOT NULL DEFAULT 0,
    "tue" BOOLEAN NOT NULL DEFAULT 0,
    "wed" BOOLEAN NOT NULL DEFAULT 0,
    "thu" BOOLEAN NOT NULL DEFAULT 0,
    "fri" BOOLEAN NOT NULL DEFAULT 0,
    "sat" BOOLEAN NOT NULL DEFAULT 0,
    "sun" BOOLEAN NOT NULL DEFAULT 0,
    "mondayStartTime" INTEGER NOT NULL DEFAULT 0,
    "mondayEndTime" INTEGER NOT NULL DEFAULT 0,
    "tuesdayStartTime" INTEGER NOT NULL DEFAULT 0,
    "tuesdayEndTime" INTEGER NOT NULL DEFAULT 0,
    "wednesdayStartTime" INTEGER NOT NULL DEFAULT 0,
    "wednesdayEndTime" INTEGER NOT NULL DEFAULT 0,
    "thursdayStartTime" INTEGER NOT NULL DEFAULT 0,
    "thursdayEndTime" INTEGER NOT NULL DEFAULT 0,
    "fridayStartTime" INTEGER NOT NULL DEFAULT 0,
    "fridayEndTime" INTEGER NOT NULL DEFAULT 0,
    "saturdayStartTime" INTEGER NOT NULL DEFAULT 0,
    "saturdayEndTime" INTEGER NOT NULL DEFAULT 0,
    "sundayStartTime" INTEGER NOT NULL DEFAULT 0,
    "sundayEndTime" INTEGER NOT NULL DEFAULT 0,
    "redeemptionsPerVisit" INTEGER NOT NULL DEFAULT 0,
    "redeemptionsPerDay" INTEGER NOT NULL DEFAULT 0,
    "redeemptionsPerWeek" INTEGER NOT NULL DEFAULT 0,
    "redeemptionsPerMonth" INTEGER NOT NULL DEFAULT 0,
    "redeemptionsAllTime" INTEGER NOT NULL DEFAULT 0,
    "minimumTotalTickets" INTEGER NOT NULL DEFAULT 0,
    "combinable" BOOLEAN NOT NULL DEFAULT 0,
    "allItems" BOOLEAN NOT NULL DEFAULT 1,
    "allCategories" BOOLEAN NOT NULL DEFAULT 1,
    "itemless" BOOLEAN NOT NULL DEFAULT 0,
    FOREIGN KEY ("locationUuid") REFERENCES "location"("uuid"),
    FOREIGN KEY ("locationGroupUuid") REFERENCES "locationGroup"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "bogoMenuItem" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "bogoUuid" TEXT NOT NULL,
    "menuItemUuid" TEXT NOT NULL,
    FOREIGN KEY ("menuItemUuid") REFERENCES "menuItem"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "guestLocationGroup" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "guestUuid" TEXT NOT NULL,
    "locationGroupUuid" TEXT NOT NULL,
    "points" INTEGER DEFAULT 0 NOT NULL,
    FOREIGN KEY ("locationGroupUuid") REFERENCES "locationGroup"("uuid"),
    UNIQUE ("locationGroupUuid", "guestUuid")
  );

  CREATE TABLE IF NOT EXISTS "locationGroupLocation" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "locationGroupUuid" TEXT NOT NULL,
    "locationUuid" TEXT,
    FOREIGN KEY ("locationUuid") REFERENCES "location"("uuid"),
    FOREIGN KEY ("locationGroupUuid") REFERENCES "locationGroup"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "locationMenu" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "locationUuid" TEXT,
    "menuUuid" TEXT NOT NULL,
    FOREIGN KEY ("locationUuid") REFERENCES "location"("uuid"),
    FOREIGN KEY ("menuUuid") REFERENCES "menu"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "menuItemMenuCategory" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "menuItemUuid" TEXT NOT NULL,
    "menuCategoryUuid" TEXT NOT NULL,
    UNIQUE ("menuItemUuid", "menuCategoryUuid"),
    FOREIGN KEY ("menuCategoryUuid") REFERENCES "menuCategory"("uuid"),
    FOREIGN KEY ("menuItemUuid") REFERENCES "menuItem"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "menuMenuCategory" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "menuUuid" TEXT NOT NULL,
    "menuCategoryUuid" TEXT NOT NULL,
    UNIQUE ("menuUuid", "menuCategoryUuid"),
    FOREIGN KEY ("menuCategoryUuid") REFERENCES "menuCategory"("uuid"),
    FOREIGN KEY ("menuUuid") REFERENCES "menu"("uuid")
  );

  ${CREATE_TICKET_PROMOTION.trim()}

  CREATE TABLE IF NOT EXISTS "subCategory" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentUuid" TEXT NOT NULL,
    "menuCategoryUuid" TEXT NOT NULL,
    "locationGroupUuid" TEXT NOT NULL,
    "locationUuid" TEXT,
    FOREIGN KEY ("menuCategoryUuid") REFERENCES "menuCategory"("uuid"),
    FOREIGN KEY ("locationGroupUuid") REFERENCES "locationGroup"("uuid"),
    FOREIGN KEY ("locationUuid") REFERENCES "location"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "subCategoryMenuItem" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "subCategoryUuid" TEXT NOT NULL,
    "menuItemUuid" TEXT NOT NULL,
    UNIQUE ("subCategoryUuid", "menuItemUuid"),
    FOREIGN KEY ("subCategoryUuid") REFERENCES "subCategory"("uuid"),
    FOREIGN KEY ("menuItemUuid") REFERENCES "menuItem"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "modifierGroup" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "amountRequired" int NOT NULL,
    "locationGroupUuid" TEXT NOT NULL,
    "locationUuid" TEXT,
    FOREIGN KEY ("locationGroupUuid") REFERENCES "locationGroup"("uuid"),
    FOREIGN KEY ("locationUuid") REFERENCES "location"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "modifier" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT 1,
    "priceWhole" INTEGER NOT NULL DEFAULT 0,
    "priceHundredths" INTEGER NOT NULL DEFAULT 0,
    "limit" INTEGER NOT NULL DEFAULT 0,
    "locationGroupUuid" TEXT NOT NULL,
    "locationUuid" TEXT,
    FOREIGN KEY ("locationGroupUuid") REFERENCES "locationGroup"("uuid"),
    FOREIGN KEY ("locationUuid") REFERENCES "location"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "menuItemModifierGroup" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "modifierGroupUuid" TEXT NOT NULL,
    "menuItemUuid" TEXT UNIQUE NOT NULL,
    FOREIGN KEY ("modifierGroupUuid") REFERENCES "modifierGroup"("uuid"),
    FOREIGN KEY ("menuItemUuid") REFERENCES "menuItem"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "modifierGroupModifier" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "modifierGroupUuid" TEXT NOT NULL,
    "modifierUuid" TEXT NOT NULL,
    UNIQUE ("modifierGroupUuid", "modifierUuid"),
    FOREIGN KEY ("modifierGroupUuid") REFERENCES "modifierGroup"("uuid"),
    FOREIGN KEY ("modifierUuid") REFERENCES "modifier"("uuid")
  );

  ${CREATE_TICKET_MENU_ITEM_MODIFIER.trim()}

  CREATE TABLE IF NOT EXISTS "guestPushCreds" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "guestUuid" TEXT NOT NULL,
    "appUniqueUuid" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    FOREIGN KEY ("guestUuid") REFERENCES "guest"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "adminPushCreds" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "adminUuid" TEXT NOT NULL UNIQUE,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    FOREIGN KEY ("adminUuid") REFERENCES "admin"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "environment" (
    "name" TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS feature (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "selfServe" BOOLEAN NOT NULL DEFAULT 1,
    "priceWhole" INTEGER NOT NULL DEFAULT 0,
    "priceHundredths" INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS "locationGroupFeature" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "locationGroupUuid" TEXT NOT NULL,
    "featureUuid" TEXT NOT NULL,
    "timeStamp" TEXT,
    FOREIGN KEY ("locationGroupUuid") REFERENCES "locationGroup"("uuid"),
    FOREIGN KEY ("featureUuid") REFERENCES "feature"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "adminBalanceHistory" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "adminUuid" TEXT NOT NULL,
    "timeStamp" TEXT,
    "balanceWhole" INTEGER NOT NULL DEFAULT 0,
    "balanceHundredths" INTEGER NOT NULL DEFAULT 0,
    "add" INTEGER NOT NULL DEFAULT 0,
    "confirmationCode" TEXT,
    "confirmed" BOOLEAN DEFAULT 0,
    FOREIGN KEY ("adminUuid") REFERENCES "admin"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "locationGroupActivationHistory" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "locationGroupUuid" TEXT NOT NULL,
    "timeStamp" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT 1,
    "dayPriceCents" INTEGER DEFAULT 17 NOT NULL,
    FOREIGN KEY ("locationGroupUuid") REFERENCES "locationGroup"("uuid")
  );

  ${CREATE_TICKET_PAYMENT.trim()}

  CREATE TABLE IF NOT EXISTS "combo" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT 1,
    "locationGroupUuid" TEXT NOT NULL,
    "locationUuid" TEXT,
    "priceWhole" INTEGER NOT NULL,
    "priceHundredths" INTEGER NOT NULL,
    FOREIGN KEY ("locationGroupUuid") REFERENCES "locationGroup"("uuid"),
    FOREIGN KEY ("locationUuid") REFERENCES "location"("uuid")
  );

  CREATE TABLE IF NOT EXISTS "comboMenuItem" (
    "comboUuid" TEXT NOT NULL,
    "menuItemUuid" TEXT NOT NULL,
    "minimumAmount" INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY ("menuItemUuid") REFERENCES "menuItem"("uuid"),
    FOREIGN KEY ("comboUuid") REFERENCES "combo"("uuid")
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_combo_unique
    ON comboMenuItem ("comboUuid", "menuItemUuid");

  CREATE TABLE IF NOT EXISTS "menuCombo" (
    "uuid" TEXT NOT NULL PRIMARY KEY,
    "menuUuid" TEXT NOT NULL,
    "comboUuid" TEXT NOT NULL,
    UNIQUE ("menuUuid", "comboUuid"),
    FOREIGN KEY ("menuUuid") REFERENCES "menu"("uuid"),
    FOREIGN KEY ("comboUuid") REFERENCES "combo"("uuid")
  );

  ${CREATE_TICKET_LOG.trim()}

  ${CREATE_TICKET_LOG_APPLIED.trim()}

  CREATE TABLE IF NOT EXISTS "deviceIps" (
    "deviceUuid" TEXT NOT NULL PRIMARY KEY,
    "deviceName" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "lastSeen" TEXT NOT NULL,
    "locationGroupUuid" TEXT NOT NULL
  );

  ${ALL_DDL[7]!.trim()}

  ${ALL_DDL[8]!.trim()}

  INSERT OR IGNORE INTO "language" VALUES ('78933d1b-b49f-4eb5-b512-bafa7fec6055', 'English', 'inglés');
  INSERT OR IGNORE INTO "language" VALUES ('fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242', 'Spanish', 'español');
  INSERT OR IGNORE INTO "country" VALUES ('935db0b9-2791-4153-b620-13c49028989d', 'Ecuador', 'Ecuador', 'EC', 'ECU', 593, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('5b4ee4e6-ef5e-4b88-9db7-5fcd1ba139bf', 'Equatorial Guinea', 'Guinea Ecuatorial', 'GQ', 'GNQ', 240, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('13b98e53-1e53-449f-a7a0-623174599961', 'Guatemala', 'Guatemala', 'GT', 'GTM', 502, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('20efe52a-c69b-4ebf-a457-e137cfc68594', 'Colombia', 'Colombia', 'CO', 'COL', 57, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('ba6f08ab-e24a-4cf2-889e-9de40fbec11f', 'Spain', 'España', 'ES', 'ESP', 34, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('a17880e3-4d95-4d93-82c6-1875bad2ba01', 'Argentina', 'Argentina', 'AR', 'ARG', 54, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('a700987b-06f3-476d-97c5-98162caf1661', 'Albania', 'Albania', 'AL', 'ALB', 355, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('e9c5add0-1086-4108-bcaa-e18625648c63', 'Germany', 'Alemania', 'DE', 'DEU', 49, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('041ce6dc-4459-4c70-b58e-310565d370e2', 'Andorra', 'Andorra', 'AD', 'AND', 376, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('9280fa94-39f6-4df7-92a2-26e2cdd36fc2', 'Antarctica', 'Antártida', 'AQ', 'ATA', 672, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('aaf52d21-3344-4e86-a3a6-61d3eef12f1e', 'Saudi Arabia', 'Arabia Saudita', 'SA', 'SAU', 966, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('54caba32-a8fd-4bb7-8721-37180651307b', 'Armenia', 'Armenia', 'AM', 'ARM', 374, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('1e2b8b84-dd55-46b2-a814-607d90fe4338', 'Aruba', 'Aruba', 'AW', 'ABW', 297, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('5f08b049-75ab-4792-bb63-791ae7e62f45', 'Australia', 'Australia', 'AU', 'AUS', 61, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('fc113268-a86e-46f8-b1fa-246da541363f', 'Azerbaijan', 'Azerbaiyán', 'AZ', 'AZE', 994, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('300a29f2-b797-4d69-a40f-a19ca3e6b2bd', 'Belgium', 'Bélgica', 'BE', 'BEL', 32, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('9069a4ad-e7fc-453d-97c4-0f30d1fcbf16', 'Bangladesh', 'Bangladesh', 'BD', 'BGD', 880, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('a168f7c7-8f0a-4cef-b68d-c609b1683bca', 'Belize', 'Belice', 'BZ', 'BLZ', 501, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('91609fbe-c6a9-4d0f-9dc6-de8d8e14118f', 'Benin', 'Benín', 'BJ', 'BEN', 229, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('850489d4-af7d-4699-966a-0042913e3b44', 'Belarus', 'Bielorrusia', 'BY', 'BLR', 375, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('7c13c867-13d9-4c3d-a7a3-cf9713feea57', 'Myanmar', 'Birmania', 'MM', 'MMR', 95, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('90dc8b9b-6100-4a93-a045-ca2f55af09b6', 'Botswana', 'Botsuana', 'BW', 'BWA', 267, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('99b91ac9-363d-4835-958e-65c039a5685a', 'Brazil', 'Brasil', 'BR', 'BRA', 55, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('5d1f5aee-97cf-40ac-8e68-5e33168d896b', 'Brunei', 'Brunéi', 'BN', 'BRN', 673, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('2274ce09-a3e4-4a0e-b779-93ee135fc959', 'Bulgaria', 'Bulgaria', 'BG', 'BGR', 359, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('7f949c1e-ad41-48fd-8f4e-ed1dc9d6f52d', 'Burundi', 'Burundi', 'BI', 'BDI', 257, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('875c5d1b-db0c-4180-a532-010375a44d1e', 'Cape Verde', 'Cabo Verde', 'CV', 'CPV', 238, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('40fa9a0f-bf1a-4c09-a57d-5e822c9fd265', 'Cambodia', 'Camboya', 'KH', 'KHM', 855, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('0e492c56-6280-41be-8ad0-1fdc09a105a1', 'Canada', 'Canadá', 'CA', 'CAN', 1, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('0bf10f0b-cc85-415b-a0da-074f1876bcae', 'Chad', 'Chad', 'TD', 'TCD', 235, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('b8dc951d-3c74-47d3-a675-3d39641ec664', 'China', 'China', 'CN', 'CHN', 86, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('b47138f9-d523-413c-b4ac-16b7bd857348', 'Vatican City State', 'Ciudad del Vaticano', 'VA', 'VAT', 39, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('750f5e17-37dc-4ded-8dcf-c52887fa554c', 'Comoros', 'Comoras', 'KM', 'COM', 269, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('6b81fbbb-a062-413b-91b4-ae4287750a1b', 'Democratic Republic of the Congo', 'República Democrática del Congo', 'CD', 'COD', 243, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('8cd469cf-748c-4b9b-a01d-c90f530f2727', 'North Korea', 'Corea del Norte', 'KP', 'PRK', 850, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('9f17354f-def3-4254-8f14-12da035b1d39', 'South Korea', 'Corea del Sur', 'KR', 'KOR', 82, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('8eecc5b2-ace6-47c1-b3f9-cba9e58cfa8d', 'Croatia', 'Croacia', 'HR', 'HRV', 385, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('197b405c-b904-4151-8ab3-2ff5c220bbd5', 'Curaçao', 'Curazao', 'CW', 'CWU', 5999, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('9f21648e-5168-459c-bf43-0c21fa91c4fc', 'Denmark', 'Dinamarca', 'DK', 'DNK', 45, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('18944216-1757-4926-8314-dc2794852614', 'Egypt', 'Egipto', 'EG', 'EGY', 20, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('5d070efd-25ca-4bdf-b96d-98c203d31bb3', 'Eritrea', 'Eritrea', 'ER', 'ERI', 291, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('169e3e52-6f02-449d-9fef-a1fb2c7c4bbd', 'Slovakia', 'Eslovaquia', 'SK', 'SVK', 421, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('ad53c9c6-ae80-4664-8e89-e024ea299615', 'Slovenia', 'Eslovenia', 'SI', 'SVN', 386, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('98b91c02-c2cd-4847-979e-83d86711abe5', 'Estonia', 'Estonia', 'EE', 'EST', 372, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('4fa14af7-b3f0-4729-922d-65dad685b4e5', 'Ethiopia', 'Etiopía', 'ET', 'ETH', 251, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('20327ade-047e-4f51-bba5-27d1fd5e2d20', 'Philippines', 'Filipinas', 'PH', 'PHL', 63, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('3d30c326-a8fb-4b66-8f56-cb12fafc0185', 'Fiji', 'Fiyi', 'FJ', 'FJI', 679, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('f93fc0fd-207d-443c-94ec-c647cd5f5e3b', 'France', 'Francia', 'FR', 'FRA', 33, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('9f93a82f-e72f-4257-b294-fc5635f960b0', 'Gabon', 'Gabón', 'GA', 'GAB', 241, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('d482adb4-9367-4bb3-9107-eff05704a154', 'Georgia', 'Georgia', 'GE', 'GEO', 995, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('58f3f6ee-a04e-4670-8d94-1a1d373a2eac', 'Ghana', 'Ghana', 'GH', 'GHA', 233, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('17bdfaf5-a6c7-404b-a3bf-7747a370b213', 'Gibraltar', 'Gibraltar', 'GI', 'GIB', 350, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('0324c925-4783-4ccb-8ecb-1f8a278f58af', 'Greenland', 'Groenlandia', 'GL', 'GRL', 299, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('b781a423-1096-4aff-80f8-2c978e7a3588', 'Guadeloupe', 'Guadalupe', 'GP', 'GLP', 590, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('92c90d3d-ce17-418a-bd35-ab9de3919597', 'Guernsey', 'Guernsey', 'GG', 'GGY', 44, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('6b911cfa-3e66-4bdb-b93f-59aa52251e8a', 'Guinea', 'Guinea', 'GN', 'GIN', 224, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('57d9b445-b571-474b-b791-95f28e1091c4', 'Guinea-Bissau', 'Guinea-Bissau', 'GW', 'GNB', 245, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('0200e458-1979-49b1-88c4-5308401bcde9', 'Haiti', 'Haití', 'HT', 'HTI', 509, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('d5769b6e-c8d2-42d3-8ba2-901616dac30d', 'Barbados', 'Barbados', 'BB', 'BRB', 1246, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('a22d6b78-2a6a-4c36-ad46-686bed3a6f5a', 'Dominica', 'Dominica', 'DM', 'DMA', 1767, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('d729ab4f-0e43-4374-bd5b-b369e574f1e0', 'Guam', 'Guam', 'GU', 'GUM', 1671, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('0c812afd-f6c2-4fef-8cbd-93b756f443ce', 'Antigua and Barbuda', 'Antigua y Barbuda', 'AG', 'ATG', 1268, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('311c8367-b7ac-4849-a5ab-096f9ad8dc79', 'Hong Kong', 'Hong kong', 'HK', 'HKG', 852, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('eb1e5009-5ee0-4903-9ddb-1e3bc6c8086a', 'Hungary', 'Hungría', 'HU', 'HUN', 36, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('d52eee5a-cd7f-4693-b572-3ea17aae4869', 'India', 'India', 'IN', 'IND', 91, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('cae3b682-e749-4da9-a651-856c794d9b38', 'Iran', 'Irán', 'IR', 'IRN', 98, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('600216bc-1f3f-43b1-a2b3-c7ba4b4c5b59', 'Iraq', 'Irak', 'IQ', 'IRQ', 964, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('1b5c0f5f-7049-4821-af3c-fe9a50ca2875', 'Ireland', 'Irlanda', 'IE', 'IRL', 353, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('f9247127-e9b3-4cc2-899a-c1947e697627', 'Christmas Island', 'Isla de Navidad', 'CX', 'CXR', 61, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('47243b14-df66-4c42-a924-8337a4c88622', 'Norfolk Island', 'Isla Norfolk', 'NF', 'NFK', 672, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('1df4fbaa-9175-4789-ae62-35934fba320e', 'Cocos (Keeling) Islands', 'Islas Cocos (Keeling)', 'CC', 'CCK', 61, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('0c3381b4-a15f-4b7b-a54d-e0155448cc49', 'Cook Islands', 'Islas Cook', 'CK', 'COK', 682, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('32fc8748-539a-42b7-90a4-4ba0b370af83', 'Cuba', 'Cuba', 'CU', 'CUB', 53, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('adcc36c5-2d4a-4fa6-9cd9-978a579df2c3', 'Nicaragua', 'Nicaragua', 'NI', 'NIC', 505, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('cfe4fc76-3add-4a86-bcb2-ae139fcc9f0c', 'Faroe Islands', 'Islas Feroe', 'FO', 'FRO', 298, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('598e478c-0b99-4319-96d6-d847201d802c', 'South Georgia and the South Sandwich Islands', 'Islas Georgias del Sur y Sandwich del Sur', 'GS', 'SGS', 500, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('34c04e0c-c823-48df-aab5-6338f5d11386', 'Maldives', 'Islas Maldivas', 'MV', 'MDV', 960, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('b217d072-72da-4d44-bec1-7ec7fcd57581', 'Marshall Islands', 'Islas Marshall', 'MH', 'MHL', 692, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('60d045f8-b657-4d5a-8f6f-51be61a22a94', 'Pitcairn Islands', 'Islas Pitcairn', 'PN', 'PCN', 870, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('0380e2d8-44a1-4fe1-9f26-2cf6ed1e873f', 'Solomon Islands', 'Islas Salomón', 'SB', 'SLB', 677, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('5824324e-4ddf-4387-be4c-c34c803222a7', 'Israel', 'Israel', 'IL', 'ISR', 972, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('e0fa53ef-f608-48f4-8cd3-185dba3500c1', 'Italy', 'Italia', 'IT', 'ITA', 39, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('83dbcd95-5a23-42f8-baeb-5ad98c55683a', 'Japan', 'Japón', 'JP', 'JPN', 81, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('8166207a-39a1-47cb-8989-bdd804cb198d', 'Jersey', 'Jersey', 'JE', 'JEY', 44, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('8f96dc39-00f1-4e31-81ee-b94eecb90965', 'Jordan', 'Jordania', 'JO', 'JOR', 962, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('3930f70e-35b4-4b59-a7a5-4aaee7962a95', 'Kazakhstan', 'Kazajistán', 'KZ', 'KAZ', 7, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('b45ded50-050d-4e5e-a5b7-9a09ae7fcfb8', 'Kenya', 'Kenia', 'KE', 'KEN', 254, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('8620005e-1f6d-4b22-be51-bb2acc990d06', 'Kiribati', 'Kiribati', 'KI', 'KIR', 686, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('bd96c55c-f5b0-4e64-9525-9c729292779b', 'Kuwait', 'Kuwait', 'KW', 'KWT', 965, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('f03850b6-c55e-4028-8757-38ba911e501b', 'Laos', 'Laos', 'LA', 'LAO', 856, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('346b32dd-973e-4adf-a800-14ac187033ff', 'Lesotho', 'Lesoto', 'LS', 'LSO', 266, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('c9d23a0b-ae22-443b-97cd-d8764f3bb3f6', 'Latvia', 'Letonia', 'LV', 'LVA', 371, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('7a048706-0a01-456a-bda4-fb6e953ba8c7', 'Libya', 'Libia', 'LY', 'LBY', 218, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('bbb98134-3df2-4043-bff8-b03908ed8f5a', 'Liechtenstein', 'Liechtenstein', 'LI', 'LIE', 423, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('c1212200-cc5a-411c-9048-b067d25a358b', 'Luxembourg', 'Luxemburgo', 'LU', 'LUX', 352, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('67500fc6-cf56-41e3-8ca3-0e3fd1c2d1c3', 'Monaco', 'Mónaco', 'MC', 'MCO', 377, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('453fb606-4928-4d40-b69b-617d01385d72', 'Macao', 'Macao', 'MO', 'MAC', 853, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('f711ff6c-1356-4074-a27b-40872df3c092', 'Madagascar', 'Madagascar', 'MG', 'MDG', 261, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('0efdc0a6-35ee-49ec-a5c6-75f02ccfe966', 'Malaysia', 'Malasia', 'MY', 'MYS', 60, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('2bfa64d7-278d-439c-b379-8add376cb579', 'Malawi', 'Malawi', 'MW', 'MWI', 265, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('c7777f9e-8ac0-48a4-9925-6ca649548257', 'Malta', 'Malta', 'MT', 'MLT', 356, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('52c0c083-4ce4-435e-8984-ce47e62701c4', 'Morocco', 'Marruecos', 'MA', 'MAR', 212, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('eec13357-aaa0-4ce1-875f-f0a829693f1c', 'Mauritius', 'Mauricio', 'MU', 'MUS', 230, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('701f33a0-eeba-420d-89c7-cd789c318ebf', 'Mauritania', 'Mauritania', 'MR', 'MRT', 222, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('c5ef187c-0e30-444b-87d4-531ee12436f6', 'Estados Federados de', 'Micronesia', 'FM', 'FSM', 691, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('411548d1-74da-437b-ab81-fe148fde91a9', 'Moldova', 'Moldavia', 'MD', 'MDA', 373, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('49c1a73a-19bd-4bcf-af71-39263f4c6a11', 'Mongolia', 'Mongolia', 'MN', 'MNG', 976, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('ac312ae4-4c10-43a1-8d04-b3cd0eb04f2c', 'Mozambique', 'Mozambique', 'MZ', 'MOZ', 258, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('d87c454c-4218-4578-9ecc-8f4d85e69283', 'Namibia', 'Namibia', 'NA', 'NAM', 264, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('6d38230a-83e8-4e10-b821-589318188e58', 'Nauru', 'Nauru', 'NR', 'NRU', 674, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('3b654793-bc38-4c5d-8d2f-e296ee4db12a', 'Niger', 'Niger', 'NE', 'NER', 227, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('c11aacd7-9015-463c-b7ab-a93a0dd177d1', 'Nigeria', 'Nigeria', 'NG', 'NGA', 234, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('d399ebf5-87e2-402d-8f47-9f477ef23c3f', 'Norway', 'Noruega', 'NO', 'NOR', 47, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('c60f3717-0d3a-4f0b-9317-e063a1eb7dc2', 'New Caledonia', 'Nueva Caledonia', 'NC', 'NCL', 687, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('5c0f56fb-0dec-442b-86fb-96b42a6b9807', 'Oman', 'Omán', 'OM', 'OMN', 968, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('eba1d23b-d433-4a7c-85b1-9bd5f053e587', 'Netherlands', 'Países Bajos', 'NL', 'NLD', 31, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('56b6d1d9-5354-4711-9ab8-a3a9071ce009', 'Pakistan', 'Pakistán', 'PK', 'PAK', 92, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('259e0d66-c3c1-4426-b80f-8abcf601309f', 'Palau', 'Palau', 'PW', 'PLW', 680, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('ab19f4ca-d0d9-4e42-9452-1354aec4dfa2', 'Peru', 'Perú', 'PE', 'PER', 51, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('c38339fd-9f32-4d3f-bd04-748679ecff5c', 'Cayman Islands', 'Islas Caimán', 'KY', 'CYM', 1345, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('05793bc5-9a21-411d-9ba5-25fe271a8334', 'Turks and Caicos Islands', 'Islas Turcas y Caicos', 'TC', 'TCA', 1649, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('00fdf0e3-aeb3-4c5e-8bbe-d4a978efc8a6', 'Virgin Islands', 'Islas Vírgenes Británicas', 'VG', 'VGB', 1284, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('925e096e-7225-4069-89aa-b5bc5446c546', 'Jamaica', 'Jamaica', 'JM', 'JAM', 1876, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('9f7ddc73-955b-43c1-b075-437cf29f9bfc', 'Montserrat', 'Montserrat', 'MS', 'MSR', 1664, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('26ef8ead-953a-4f8b-a5a6-9fad1e705161', 'Heard Island and McDonald Islands', 'Islas Heard y McDonald', 'HM', 'HMD', 0, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('b8bbcc7e-461f-46cf-8ad4-5c41b695a899', 'Bouvet Island', 'Isla Bouvet', 'BV', 'BVT', 0, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('7c4ec68e-f83d-4df1-aef6-b99b8eea264b', 'Papua New Guinea', 'Papúa Nueva Guinea', 'PG', 'PNG', 675, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('89276d2b-3e7c-4541-82ae-63f781bb2276', 'Poland', 'Polonia', 'PL', 'POL', 48, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('2423797f-4b89-4dcb-80ac-c147a77a77d4', 'Portugal', 'Portugal', 'PT', 'PRT', 351, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('363aa43c-66b7-4f30-a980-dbbbbe444ee1', 'Qatar', 'Qatar', 'QA', 'QAT', 974, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('a7f47aeb-3e7b-4a18-90c6-1d202a222c46', 'United Kingdom', 'Reino Unido', 'GB', 'GBR', 44, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('7375136f-afcb-423d-a7f8-47ee1d38a5b9', 'Czech Republic', 'República Checa', 'CZ', 'CZE', 420, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('bd4d9024-9949-4874-805a-91a0a3fa0ba9', 'South Sudan', 'República de Sudán del Sur', 'SS', 'SSD', 211, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('476b58f7-a578-4a3b-aba7-b6166a8a0bbc', 'Réunion', 'Reunión', 'RE', 'REU', 262, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('0794dd4a-cbbf-4eef-a94b-b8b8fc8d938b', 'Rwanda', 'Ruanda', 'RW', 'RWA', 250, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('7afa93a3-4b07-4aec-98a2-9ab5273b3133', 'Russia', 'Rusia', 'RU', 'RUS', 7, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('f3a14a0e-ca61-46bf-a539-fe4a3dc09ee4', 'Western Sahara', 'Sahara Occidental', 'EH', 'ESH', 212, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('53b4ceeb-e818-44d0-8ac8-739b72d7fff2', 'Samoa', 'Samoa', 'WS', 'WSM', 685, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('467265f6-a458-477e-974e-8ee2c5c49ed6', 'San Marino', 'San Marino', 'SM', 'SMR', 378, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('5ebe6d8b-0e86-44ac-8d7a-2c96f54bab8a', 'Ascensión y Tristán de Acuña', 'Santa Elena', 'SH', 'SHN', 290, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('949fd22a-3ac6-47ca-ab6b-5de32f364cd1', 'Sao Tome and Principe', 'Santo Tomé y Príncipe', 'ST', 'STP', 239, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('71d61d02-cb7f-4644-b67f-249e8c1fb40c', 'Senegal', 'Senegal', 'SN', 'SEN', 221, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('afe54131-6cc6-48d7-8084-aabb6c9fe862', 'Serbia', 'Serbia', 'RS', 'SRB', 381, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('6c4ea4eb-baf3-450f-a80a-72e84eb81754', 'Seychelles', 'Seychelles', 'SC', 'SYC', 248, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('3cf010e7-f171-4b98-a907-7122f6bbd644', 'Panama', 'Panamá', 'PA', 'PAN', 507, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('e56e26df-5232-434d-ac1b-4cf1c3e48a9f', 'El Salvador', 'El Salvador', 'SV', 'SLV', 503, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('15b964cb-5c81-4d9b-b986-696a4fd447fc', 'Puerto Rico', 'Puerto Rico', 'PR', 'PRI', 1, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('e2469f34-aa1c-44e3-baba-b06802c923c6', 'Afghanistan', 'Afganistán', 'AF', 'AFG', 93, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('e5f1743c-a0d9-434c-820f-ecb70ecfd4c2', 'Angola', 'Angola', 'AO', 'AGO', 244, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('ec05b204-12b9-4415-9efd-14d2fd4b97ab', 'Algeria', 'Argelia', 'DZ', 'DZA', 213, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('72b16060-8532-44d1-9902-1738b92878fb', 'Austria', 'Austria', 'AT', 'AUT', 43, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('e45a9f9d-2216-41e5-b9d6-2905b56e7f10', 'Bahrain', 'Bahrein', 'BH', 'BHR', 973, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('340a807d-a231-4ff1-9978-e288744200f7', 'Bhutan', 'Bhután', 'BT', 'BTN', 975, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('aec33d8d-8ab5-47ec-9b4e-2ac9d9828fa0', 'Bosnia and Herzegovina', 'Bosnia y Herzegovina', 'BA', 'BIH', 387, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('e1e3c625-858e-4b84-8119-cd112db964a8', 'Burkina Faso', 'Burkina Faso', 'BF', 'BFA', 226, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('9c68abd2-ed80-461c-a6e8-91e6dd1ed47a', 'Cameroon', 'Camerún', 'CM', 'CMR', 237, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('75314f56-0f0b-48b3-a6a6-02f876b10493', 'Cyprus', 'Chipre', 'CY', 'CYP', 357, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('d0481eab-3600-4f48-adbe-45133068b75d', 'Republic of the Congo', 'República del Congo', 'CG', 'COG', 242, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('7f8f2a87-a8ad-4c7e-aa09-3388344132d5', 'Ivory Coast', 'Costa de Marfil', 'CI', 'CIV', 225, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('0e7f4120-0dd7-4022-ac53-62744db99874', 'United Arab Emirates', 'Emiratos Árabes Unidos', 'AE', 'ARE', 971, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('977813c7-ee7d-433e-9df8-578007c477d5', 'United States of America', 'Estados Unidos de América', 'US', 'USA', 1, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('dd0e6abe-56f9-45e1-9ff7-93dfe9221875', 'Finland', 'Finlandia', 'FI', 'FIN', 358, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('88a16c89-0a84-4916-853a-3abb8d606cad', 'Gambia', 'Gambia', 'GM', 'GMB', 220, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('b4eb02db-09d2-42d4-9b7f-cb6908eaef23', 'Greece', 'Grecia', 'GR', 'GRC', 30, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('5f5d7a19-77fb-48c8-9ce7-226623af7093', 'French Guiana', 'Guayana Francesa', 'GF', 'GUF', 594, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('b18b6853-31af-4a8a-8415-2f5d9ec3d753', 'Guyana', 'Guyana', 'GY', 'GUY', 592, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('4c587d29-bcbe-481f-b834-c83ff45c93b1', 'Grenada', 'Granada', 'GD', 'GRD', 1473, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('66c8e326-cfde-4961-800b-fbd4887d4945', 'Anguilla', 'Anguila', 'AI', 'AIA', 1264, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('61fef665-4b80-434c-bdda-7f0d0022fd4a', 'Indonesia', 'Indonesia', 'ID', 'IDN', 62, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('998c1999-63a2-4c49-9d71-b803880722ae', 'Isle of Man', 'Isla de Man', 'IM', 'IMN', 44, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('a994fce2-d603-4736-b482-5ac22322ca8f', 'Iceland', 'Islandia', 'IS', 'ISL', 354, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('e356c827-ffa4-43b2-96da-6f0735fd1dd3', 'Åland Islands', 'Islas de Åland', 'AX', 'ALA', 358, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('130e97b2-f72f-44ee-8419-d06e3f7185b7', 'Falkland Islands (Malvinas)', 'Islas Malvinas', 'FK', 'FLK', 500, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('dae390d9-12b4-4d46-be74-b64892539c76', 'United States Minor Outlying Islands', 'Islas Ultramarinas Menores de Estados Unidos', 'UM', 'UMI', 246, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('ca645192-6b8d-4955-885a-5fd7c0b086c6', 'Kyrgyzstan', 'Kirguistán', 'KG', 'KGZ', 996, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('6a6d22f7-20e3-4c83-9c92-1b945f1562ef', 'Syria', 'Siria', 'SY', 'SYR', 963, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('fa1b9e11-80c5-46b0-a460-77b758527492', 'Somalia', 'Somalia', 'SO', 'SOM', 252, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('fc269d7c-af30-4772-a6d7-8b7d9919bfd7', 'Sri Lanka', 'Sri lanka', 'LK', 'LKA', 94, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('d34b7f2f-a69b-49c6-9a1e-f1ab2c719a8f', 'Sudan', 'Sudán', 'SD', 'SDN', 249, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('bca8fa2a-f3b3-4488-8036-2aa7520148b1', 'Sweden', 'Suecia', 'SE', 'SWE', 46, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('1089f790-99e0-464c-8b26-def1ff4cd1d9', 'Switzerland', 'Suiza', 'CH', 'CHE', 41, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('f77313f3-0516-49c8-b51f-37890e210ff2', 'Svalbard and Jan Mayen', 'Svalbard y Jan Mayen', 'SJ', 'SJM', 47, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('0b9c7036-b980-4de3-9d42-fac485fcc561', 'Swaziland', 'Swazilandia', 'SZ', 'SWZ', 268, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('12357921-c0be-4665-ad31-7c11053c91eb', 'Thailand', 'Tailandia', 'TH', 'THA', 66, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('80c24bd1-748e-4248-ad2e-4580ac559f18', 'Taiwan', 'Taiwán', 'TW', 'TWN', 886, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('1efa4536-962b-4ac9-b54f-30aa6f8efdef', 'Tanzania', 'Tanzania', 'TZ', 'TZA', 255, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('6da036f5-e398-4e71-9898-639ee0da82cf', 'East Timor', 'Timor Oriental', 'TL', 'TLS', 670, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('212a62e2-2e1a-46d0-8c5a-67606dfe5fe9', 'Togo', 'Togo', 'TG', 'TGO', 228, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('fead2fcb-ab46-4215-badc-35e8e47682cc', 'Tokelau', 'Tokelau', 'TK', 'TKL', 690, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('2170fd89-02ff-4cb1-b0a1-9d72dde72766', 'Tonga', 'Tonga', 'TO', 'TON', 676, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('9b0cbf58-32f8-42ac-a5f3-c58586f0ece9', 'Tunisia', 'Tunez', 'TN', 'TUN', 216, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('5660bd02-f31a-4ac0-a13e-3c5ed6b35cab', 'Turkey', 'Turquía', 'TR', 'TUR', 90, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('dcfa440e-24a9-40c0-86ed-bca03d286b50', 'Tuvalu', 'Tuvalu', 'TV', 'TUV', 688, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('ac070fec-c7f5-4e8c-954b-291bf49d05da', 'Uganda', 'Uganda', 'UG', 'UGA', 256, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('9a3c01c3-6b83-4b8e-918b-b4c9759f5427', 'Uzbekistan', 'Uzbekistán', 'UZ', 'UZB', 998, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('c29165d2-e4e6-4925-a6ee-a712b3db7a35', 'Vanuatu', 'Vanuatu', 'VU', 'VUT', 678, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('ccf9f871-7b50-4b0e-880b-987bd77c72e9', 'Wallis and Futuna', 'Wallis y Futuna', 'WF', 'WLF', 681, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('52da12da-99a4-4a4c-a5ad-5e1845c3e63c', 'Yemen', 'Yemen', 'YE', 'YEM', 967, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('5f6211c3-0b31-44e0-acbc-52def5155661', 'Djibouti', 'Yibuti', 'DJ', 'DJI', 253, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('124c4249-dd84-44e1-bf88-0727d29ac810', 'Zimbabwe', 'Zimbabue', 'ZW', 'ZWE', 263, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('7fc7608b-1a48-4228-9434-6c939e13689b', 'Bahamas', 'Bahamas', 'BS', 'BHS', 1242, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('3faf6147-bdca-423b-9a93-daf0daaff698', 'Trinidad and Tobago', 'Trinidad y Tobago', 'TT', 'TTO', 1868, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('abe7faf2-ed67-4173-a123-72afa5519906', 'American Samoa', 'Samoa Americana', 'AS', 'ASM', 1684, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('6a0da330-34a9-4f0e-8dd1-84b75f748b14', 'Saint Martin (French part)', 'San Martín (Francia)', 'MF', 'MAF', 1599, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('6695faee-f1cd-49e3-b1d1-934f33fd67ea', 'Saint Vincent and the Grenadines', 'San Vicente y las Granadinas', 'VC', 'VCT', 1784, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('10cbdc16-b0cf-47c5-a107-bc2446b40248', 'Saint Lucia', 'Santa Lucía', 'LC', 'LCA', 1758, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('505ca01e-0599-42f5-9403-88ad36843caa', 'Sint Maarten', 'Sint Maarten', 'SX', 'SMX', 1721, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('81ebacc8-a279-4e7f-afa5-a1c93a2efe60', 'Chile', 'Chile', 'CL', 'CHL', 56, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('ac437efc-0efe-4952-964e-d15652902269', 'Costa Rica', 'Costa Rica', 'CR', 'CRI', 506, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('f6885457-ff29-49e3-82e1-79647f4d75a1', 'Dominican Republic', 'República Dominicana', 'DO', 'DOM', 1809, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('13df98ac-6149-4413-8795-0aec6b46cb77', 'Honduras', 'Honduras', 'HN', 'HND', 504, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('a5d77a18-b7c6-4fd2-8163-ba8ad0037ef7', 'Mexico', 'México', 'MX', 'MEX', 52, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('ac74c403-70a1-4260-9db5-fa74029ee8e4', 'Paraguay', 'Paraguay', 'PY', 'PRY', 595, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('178d3176-33a2-4736-8ece-f1f35fc74f1b', 'Uruguay', 'Uruguay', 'UY', 'URY', 598, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('19bab541-0d64-442a-9fd2-76b394e855c7', 'Venezuela', 'Venezuela', 'VE', 'VEN', 58, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('1066b240-a660-4fa2-b5a0-62737ae86e33', 'Bolivia', 'Bolivia', 'BO', 'BOL', 591, 'fa1d7e92-7eb1-4dcf-a54b-1a25e7cfe242');
  INSERT OR IGNORE INTO "country" VALUES ('fac64afd-f88a-44e8-bc35-7c1b843cd513', 'Lebanon', 'Líbano', 'LB', 'LBN', 961, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('3e68d2f0-eac9-493d-b272-02d14d67a3b2', 'Liberia', 'Liberia', 'LR', 'LBR', 231, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('af5261f5-d308-43cd-bbc1-589b05d7dd4f', 'Lithuania', 'Lituania', 'LT', 'LTU', 370, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('f2b8f53c-7d96-42ae-9bbd-2dbba99c6f67', 'Macedonia', 'Macedônia', 'MK', 'MKD', 389, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('b1deb220-1c69-4227-847d-d956c3b67187', 'Mali', 'Mali', 'ML', 'MLI', 223, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('9e540bef-2c6b-4724-b17d-1788247ead6f', 'Martinique', 'Martinica', 'MQ', 'MTQ', 596, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('7f403314-7302-422d-b39f-c31ec8bd9566', 'Mayotte', 'Mayotte', 'YT', 'MYT', 262, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('2f9e5d3a-4fdd-476d-963d-6c76befc6a52', 'Montenegro', 'Montenegro', 'ME', 'MNE', 382, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('efd5385c-64d0-4268-af88-701f7dcd4f55', 'Nepal', 'Nepal', 'NP', 'NPL', 977, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('3c495d1e-0324-47f2-b249-930a6714eb01', 'Niue', 'Niue', 'NU', 'NIU', 683, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('4639d345-1022-4e4c-93e7-45e84cf05f4f', 'New Zealand', 'Nueva Zelanda', 'NZ', 'NZL', 64, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('6b9dd5d8-4993-49ce-b594-dbdb8ddc9f18', 'Palestine', 'Palestina', 'PS', 'PSE', 970, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('de84fef7-e05b-4d95-bf20-85b52225e28e', 'Northern Mariana Islands', 'Islas Marianas del Norte', 'MP', 'MNP', 1670, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('cd508afc-0487-4429-93e5-4d688de5d5a2', 'United States Virgin Islands', 'Islas Vírgenes de los Estados Unidos', 'VI', 'VIR', 1340, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('8f96584e-1c44-401f-bd34-2d6b63e304e7', 'French Polynesia', 'Polinesia Francesa', 'PF', 'PYF', 689, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('31a24a88-506f-4811-bc8a-09c87c474544', 'Central African Republic', 'República Centroafricana', 'CF', 'CAF', 236, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('d2bf2629-72b5-441c-b01f-98a7b0b9f93a', 'Romania', 'Rumanía', 'RO', 'ROU', 40, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('6ec743f8-0513-4f94-9fb4-85c96d83f782', 'Saint Barthélemy', 'San Bartolomé', 'BL', 'BLM', 590, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('33a75043-5f35-4682-beb1-7037ee00a3da', 'Saint Pierre and Miquelon', 'San Pedro y Miquelón', 'PM', 'SPM', 508, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('df2d4fdb-b609-4e8f-90a9-a7e10740908e', 'Sierra Leone', 'Sierra Leona', 'SL', 'SLE', 232, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('1ffdc51c-7264-40c9-9432-4094846a2007', 'Singapore', 'Singapur', 'SG', 'SGP', 65, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('9ba37434-95f3-4d97-a502-5744dde443f5', 'South Africa', 'Sudáfrica', 'ZA', 'ZAF', 27, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('cfd9dcda-1d4d-4594-b862-71db815b37da', 'Suriname', 'Surinám', 'SR', 'SUR', 597, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('c0a41a0b-49f0-4f51-8048-e34991b0bbfc', 'Tajikistan', 'Tayikistán', 'TJ', 'TJK', 992, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('25291244-cc10-405e-9a3c-8334801e564c', 'British Indian Ocean Territory', 'Territorio Británico del Océano Índico', 'IO', 'IOT', 246, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('cfc76e3f-bb33-4d0b-b41e-2301ab6eac03', 'Turkmenistan', 'Turkmenistán', 'TM', 'TKM', 993, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('f6067fc8-90e7-41e2-9c45-44bc8ef72786', 'Ukraine', 'Ucrania', 'UA', 'UKR', 380, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('efe82abe-5e05-4e7e-83fd-bf1dcd309f9c', 'Vietnam', 'Vietnam', 'VN', 'VNM', 84, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('4409fe70-5a66-415e-b6b8-d34c14f96ede', 'Zambia', 'Zambia', 'ZM', 'ZMB', 260, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('dcd0c05e-67de-45b3-bee3-6f4e5b404f79', 'Bermuda Islands', 'Islas Bermudas', 'BM', 'BMU', 1441, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('b2194356-ca8a-4c36-8f75-ab11ddb2b6aa', 'Saint Kitts and Nevis', 'San Cristóbal y Nieves', 'KN', 'KNA', 1869, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "country" VALUES ('c95af8f4-1a1b-4e1d-966c-69ce758fe60c', 'French Southern Territories', 'Territorios Australes y Antárticas Franceses', 'TF', 'ATF', 0, '78933d1b-b49f-4eb5-b512-bafa7fec6055');
  INSERT OR IGNORE INTO "fulfillment" VALUES ('4294b886-85f4-45fa-9937-b74e7824b896', 'DELIVERY');
  INSERT OR IGNORE INTO "fulfillment" VALUES ('ed345e57-4fb1-4111-8603-9c820417ed3e', 'EATIN');
  INSERT OR IGNORE INTO "fulfillment" VALUES ('7ab17b56-2986-40d2-9b12-4093cdf594f6', 'CURBSIDE');

  INSERT OR IGNORE INTO "payment" VALUES ('227442a7-9c4e-43f7-9924-d0039c727dca', 'CASH');
  INSERT OR IGNORE INTO "payment" VALUES ('bc307676-fe8b-46e4-bad9-f35fab03ed90', 'CARD');

  INSERT OR IGNORE INTO "permission" VALUES ('ba15e452-f491-4fe9-ac05-f632b06ea202', 'UPDATE_LOYALTY');
  INSERT OR IGNORE INTO "permission" VALUES ('3c3c424b-c10c-4598-9397-1247c8efc8b8', 'UPDATE_PERSONNEL');
  INSERT OR IGNORE INTO "permission" VALUES ('fa8caf79-6a89-4005-a84f-bfcb6a9d57b3', 'UPDATE_LOCATION_GROUP');
  INSERT OR IGNORE INTO "permission" VALUES ('da320500-cff4-40e1-a041-8a5cd7aa3b45', 'UPDATE_MENU');
  INSERT OR IGNORE INTO "permission" VALUES ('df3eee32-488e-420f-843f-48b27295c892', 'UPDATE_ORDER');
  INSERT OR IGNORE INTO "permission" VALUES ('0d6aaf00-6303-44d7-9663-5782e4165e00', 'SEE_TOTALS');
  INSERT OR IGNORE INTO "permission" VALUES ('885ffd6d-e223-447b-94af-452007ae119a', 'SEE_ANALYTICS');

  INSERT OR IGNORE INTO "printerType" VALUES ('8352ed8a-a0a8-4a11-b117-b241c0865f1a', 'RELAY');
  INSERT OR IGNORE INTO "printerType" VALUES ('102e9428-4e72-4439-a97a-4b8d32fc7626', 'ESCPOS');
  INSERT OR IGNORE INTO "printerType" VALUES ('dcf5fc50-5474-49d2-b7df-4fe10071f85e', 'WINDOWS');
`
