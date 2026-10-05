import { describe, it, expect } from 'vitest'
import {
  PRINT_ALERT_MS,
  foldPrintBaton,
  decidePrint,
  manualTakeoverAllowed,
  PrintRow,
} from './printProtocol.js'

const A = 'admin-a'
const B = 'admin-b'
const C = 'admin-c'
const D = 'admin-d'

let seq = 0
function row(action: string, author: string | null, time_stamp: number, payload?: any): PrintRow {
  seq++
  return { action, author, time_stamp, payload: payload ?? {} }
}

function permute<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items]
  const out: T[][] = []
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const p of permute(rest)) out.push([items[i], ...p])
  }
  return out
}

describe('foldPrintBaton — states', () => {
  it('empty rows: open, creator is implicit holder, not terminal', () => {
    const fold = foldPrintBaton([], A)
    expect(fold.state).toBe('open')
    expect(fold.holder).toBe(A)
    expect(fold.terminal).toBe(false)
    expect(fold.decider).toBe(false)
    expect(fold.conflict).toEqual([])
    expect(fold.chain).toEqual([A])
  })

  it('scenario 1: creator prints → printed, zero other rows needed', () => {
    const rows = [row('PRINT_SUCCESS', A, 1000, {})]
    const fold = foldPrintBaton(rows, A)
    expect(fold.state).toBe('printed')
    expect(fold.terminal).toBe(true)
    expect(fold.conflict).toEqual([])
  })

  it('holder pass → solicit, holder is decider', () => {
    const rows = [row('PRINT_PASS', A, 1000)]
    const fold = foldPrintBaton(rows, A)
    expect(fold.state).toBe('solicit')
    expect(fold.holder).toBe(A)
    expect(fold.decider).toBe(true)
  })

  it('reassign moves the chain; new holder without pass → assigned', () => {
    const rows = [
      row('PRINT_PASS', A, 1000),
      row('PRINT_REQUEST', B, 1100),
      row('PRINT_REQUEST', C, 1200),
      row('PRINT_REASSIGN', A, 1300, { to: C }),
    ]
    const fold = foldPrintBaton(rows, A)
    expect(fold.state).toBe('assigned')
    expect(fold.holder).toBe(C)
    expect(fold.chain).toEqual([A, C])
    expect(fold.decider).toBe(false)
    expect(fold.requests).toEqual([B, C])
    expect(fold.conflict).toEqual([])
  })

  it('chain hop: A→C→B folds through both reassigns', () => {
    const rows = [
      row('PRINT_PASS', A, 1000),
      row('PRINT_REQUEST', B, 1050),
      row('PRINT_REASSIGN', A, 1100, { to: C }),
      row('PRINT_PASS', C, 1200),
      row('PRINT_REASSIGN', C, 1300, { to: B }),
    ]
    const fold = foldPrintBaton(rows, A)
    expect(fold.holder).toBe(B)
    expect(fold.chain).toEqual([A, C, B])
    expect(fold.state).toBe('assigned')
    expect(fold.conflict).toEqual([])
  })

  it('reassigned target that passes → solicit again', () => {
    const rows = [
      row('PRINT_PASS', A, 1000),
      row('PRINT_REQUEST', B, 1100),
      row('PRINT_REASSIGN', A, 1200, { to: B }),
      row('PRINT_PASS', B, 1300),
    ]
    const fold = foldPrintBaton(rows, A)
    expect(fold.state).toBe('solicit')
    expect(fold.holder).toBe(B)
    expect(fold.decider).toBe(true)
  })

  it('server-as-A: null creator + null author behaves like any holder', () => {
    const rows = [row('PRINT_PASS', null, 1000)]
    const fold = foldPrintBaton(rows, null)
    expect(fold.state).toBe('solicit')
    expect(fold.holder).toBe(null)
    expect(fold.decider).toBe(true)

    const moved = foldPrintBaton(
      [...rows, row('PRINT_REQUEST', B, 1100), row('PRINT_REASSIGN', null, 1200, { to: B })],
      null,
    )
    expect(moved.holder).toBe(B)
    expect(moved.chain).toEqual([null, B])
    expect(moved.conflict).toEqual([])
  })

  it('duplicate requests by one device are deduped', () => {
    const rows = [
      row('PRINT_PASS', A, 1000),
      row('PRINT_REQUEST', B, 1100),
      row('PRINT_REQUEST', B, 1150),
    ]
    expect(foldPrintBaton(rows, A).requests).toEqual([B])
  })

  it('non-print actions are ignored', () => {
    const rows = [row('ADD_ITEM', B, 900), row('PRINT_SUCCESS', A, 1000)]
    const fold = foldPrintBaton(rows, A)
    expect(fold.state).toBe('printed')
    expect(fold.conflict).toEqual([])
  })
})

describe('foldPrintBaton — validation rules', () => {
  it('rule 1: PASS from a non-holder → conflict', () => {
    const rows = [row('PRINT_PASS', D, 1000)]
    const fold = foldPrintBaton(rows, A)
    expect(fold.state).toBe('conflict')
    expect(fold.conflict).toContain('PASS_FROM_NON_HOLDER')
  })

  it('rule 1: PASS after the author reassigned away → conflict', () => {
    const rows = [
      row('PRINT_PASS', A, 1000),
      row('PRINT_REASSIGN', A, 1100, { to: B }),
      row('PRINT_PASS', A, 1200),
    ]
    const fold = foldPrintBaton(rows, A)
    expect(fold.state).toBe('conflict')
    expect(fold.conflict).toContain('PASS_AFTER_REASSIGN')
  })

  it('rule 2: two reassigns from one seat → conflict', () => {
    const rows = [
      row('PRINT_PASS', A, 1000),
      row('PRINT_REASSIGN', A, 1100, { to: B }),
      row('PRINT_REASSIGN', A, 1200, { to: C }),
    ]
    const fold = foldPrintBaton(rows, A)
    expect(fold.state).toBe('conflict')
    expect(fold.conflict).toContain('MULTIPLE_REASSIGN')
  })

  it('rule 2: reassign without an announce → conflict', () => {
    const rows = [row('PRINT_REASSIGN', A, 1100, { to: B })]
    const fold = foldPrintBaton(rows, A)
    expect(fold.state).toBe('conflict')
    expect(fold.conflict).toContain('REASSIGN_WITHOUT_PASS')
  })

  it('rule 2: reassign from a non-holder → conflict', () => {
    const rows = [
      row('PRINT_PASS', D, 1000),
      row('PRINT_REASSIGN', D, 1100, { to: B }),
    ]
    const fold = foldPrintBaton(rows, A)
    expect(fold.state).toBe('conflict')
    expect(fold.conflict).toContain('PASS_FROM_NON_HOLDER')
    expect(fold.conflict).toContain('REASSIGN_FROM_NON_HOLDER')
  })

  it('rule 2: reassign without target payload → conflict', () => {
    const rows = [
      row('PRINT_PASS', A, 1000),
      row('PRINT_REASSIGN', A, 1100, {}),
    ]
    const fold = foldPrintBaton(rows, A)
    expect(fold.state).toBe('conflict')
    expect(fold.conflict).toContain('REASSIGN_WITHOUT_TARGET')
  })

  it('rule 2: reassign cycle → conflict', () => {
    const rows = [
      row('PRINT_PASS', A, 1000),
      row('PRINT_REASSIGN', A, 1100, { to: B }),
      row('PRINT_PASS', B, 1200),
      row('PRINT_REASSIGN', B, 1300, { to: A }),
    ]
    const fold = foldPrintBaton(rows, A)
    expect(fold.state).toBe('conflict')
    expect(fold.conflict).toContain('REASSIGN_CYCLE')
  })

  it('rule 3: auto SUCCESS from a non-holder → conflict', () => {
    const rows = [
      row('PRINT_PASS', A, 1000),
      row('PRINT_REASSIGN', A, 1100, { to: B }),
      row('PRINT_SUCCESS', A, 1200, {}),
    ]
    const fold = foldPrintBaton(rows, A)
    expect(fold.state).toBe('conflict')
    expect(fold.conflict).toContain('AUTO_SUCCESS_FROM_NON_HOLDER')
  })

  it('rule 3: manual SUCCESS from anyone is valid → printed', () => {
    const rows = [row('PRINT_SUCCESS', D, 1000, { manual: true })]
    const fold = foldPrintBaton(rows, A)
    expect(fold.state).toBe('printed')
    expect(fold.conflict).toEqual([])
  })

  it('manual SUCCESS resolves an otherwise conflicted fold', () => {
    const rows = [
      row('PRINT_PASS', D, 1000),
      row('PRINT_SUCCESS', D, 1400, { manual: true }),
    ]
    const fold = foldPrintBaton(rows, A)
    expect(fold.state).toBe('printed')
  })

  it('pass and reassign at the same ms from the same author is not a conflict', () => {
    const rows = [
      row('PRINT_PASS', A, 1000),
      row('PRINT_REASSIGN', A, 1000, { to: B }),
    ]
    const fold = foldPrintBaton(rows, A)
    expect(fold.state).toBe('assigned')
    expect(fold.holder).toBe(B)
    expect(fold.conflict).toEqual([])
  })

  it('adversarial clock skew across authors never changes the chain', () => {
    const base = [
      row('PRINT_PASS', A, 5000),
      row('PRINT_REQUEST', B, 100),
      row('PRINT_REASSIGN', A, 6000, { to: C }),
      row('PRINT_SUCCESS', C, 10, {}),
    ]
    const skews = permute([0, -99999, 99999, 12345])
    for (const [sa, sb, sc] of skews) {
      const rows = base.map((r) => ({
        ...r,
        time_stamp:
          r.time_stamp +
          (r.author === A ? sa : r.author === B ? sb : sc),
      }))
      const fold = foldPrintBaton(rows, A)
      expect(fold.holder).toBe(C)
      expect(fold.terminal).toBe(true)
      expect(fold.state).toBe('printed')
      expect(fold.conflict).toEqual([])
    }
  })
})

describe('foldPrintBaton — I4 permutation invariance', () => {
  it('every permutation of the scenario-2 row set folds identically', () => {
    const rows = [
      row('PRINT_PASS', A, 1000),
      row('PRINT_REQUEST', B, 1100),
      row('PRINT_REQUEST', C, 1200),
      row('PRINT_REASSIGN', A, 1300, { to: C }),
      row('PRINT_SUCCESS', C, 1400, {}),
    ]
    const results = permute(rows).map((p) => {
      const f = foldPrintBaton(p, A)
      return {
        state: f.state,
        holder: f.holder,
        decider: f.decider,
        terminal: f.terminal,
        conflict: f.conflict,
        chain: f.chain,
      }
    })
    const first = JSON.stringify(results[0])
    for (const r of results) expect(JSON.stringify(r)).toBe(first)
    expect(results[0].state).toBe('printed')
    expect(results[0].holder).toBe(C)
    expect(results[0].chain).toEqual([A, C])
  })

  it('batching (partial row sets) converges to the same final fold', () => {
    const rows = [
      row('PRINT_PASS', A, 1000),
      row('PRINT_REQUEST', B, 1100),
      row('PRINT_REASSIGN', A, 1200, { to: B }),
      row('PRINT_PASS', B, 1300),
      row('PRINT_SUCCESS', B, 1400, {}),
    ]
    const full = foldPrintBaton(rows, A)
    const prefixes = rows.map((_, i) => foldPrintBaton(rows.slice(0, i + 1), A))
    expect(prefixes[prefixes.length - 1]).toEqual(full)
    expect(full.state).toBe('printed')
    expect(full.holder).toBe(B)
  })
})

describe('decidePrint — guards', () => {
  const base = { now: 1000000 }

  it('terminal → stand-down for everyone, holder included', () => {
    const fold = foldPrintBaton([row('PRINT_SUCCESS', A, 10, {})], A)
    expect(decidePrint(fold, { ...base, me: A, capable: true }).kind).toBe('stand-down')
    expect(decidePrint(fold, { ...base, me: B, capable: true }).kind).toBe('stand-down')
  })

  it('conflict → attention for everyone, holder included', () => {
    const fold = foldPrintBaton([row('PRINT_PASS', D, 10)], A)
    expect(fold.state).toBe('conflict')
    expect(decidePrint(fold, { ...base, me: A, capable: true }).kind).toBe('attention')
    expect(decidePrint(fold, { ...base, me: D, capable: true }).kind).toBe('attention')
  })

  it('only the holder sends', () => {
    const fold = foldPrintBaton([row('PRINT_PASS', A, 10)], A)
    expect(decidePrint(fold, { ...base, me: A, capable: true }).kind).toBe('send')
    expect(decidePrint(fold, { ...base, me: B, capable: true }).kind).toBe('request')
    expect(decidePrint(fold, { ...base, me: C, capable: false }).kind).toBe('wait')
  })

  it('holder announces once when not capable', () => {
    const fold = foldPrintBaton([], A)
    expect(decidePrint(fold, { ...base, me: A, capable: false })).toEqual({ kind: 'pass' })
  })

  it('holder that announced and sees requests reassigns to the first one seen', () => {
    const fold = foldPrintBaton(
      [
        row('PRINT_PASS', A, 10),
        row('PRINT_REQUEST', C, 20),
        row('PRINT_REQUEST', B, 30),
      ],
      A,
    )
    expect(fold.decider).toBe(true)
    expect(decidePrint(fold, { ...base, me: A, capable: false })).toEqual({
      kind: 'reassign',
      to: C,
    })
  })

  it('holder that announced with no requests waits (solicit stays open)', () => {
    const fold = foldPrintBaton([row('PRINT_PASS', A, 10)], A)
    expect(decidePrint(fold, { ...base, me: A, capable: false }).kind).toBe('wait')
  })

  it('holder may still print itself after announcing (printer came back)', () => {
    const fold = foldPrintBaton([row('PRINT_PASS', A, 10)], A)
    expect(decidePrint(fold, { ...base, me: A, capable: true }).kind).toBe('send')
  })

  it('an author that reassigned is out forever', () => {
    const fold = foldPrintBaton(
      [
        row('PRINT_PASS', A, 10),
        row('PRINT_REQUEST', B, 20),
        row('PRINT_REASSIGN', A, 30, { to: B }),
      ],
      A,
    )
    expect(decidePrint(fold, { ...base, me: A, capable: true }).kind).toBe('stand-down')
    expect(decidePrint(fold, { ...base, me: A, capable: false }).kind).toBe('stand-down')
  })

  it('capable device requests once, only while a solicit is open', () => {
    const open = foldPrintBaton([], A)
    expect(decidePrint(open, { ...base, me: B, capable: true }).kind).toBe('wait')

    const solicit = foldPrintBaton([row('PRINT_PASS', A, 10)], A)
    expect(decidePrint(solicit, { ...base, me: B, capable: true }).kind).toBe('request')

    const already = foldPrintBaton(
      [row('PRINT_PASS', A, 10), row('PRINT_REQUEST', B, 20)],
      A,
    )
    expect(
      decidePrint(already, { ...base, me: B, capable: true, requestedAt: 999950 }).kind,
    ).toBe('wait')
  })

  it('non-capable devices never request', () => {
    const fold = foldPrintBaton([row('PRINT_PASS', A, 10)], A)
    expect(decidePrint(fold, { ...base, me: B, capable: false }).kind).toBe('wait')
  })

  it('alert arms 60 s after my request, only while unresolved and not holder', () => {
    const rows = [row('PRINT_PASS', A, 10), row('PRINT_REQUEST', B, 20)]
    const fold = foldPrintBaton(rows, A)
    const requestedAt = base.now - PRINT_ALERT_MS
    expect(
      decidePrint(fold, { ...base, me: B, capable: true, requestedAt }).kind,
    ).toBe('alert')
    expect(
      decidePrint(fold, {
        ...base,
        me: B,
        capable: true,
        requestedAt: base.now - PRINT_ALERT_MS + 1,
      }).kind,
    ).toBe('wait')
  })

  it('alert self-clears when a SUCCESS arrives', () => {
    const fold = foldPrintBaton(
      [
        row('PRINT_PASS', A, 10),
        row('PRINT_REQUEST', B, 20),
        row('PRINT_SUCCESS', A, 30, {}),
      ],
      A,
    )
    expect(
      decidePrint(fold, {
        ...base,
        me: B,
        capable: true,
        requestedAt: base.now - PRINT_ALERT_MS,
      }).kind,
    ).toBe('stand-down')
  })

  it('alert self-clears when the baton is reassigned to me', () => {
    const fold = foldPrintBaton(
      [
        row('PRINT_PASS', A, 10),
        row('PRINT_REQUEST', B, 20),
        row('PRINT_REASSIGN', A, 30, { to: B }),
      ],
      A,
    )
    expect(
      decidePrint(fold, {
        ...base,
        me: B,
        capable: true,
        requestedAt: base.now - PRINT_ALERT_MS,
      }).kind,
    ).toBe('send')
  })

  it('server device (me = null) announces as holder and stands down after reassigning', () => {
    const open = foldPrintBaton([], null)
    expect(decidePrint(open, { ...base, me: null, capable: false }).kind).toBe('pass')

    const afterReassign = foldPrintBaton(
      [
        row('PRINT_PASS', null, 10),
        row('PRINT_REQUEST', B, 20),
        row('PRINT_REASSIGN', null, 30, { to: B }),
      ],
      null,
    )
    expect(decidePrint(afterReassign, { ...base, me: null, capable: false }).kind).toBe(
      'stand-down',
    )
  })

  it('manual takeover is allowed only while unresolved', () => {
    expect(manualTakeoverAllowed(foldPrintBaton([], A))).toBe(true)
    expect(manualTakeoverAllowed(foldPrintBaton([row('PRINT_PASS', D, 10)], A))).toBe(true)
    expect(manualTakeoverAllowed(foldPrintBaton([row('PRINT_SUCCESS', A, 10, {})], A))).toBe(
      false,
    )
  })
})
