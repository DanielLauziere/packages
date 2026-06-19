export interface DbAdapter {
  run(sql: string, params?: any[]): void
  query(sql: string, params?: any[]): any[]
}
