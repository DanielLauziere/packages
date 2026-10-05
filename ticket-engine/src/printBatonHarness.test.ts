import { describe, it, expect } from 'vitest'
import {
  PRINT_ALERT_MS,
  foldPrintBaton,
  decidePrint,
  PrintRow,
  PrintFold,
} from './printProtocol.js'

// ---------------------------------------------------------------------------
// Fleet-simulation harness: N fake devices, fake clock, partitions, crashes,
// a fake printer counting physical prints. Every device runs the production
// decision function (decidePrint). Invariants I1–I4 per
// docs/CORE-LOGIC-PRINT-LOGIC.md "Proof strategy"; scenarios are Appendix A.
// ---------------------------------------------------------------------------

const A = 'admin-a'
const B = 'admin-b'
const C = 'admin-c'
const D = 'admin-d'
const SERVER = null

interface HarnessDevice {
  id: string | null
  capable: boolean
  broken: boolean
  crashed: boolean
  prints: number
  sends: { held: boolean; manual?: boolean }[]
  requestedAt: number | null
  alertShown: boolean
}

interface World {
  devices: HarnessDevice[]
  rows: PrintRow[]
  view: Map<string | null, number>
  hold: Set<string | null>
  creator: string | null
  now: number
  humanPresses: number
}

let seq = 0
function makeRow(action: string, author: string | null, payload?: any): PrintRow {
  seq++
  return { action, author, time_stamp: seq, payload: payload ?? {} }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function device(id: string | null, opts: Partial<HarnessDevice> = {}): HarnessDevice {
  return {
    id,
    capable: opts.capable ?? false,
    broken: opts.broken ?? false,
    crashed: opts.crashed ?? false,
    prints: 0,
    sends: [],
    requestedAt: null,
    alertShown: false,
  }
}

function world(devices: HarnessDevice[], creator: string | null, rows: PrintRow[] = []): World {
  const w: World = {
    devices,
    rows: [...rows],
    view: new Map(),
    hold: new Set(),
    creator,
    now: 1_000_000,
    humanPresses: 0,
  }
  for (const d of devices) w.view.set(d.id, rows.length)
  return w
}

function append(w: World, action: string, author: string | null, payload?: any): void {
  w.rows.push(makeRow(action, author, payload))
  for (const d of w.devices) {
    if (!d.crashed && !w.hold.has(d.id)) w.view.set(d.id, w.rows.length)
  }
}

function view(w: World, id: string | null): PrintRow[] {
  return w.rows.slice(0, w.view.get(id) ?? 0)
}

function foldOf(w: World, id: string | null): PrintFold {
  return foldPrintBaton(view(w, id), w.creator)
}

function dev(w: World, id: string | null): HarnessDevice {
  return w.devices.find((d) => d.id === id)!
}

// One deterministic step for one device: run the real decision function and
// apply its effect. Returns the decision kind (assertable in narratives).
function step(w: World, id: string | null): string {
  const d = dev(w, id)
  if (d.crashed) return 'crashed'
  const fold = foldOf(w, id)
  const decision = decidePrint(fold, {
    me: id,
    capable: d.capable,
    now: w.now,
    requestedAt: d.requestedAt,
  })
  switch (decision.kind) {
    case 'send':
      if (d.broken) {
        d.capable = false
        break
      }
      d.prints++
      d.sends.push({ held: fold.holder === id })
      append(w, 'PRINT_SUCCESS', id, {})
      break
    case 'pass':
      append(w, 'PRINT_PASS', id, {})
      break
    case 'request':
      d.requestedAt = w.now
      append(w, 'PRINT_REQUEST', id, {})
      break
    case 'reassign':
      append(w, 'PRINT_REASSIGN', id, { to: decision.to })
      break
    case 'alert':
      d.alertShown = true
      w.humanPresses++
      if (!d.broken) {
        d.prints++
        d.sends.push({ held: false, manual: true })
        append(w, 'PRINT_SUCCESS', id, { manual: true })
      }
      break
    default:
      break
  }
  return decision.kind
}

function deliverAll(w: World): void {
  w.hold.clear()
  for (const d of w.devices) w.view.set(d.id, w.rows.length)
}

function shuffledRound(w: World, rng: () => number): boolean {
  const order = w.devices.filter((d) => !d.crashed).map((d) => d.id)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  let acted = false
  for (const id of order) {
    const before = w.rows.length
    const beforePrints = w.devices.reduce((n, d) => n + d.prints, 0)
    step(w, id)
    if (w.rows.length !== before || w.devices.reduce((n, d) => n + d.prints, 0) > beforePrints) {
      acted = true
    }
  }
  w.now += 1000
  return acted
}

function run(w: World, rng: () => number, opts: { rounds?: number } = {}): void {
  const max = opts.rounds ?? 400
  let idle = 0
  for (let i = 0; i < max && idle < 3; i++) {
    const acted = shuffledRound(w, rng)
    idle = acted ? 0 : idle + 1
    if (i % 10 === 9) deliverAll(w)
  }
  deliverAll(w)
  for (let i = 0; i < 10; i++) shuffledRound(w, rng)
}

function fullFold(w: World): PrintFold {
  return foldPrintBaton(w.rows, w.creator)
}

function totalPrints(w: World): number {
  return w.devices.reduce((n, d) => n + d.prints, 0)
}

function expectI3(w: World): void {
  for (const d of w.devices) {
    for (const s of d.sends) {
      if (s.manual) continue
      expect(s.held, `device ${d.id} opened a send without holding the baton`).toBe(true)
    }
  }
}

function expectI1LoudOrPrinted(w: World): void {
  const fold = fullFold(w)
  const anyAlert = w.devices.some((d) => d.alertShown)
  const loud =
    fold.state === 'printed' ||
    fold.state === 'conflict' ||
    fold.state === 'solicit' ||
    anyAlert
  expect(
    loud,
    `state=${fold.state} chain=${JSON.stringify(fold.chain)} conflict=${JSON.stringify(fold.conflict)}`,
  ).toBe(true)
}

// ---------------------------------------------------------------------------

describe('Appendix A — every print flow', () => {
  it('row 1: capable creator prints instantly, zero other rows until SUCCESS', () => {
    const w = world([device(A, { capable: true }), device(B, { capable: true })], A)
    run(w, mulberry32(1))
    expect(totalPrints(w)).toBe(1)
    expect(w.rows).toHaveLength(1)
    expect(w.rows[0]!.action).toBe('PRINT_SUCCESS')
    expect(fullFold(w).state).toBe('printed')
    expect(w.devices.every((d) => d.sends.length <= 1)).toBe(true)
    expectI3(w)
  })

  it('row 2: creator capable, peers offline — SUCCESS rides the next delivery', () => {
    const w = world([device(A, { capable: true }), device(SERVER, { capable: false })], A)
    w.hold.add(SERVER)
    const rng = mulberry32(2)
    for (let i = 0; i < 5; i++) shuffledRound(w, rng)
    expect(totalPrints(w)).toBe(1)
    expect(view(w, SERVER)).toHaveLength(0)
    deliverAll(w)
    run(w, rng)
    expect(totalPrints(w)).toBe(1)
    expect(fullFold(w).state).toBe('printed')
    expect(dev(w, SERVER).sends).toHaveLength(0)
  })

  it('row 3: broken creator → PASS → B,C REQUEST → REASSIGN{first seen} → successor prints', () => {
    const w = world(
      [
        device(A, { capable: true, broken: true }),
        device(B, { capable: true }),
        device(C, { capable: true }),
      ],
      A,
    )
    expect(step(w, A)).toBe('send') // refused → capability flips off
    expect(step(w, A)).toBe('pass')
    expect(step(w, C)).toBe('request')
    expect(step(w, B)).toBe('request')
    expect(step(w, A)).toBe('reassign') // first request seen: C
    expect(step(w, C)).toBe('send')
    const fold = fullFold(w)
    expect(totalPrints(w)).toBe(1)
    expect(fold.state).toBe('printed')
    expect(fold.chain).toEqual([A, C])
    expect(fold.reassignAuthors).toEqual([A])
    expectI3(w)
    // B stands down on terminal
    expect(step(w, B)).toBe('stand-down')
  })

  it('row 4: creator silent-off, no capable devices → solicit open, loud, zero prints', () => {
    const w = world([device(A, { capable: false }), device(B, { capable: false })], A)
    run(w, mulberry32(4))
    const fold = fullFold(w)
    expect(totalPrints(w)).toBe(0)
    expect(fold.state).toBe('solicit')
    expect(fold.requests).toHaveLength(0)
    expectI1LoudOrPrinted(w)
  })

  it('row 5: chain hop — reassigned C also broken → reannounce → REASSIGN{B} → B prints', () => {
    const w = world(
      [
        device(A, { capable: false }),
        device(B, { capable: true }),
        device(C, { capable: true, broken: true }),
      ],
      A,
    )
    expect(step(w, A)).toBe('pass')
    expect(step(w, C)).toBe('request')
    expect(step(w, B)).toBe('request')
    expect(step(w, A)).toBe('reassign') // first seen: C
    expect(step(w, C)).toBe('send') // refused → flips off
    expect(step(w, C)).toBe('pass') // holder re-announces (decider seat)
    expect(step(w, C)).toBe('reassign') // skips its own backlog request → B
    expect(step(w, B)).toBe('send')
    const fold = fullFold(w)
    expect(totalPrints(w)).toBe(1)
    expect(fold.state).toBe('printed')
    expect(fold.chain).toEqual([A, C, B])
    expect(fold.reassignAuthors).toEqual([A, C])
    expectI3(w)
  })

  it('row 6: holder dies before reassigning → waiter alerts after 60 s → manual takeover prints', () => {
    const w = world([device(A, { capable: false }), device(B, { capable: true })], A)
    expect(step(w, A)).toBe('pass')
    expect(step(w, B)).toBe('request')
    dev(w, A).crashed = true
    w.now = dev(w, B).requestedAt! + PRINT_ALERT_MS
    expect(step(w, B)).toBe('alert')
    expect(w.humanPresses).toBe(1)
    expect(totalPrints(w)).toBe(1)
    expect(fullFold(w).state).toBe('printed')
    expect(w.rows.some((r) => r.payload?.manual === true)).toBe(true)
    // holder returns → sees SUCCESS → stands down, never prints
    dev(w, A).crashed = false
    deliverAll(w)
    expect(step(w, A)).toBe('stand-down')
    expect(totalPrints(w)).toBe(1)
    expectI3(w)
  })

  it('row 7: reassigned target dead → capable waiter prints directly (never a second holder)', () => {
    const w = world(
      [
        device(A, { capable: false }),
        device(B, { capable: true, crashed: true }),
        device(C, { capable: true }),
      ],
      A,
    )
    expect(step(w, A)).toBe('pass')
    expect(step(w, C)).toBe('request')
    expect(step(w, A)).toBe('reassign') // only request seen: C
    expect(step(w, C)).toBe('send')
    expect(totalPrints(w)).toBe(1)
    expect(fullFold(w).state).toBe('printed')
    // dead target never acted; reviving it changes nothing
    dev(w, B).crashed = false
    deliverAll(w)
    expect(step(w, B)).toBe('stand-down')
    expectI3(w)
  })

  it('limit 3: strand with no waiter left — waits visibly, nobody auto-prints', () => {
    const w = world(
      [device(A, { capable: false }), device(B, { capable: true, crashed: true })],
      A,
    )
    expect(step(w, A)).toBe('pass')
    // nobody capable is alive to request → A waits as decider
    expect(step(w, A)).toBe('wait')
    // B revives, requests, gets reassigned to, then dies again before printing
    dev(w, B).crashed = false
    deliverAll(w)
    expect(step(w, B)).toBe('request')
    expect(step(w, A)).toBe('reassign')
    dev(w, B).crashed = true
    w.now = dev(w, B).requestedAt! + PRINT_ALERT_MS
    // B is the holder and crashed mid-flight; A is out; no waiter remains.
    expect(step(w, A)).toBe('stand-down')
    expect(totalPrints(w)).toBe(0)
    expect(fullFold(w).chain).toEqual([A, B])
    expect(fullFold(w).state).toBe('assigned')
  })

  it('row 8: guest ticket (server = A) → server PASS → first REQUEST → REASSIGN → prints', () => {
    const w = world(
      [device(SERVER, { capable: false }), device(B, { capable: true }), device(C, { capable: true })],
      SERVER,
    )
    expect(step(w, SERVER)).toBe('pass')
    expect(step(w, B)).toBe('request')
    expect(step(w, C)).toBe('request')
    expect(step(w, SERVER)).toBe('reassign') // first seen: B
    expect(step(w, B)).toBe('send')
    const fold = fullFold(w)
    expect(totalPrints(w)).toBe(1)
    expect(fold.state).toBe('printed')
    expect(fold.chain).toEqual([SERVER, B])
    expect(fold.reassignAuthors).toEqual([SERVER])
    expectI3(w)
  })

  it('row 9: guest, server down before reassign → strand → waiter alert → manual takeover', () => {
    const w = world([device(SERVER, { capable: false }), device(B, { capable: true })], SERVER)
    expect(step(w, SERVER)).toBe('pass')
    expect(step(w, B)).toBe('request')
    dev(w, SERVER).crashed = true
    w.now = dev(w, B).requestedAt! + PRINT_ALERT_MS
    expect(step(w, B)).toBe('alert')
    expect(totalPrints(w)).toBe(1)
    expect(fullFold(w).state).toBe('printed')
    expectI3(w)
  })

  it('row 10: guest, no capable devices → zero auto prints, solicit loud', () => {
    const w = world([device(SERVER, { capable: false }), device(B, { capable: false })], SERVER)
    run(w, mulberry32(10))
    const fold = fullFold(w)
    expect(totalPrints(w)).toBe(0)
    expect(fold.state).toBe('solicit')
    expectI1LoudOrPrinted(w)
  })

  it('row 11: relay (web) behaves like any capable device over the same chains', () => {
    const w = world(
      [
        device(A, { capable: true, broken: true }),
        device(B, { capable: true }),
        device(C, { capable: true }),
      ],
      A,
    )
    run(w, mulberry32(11))
    expect(totalPrints(w)).toBe(1)
    expect(fullFold(w).state).toBe('printed')
    expect(fullFold(w).chain[0]).toBe(A)
    expect(fullFold(w).chain).toHaveLength(2)
    expectI3(w)
  })

  it('row 12: deep serial queue — no solicit, no false alerts while the holder is busy', () => {
    const w = world([device(A, { capable: true }), device(B, { capable: true })], A)
    for (let i = 0; i < 120; i++) {
      w.now += 1000
      expect(foldOf(w, B).state).toBe('open')
      expect(decidePrint(foldOf(w, B), { me: B, capable: true, now: w.now }).kind).toBe('wait')
      expect(dev(w, B).requestedAt).toBeNull()
      expect(dev(w, B).alertShown).toBe(false)
    }
    run(w, mulberry32(12))
    expect(totalPrints(w)).toBe(1)
    expect(w.rows.filter((r) => r.action === 'PRINT_PASS')).toHaveLength(0)
    expect(fullFold(w).state).toBe('printed')
  })
})

describe('Q1 — crash between bytes-sent and SUCCESS write (auto-resend policy)', () => {
  it('holder crashes after printing, before SUCCESS → revives → resends → counted double', () => {
    const w = world([device(A, { capable: true }), device(B, { capable: true })], A)
    const a = dev(w, A)
    a.prints++
    a.sends.push({ held: true })
    a.crashed = true
    expect(w.rows).toHaveLength(0)
    a.crashed = false
    run(w, mulberry32(21))
    expect(a.prints).toBe(2) // Q1: rare duplicate, counted by design
    expect(fullFold(w).state).toBe('printed')
    expectI3(w)
  })

  it('limit-4 gap: creator dies before any print row → nobody auto-prints', () => {
    const w = world([device(A, { capable: true }), device(B, { capable: true })], A)
    dev(w, A).crashed = true
    run(w, mulberry32(22))
    expect(totalPrints(w)).toBe(0)
    expect(w.rows).toHaveLength(0)
    const foldB = fullFold(w)
    expect(foldB.state).toBe('open')
    // safety holds; liveness is the ops-facing attention list (doc limit 4)
    expect(decidePrint(foldB, { me: B, capable: true, now: w.now }).kind).toBe('wait')
  })
})

describe('I4 — permutation / batching / delivery-schedule invariance', () => {
  const script = (): PrintRow[] => [
    makeRow('PRINT_PASS', A),
    makeRow('PRINT_REQUEST', B),
    makeRow('PRINT_REQUEST', C),
    makeRow('PRINT_REASSIGN', A, { to: C }),
    makeRow('PRINT_SUCCESS', C),
  ]

  it('any delivery schedule folds to the identical chain on every replica', () => {
    const schedules = [
      [1, 2, 3, 4, 5],
      [5, 4, 3, 2, 1],
      [3, 1, 5, 2, 4],
      [2, 2, 4, 5, 5],
      [1, 1, 1, 1, 5],
    ]
    for (const sched of schedules) {
      const rows = script()
      const w = world([device(A), device(B), device(C)], A, rows)
      w.view.set(A, 0)
      w.view.set(B, 0)
      w.view.set(C, 0)
      for (const upTo of sched) {
        w.view.set(A, upTo)
        w.view.set(B, Math.max(1, upTo - 1))
        w.view.set(C, 5)
        expect(foldOf(w, A).chain[0]).toBe(A)
      }
      deliverAll(w)
      for (const id of [A, B, C]) {
        const f = foldOf(w, id)
        expect(f.state).toBe('printed')
        expect(f.holder).toBe(C)
        expect(f.chain).toEqual([A, C])
        expect(f.terminal).toBe(true)
        expect(f.conflict).toEqual([])
      }
    }
  })

  it('reversed row order over the same set folds identically', () => {
    const rows = script()
    for (const order of [rows, [...rows].reverse()]) {
      const f = foldPrintBaton(order, A)
      expect(f.state).toBe('printed')
      expect(f.holder).toBe(C)
      expect(f.chain).toEqual([A, C])
      expect(f.decider).toBe(false)
      expect(f.conflict).toEqual([])
    }
  })
})

describe('randomized interleavings (seeded) — I1/I2/I3', () => {
  it('100 random fleets: one print or a loud state, never a double print', () => {
    const ids = [A, B, C, D]
    for (let seed = 1; seed <= 100; seed++) {
      const rng = mulberry32(seed)
      const n = 2 + Math.floor(rng() * 3)
      const chosen = ids.slice(0, n)
      const devices = chosen.map((id) =>
        device(id, { capable: rng() < 0.7, broken: rng() < 0.2 }),
      )
      if (!devices.some((d) => d.capable && !d.broken)) {
        devices[0]!.capable = true
        devices[0]!.broken = false
      }
      const creator = chosen[Math.floor(rng() * chosen.length)]!
      const w = world(devices, creator)
      run(w, rng, { rounds: 250 })
      try {
        expectI1LoudOrPrinted(w)
        expectI3(w)
        expect(totalPrints(w), `seed ${seed} physical prints`).toBeLessThanOrEqual(1)
      } catch (e) {
        throw new Error(`${(e as Error).message} [seed ${seed}]`)
      }
    }
  })
})
