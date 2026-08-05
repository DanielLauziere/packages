// The union SQLite schema and seed data are generated from the server's
// baseline.sql by the translator (omni/cmd/translate). The generated module
// owns SCHEMA_VERSION, FULL_DDL, SEED_ORDER, SEED_COLUMNS. Under the snake_case
// wire contract (§5.5a) the payload key IS the SQLite table/column — no
// SEED_TABLE_KEY translation layer.
export { SCHEMA_VERSION, FULL_DDL, SEED_ORDER, SEED_COLUMNS } from './generatedSchema.js'
export type { EngineColumn } from './generatedSchema.js'
