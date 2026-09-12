export interface DbAdapter {
  run(sql: string, params?: any[]): Promise<void>
  query(sql: string, params?: any[]): Promise<any[]>
}
