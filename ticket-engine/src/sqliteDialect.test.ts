import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { FULL_DDL, SQLITE_MIN_VERSION } from './index.js'

// CRITICAL-RISKS.md Risk 2, gaps 1–2 (T3): every client SQL statement must
// parse on SQLite 3.39.4, the oldest engine in the fleet (RN bundle). Anything
// in this list is a version landmine that silently breaks old tablets only.
// Keep in sync with the exact constructs SQLite added AFTER 3.39.4.

const BANNED_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'RETURNING', re: /\bRETURNING\b/ },
  { name: "result-set STRICT table option", re: /\)\s*STRICT\b/ },
  { name: 'window function OVER (', re: /\bOVER\s*\(/ },
  { name: 'aggregate FILTER (', re: /\bFILTER\s*\(/ },
  { name: 'generated column GENERATED ALWAYS', re: /(?:GENERATED\s+ALWAYS\s+AS|GENERATED\s+AS\s*\()/ },
  { name: 'WITHOUT ROWID table', re: /\bWITHOUT\s+ROWID\b/ },
  { name: 'partial index CREATE INDEX ... WHERE', re: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b[^;]*\bWHERE\b/i },
]

function lint(sqlOrSource: string): string[] {
  const hits: string[] = []
  for (const { name, re } of BANNED_PATTERNS) {
    const m = sqlOrSource.match(re)
    if (m) hits.push(`${name} → "${m[0]}"`)
  }
  return hits
}

// Collect every SQL statement string literal the engine ships (apply + seed +
// heal + migrate), by reading the source modules' SQL template literals.
function engineSqlStatements(): string[] {
  const here = dirname(fileURLToPath(import.meta.url))
  const files = [
    'applyTicketLog.ts',
    'seedDatabase.ts',
    'seedGroupDatabase.ts',
    'migrateSchema.ts',
    'calculateCombos.ts',
  ]
  const out: string[] = []
  for (const f of files) {
    const src = readFileSync(join(here, f), 'utf8')
    const literals = src.match(/`[^`]*`/g) ?? []
    for (const lit of literals) {
      if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|PRAGMA|BEGIN|COMMIT|ROLLBACK|WITH)\b/i.test(lit)) {
        out.push(lit)
      }
    }
  }
  return out
}

describe('SQLite-3.39.4 dialect floor (T3) — full_ddl + engine SQL', () => {
  it('records the floor constant at 3.39.4', () => {
    expect(SQLITE_MIN_VERSION).toBe('3.39.4')
  })

  it('FULL_DDL stays inside the 3.39.4 subset', () => {
    const hits = lint(FULL_DDL)
    expect(hits).toEqual([])
  })

  it('every engine SQL statement stays inside the 3.39.4 subset', () => {
    const statements = engineSqlStatements()
    expect(statements.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const stmt of statements) {
      const hits = lint(stmt)
      for (const h of hits) offenders.push(`${stmt.slice(0, 60)}… : ${h}`)
    }
    expect(offenders).toEqual([])
  })

  it('the lint itself catches each banned construct (positive controls)', () => {
    expect(lint('INSERT INTO x (id) VALUES (?) RETURNING id').length).toBeGreaterThan(0)
    expect(lint('CREATE TABLE t (id INTEGER PRIMARY KEY) STRICT').length).toBeGreaterThan(0)
    expect(lint('SELECT row_number() OVER (ORDER BY ts) FROM tl').length).toBeGreaterThan(0)
    expect(lint('SELECT sum(x) FILTER (WHERE y = 1) FROM tl').length).toBeGreaterThan(0)
    expect(lint('ALTER TABLE t ADD COLUMN g INTEGER GENERATED ALWAYS AS (x*2)').length).toBeGreaterThan(0)
    expect(lint('CREATE TABLE t (id INTEGER PRIMARY KEY) WITHOUT ROWID').length).toBeGreaterThan(0)
    expect(lint('CREATE INDEX ix ON t (a) WHERE b = 1').length).toBeGreaterThan(0)
  })
})

describe('SQLite-3.39.4 dialect floor (T3) — client SQL in the repos', () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const clientDirs = [
    join(repoRoot, 'rolonative', 'src'),
    join(repoRoot, 'frontend', 'src'),
  ]

  function collectSql(dir: string): { file: string; sql: string }[] {
    const found: { file: string; sql: string }[] = []
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        found.push(...collectSql(p))
      } else if (/\.(ts|tsx)$/.test(e.name)) {
        const src = readFileSync(p, 'utf8')
        const literals = src.match(/`[^`]*`/g) ?? []
        const quotes = src.match(/'(?:[^'\\]|\\.)*'/g) ?? []
        for (const lit of [...literals, ...quotes]) {
          if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|PRAGMA|BEGIN|COMMIT|ROLLBACK|WITH)\b/i.test(lit)) {
            found.push({ file: p, sql: lit })
          }
        }
      }
    }
    return found
  }

  for (const dir of clientDirs) {
    it(`every SQL string under ${dir} stays inside the 3.39.4 subset`, () => {
      const statements = collectSql(dir)
      expect(statements.length).toBeGreaterThan(0)
      const offenders: string[] = []
      for (const { file, sql } of statements) {
        for (const h of lint(sql)) {
          offenders.push(`${file} → ${sql.slice(0, 60)}… : ${h}`)
        }
      }
      expect(offenders).toEqual([])
    })
  }

  it('the actual RN bundled engine (cpp/sqlite3.h) is exactly the recorded floor', () => {
    const header = join(repoRoot, 'rolonative', 'node_modules', 'react-native-quick-sqlite', 'cpp', 'sqlite3.h')
    const src = readFileSync(header, 'utf8')
    const m = src.match(/^#define\s+SQLITE_VERSION\s+"([^"]+)"/m)
    expect(m, `${header} has no SQLITE_VERSION macro`).not.toBeNull()
    if (!m) return
    expect(m[1]).toBe(SQLITE_MIN_VERSION)
    expect(SQLITE_MIN_VERSION).toBe('3.39.4')
  })
})