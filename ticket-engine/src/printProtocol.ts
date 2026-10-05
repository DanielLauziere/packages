export const PRINT_SUCCESS = 'PRINT_SUCCESS'
export const PRINT_PASS = 'PRINT_PASS'
export const PRINT_REQUEST = 'PRINT_REQUEST'
export const PRINT_REASSIGN = 'PRINT_REASSIGN'

export const PRINT_ACTIONS = [PRINT_SUCCESS, PRINT_PASS, PRINT_REQUEST, PRINT_REASSIGN] as const

export type PrintAction = (typeof PRINT_ACTIONS)[number]

const PRINT_ACTION_SET: ReadonlySet<string> = new Set(PRINT_ACTIONS)

export const PRINT_ALERT_MS = 60000

export type PrintFoldState = 'open' | 'solicit' | 'assigned' | 'printed' | 'conflict'

export interface PrintRow {
  action: string
  author: string | null
  time_stamp: number
  payload?: any
}

export interface PrintFold {
  state: PrintFoldState
  holder: string | null
  decider: boolean
  terminal: boolean
  conflict: string[]
  chain: (string | null)[]
  requests: (string | null)[]
  passAuthors: (string | null)[]
  reassignAuthors: (string | null)[]
}

function pushByAuthor(map: Map<string | null, PrintRow[]>, author: string | null, row: PrintRow): void {
  const list = map.get(author)
  if (list) list.push(row)
  else map.set(author, [row])
}

export function foldPrintBaton(rows: PrintRow[], creator: string | null): PrintFold {
  const conflicts: string[] = []
  const reassignsBy = new Map<string | null, PrintRow[]>()
  const passesBy = new Map<string | null, PrintRow[]>()
  const requests: (string | null)[] = []
  const passAuthors: (string | null)[] = []
  const reassignAuthors: (string | null)[] = []
  const successes: PrintRow[] = []

  for (const row of rows) {
    if (!PRINT_ACTION_SET.has(row.action)) continue
    const author = row.author ?? null
    switch (row.action) {
      case PRINT_PASS:
        pushByAuthor(passesBy, author, row)
        if (!passAuthors.includes(author)) passAuthors.push(author)
        break
      case PRINT_REASSIGN:
        pushByAuthor(reassignsBy, author, row)
        if (!reassignAuthors.includes(author)) reassignAuthors.push(author)
        break
      case PRINT_REQUEST:
        if (!requests.includes(author)) requests.push(author)
        break
      case PRINT_SUCCESS:
        successes.push(row)
        break
    }
  }

  const chain: (string | null)[] = [creator]
  const visited = new Set<string | null>([creator])
  let current = creator
  let walking = true
  while (walking) {
    walking = false
    const owned = reassignsBy.get(current) ?? []
    if (owned.length > 1) {
      conflicts.push('MULTIPLE_REASSIGN')
      break
    }
    if (owned.length === 1) {
      const reassign = owned[0]
      const passes = passesBy.get(current) ?? []
      const hasOpenPass = passes.some((p) => p.time_stamp <= reassign.time_stamp)
      if (!hasOpenPass) {
        conflicts.push('REASSIGN_WITHOUT_PASS')
        break
      }
      const to = reassign.payload?.to
      if (typeof to !== 'string' || !to) {
        conflicts.push('REASSIGN_WITHOUT_TARGET')
        break
      }
      if (visited.has(to)) {
        conflicts.push('REASSIGN_CYCLE')
        break
      }
      visited.add(to)
      chain.push(to)
      current = to
      walking = true
    }
  }

  for (const [author, passes] of passesBy) {
    if (!visited.has(author)) {
      conflicts.push('PASS_FROM_NON_HOLDER')
      continue
    }
    const owned = reassignsBy.get(author) ?? []
    if (owned.length === 1 && passes.some((p) => p.time_stamp > owned[0].time_stamp)) {
      conflicts.push('PASS_AFTER_REASSIGN')
    }
  }

  for (const [author] of reassignsBy) {
    if (!visited.has(author)) conflicts.push('REASSIGN_FROM_NON_HOLDER')
  }

  const manual = successes.filter((s) => s.payload?.manual === true)
  const auto = successes.filter((s) => s.payload?.manual !== true)
  for (const s of auto) {
    if ((s.author ?? null) !== current) conflicts.push('AUTO_SUCCESS_FROM_NON_HOLDER')
  }

  const holderPasses = passesBy.get(current) ?? []
  const holderReassigns = reassignsBy.get(current) ?? []
  const openPass = holderPasses.some(
    (p) => holderReassigns.length === 0 || p.time_stamp <= holderReassigns[0].time_stamp,
  )
  const decider = openPass && holderReassigns.length === 0

  const terminal = successes.length > 0

  let state: PrintFoldState
  if (manual.length > 0) state = 'printed'
  else if (conflicts.length > 0) state = 'conflict'
  else if (terminal) state = 'printed'
  else if (openPass) state = 'solicit'
  else if (chain.length > 1) state = 'assigned'
  else state = 'open'

  return {
    state,
    holder: current,
    decider,
    terminal,
    conflict: conflicts,
    chain,
    requests,
    passAuthors,
    reassignAuthors,
  }
}

export interface PrintDeviceContext {
  me: string | null
  capable: boolean
  now: number
  requestedAt?: number | null
}

export type PrintDecision =
  | { kind: 'send' }
  | { kind: 'pass'; reason?: string }
  | { kind: 'request' }
  | { kind: 'reassign'; to: string }
  | { kind: 'alert' }
  | { kind: 'attention' }
  | { kind: 'stand-down' }
  | { kind: 'wait' }

export function decidePrint(fold: PrintFold, ctx: PrintDeviceContext): PrintDecision {
  const { me, capable, now } = ctx

  if (fold.terminal) return { kind: 'stand-down' }
  if (fold.state === 'conflict') return { kind: 'attention' }
  if (fold.reassignAuthors.includes(me)) return { kind: 'stand-down' }

  if (fold.holder === me) {
    if (capable) return { kind: 'send' }
    if (!fold.passAuthors.includes(me)) return { kind: 'pass' }
    if (fold.decider) {
      const to = fold.requests.find((r) => r !== null && r !== me)
      if (to) return { kind: 'reassign', to }
    }
    return { kind: 'wait' }
  }

  if (capable && fold.state === 'solicit' && !fold.requests.includes(me)) {
    return { kind: 'request' }
  }

  if (
    fold.requests.includes(me) &&
    !fold.terminal &&
    fold.holder !== me &&
    ctx.requestedAt != null &&
    now - ctx.requestedAt >= PRINT_ALERT_MS
  ) {
    return { kind: 'alert' }
  }

  return { kind: 'wait' }
}

export function manualTakeoverAllowed(fold: PrintFold): boolean {
  return !fold.terminal
}
