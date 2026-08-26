// Under the snake_case wire contract (§5.5a) the wire key IS the SQLite
// column/table name — identity. The previous SEED_COLUMNS/SEED_TABLE_KEY
// camel↔snake translation layer has been removed; all functions are pass-
// through so consumers (server codegen, row readers) agree on one naming
// scheme without any overhead.
export function rowFromDb<T extends Record<string, unknown> = Record<string, unknown>>(
  row: Record<string, unknown>,
): T {
  return row as T
}

export function rowsFromDb<T>(rows: Record<string, unknown>[]): T[] {
  return rows as T[]
}

export function dbName(camelKey: string): string {
  return camelKey
}

export function dbTableName(payloadKey: string): string {
  return payloadKey
}

export function dbColumnName(camelKey: string): string {
  return camelKey
}