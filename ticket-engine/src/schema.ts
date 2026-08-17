// The union SQLite schema and seed data are generated from the server's
// baseline.sql by the translator (omni/cmd/translate). The generated module
// owns SCHEMA_UUID, FULL_DDL, SEED_ORDER, SEED_COLUMNS.
//
// Under the server-driven contract (CORE-LOGIC-SCHEMA-SYNC.md) the LIVE schema
// for migration comes from /v1/schema/snapshot — FULL_DDL here
// is a TRANSITIONAL fallback only: it exists so a client predating the
// rollout or talking to a pre-rollout server never wipes blind. Remove once the
// full rollout (server + both clients) is complete.
export { SCHEMA_UUID, FULL_DDL, SEED_ORDER, SEED_COLUMNS } from './generatedSchema.js'
export type { EngineColumn } from './generatedSchema.js'
