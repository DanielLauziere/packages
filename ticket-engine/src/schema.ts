// The union SQLite schema and seed data are generated from the server's
// baseline.sql by the translator (omni/cmd/translate). The generated module
// owns SCHEMA_UUID, FULL_DDL, SEED_ORDER, SEED_COLUMNS, TABLES.
//
// Since LOCAL-MIGRATION-AND-SEED.md §C the bundled descriptor below is the
// schema source for a client on local migration (web today; RN when its boot
// switches over): reconcileSchema receives it directly and the schema is
// versioned with the client build. /v1/schema/snapshot stays on the server for
// clients still on the server handshake, and FULL_DDL remains their offline
// fallback.
export { SCHEMA_UUID, FULL_DDL, SEED_ORDER, SEED_COLUMNS, TABLES } from './generatedSchema.js'
export type { EngineColumn } from './generatedSchema.js'
import type { ReconcileDescriptor } from './reconcileSchema.js'
import { SCHEMA_UUID, FULL_DDL, TABLES } from './generatedSchema.js'

// The bundled descriptor: what a local-migration client passes to
// reconcileSchema instead of fetching /v1/schema/snapshot
// (LOCAL-MIGRATION-AND-SEED.md §C).
export const bundledDescriptor: ReconcileDescriptor = {
  schemaUuid: SCHEMA_UUID,
  fullDdl: FULL_DDL,
  tables: TABLES,
}

// The oldest SQLite engine in the fleet: RN bundles this exact build via
// react-native-quick-sqlite 8.2.7 (cpp/sqlite3.h SQLITE_VERSION). EVERY client
// SQL statement must parse on it — nothing newer-only may reach the wire, DDL
// or seeds (CRITICAL-RISKS.md Risk 2 / non-negotiable 9). The RN jest suite
// re-reads cpp/sqlite3.h and fails the build if the bundle ever bumps past it.
export const SQLITE_MIN_VERSION = '3.39.4'
