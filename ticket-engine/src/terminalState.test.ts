import { describe, it, expect } from 'vitest'
import type { TicketLogEntry } from './applyTicketLog.js'

const SET_STATUS_PAID = 'SET_STATUS_PAID'

function shouldApplyTerminalState(
  dbStatus: string | null | undefined,
  logs: Pick<TicketLogEntry, 'action'>[],
): boolean {
  if (!logs.some((l) => l.action === SET_STATUS_PAID)) return false
  if (dbStatus == null) return false
  return dbStatus === 'PAID'
}

describe('applyTerminalState guard', () => {
  it('proceeds when status is PAID and log has SET_STATUS_PAID', () => {
    const logs = [{ action: 'SET_TABLE' }, { action: SET_STATUS_PAID }]
    expect(shouldApplyTerminalState('PAID', logs)).toBe(true)
  })

  it('skips when status is OPEN even if log has SET_STATUS_PAID', () => {
    const logs = [{ action: 'SET_TABLE' }, { action: SET_STATUS_PAID }]
    expect(shouldApplyTerminalState('OPEN', logs)).toBe(false)
  })

  it('skips when status is COMPLETE even if log has SET_STATUS_PAID', () => {
    const logs = [{ action: 'SET_STATUS_COMPLETE' }, { action: SET_STATUS_PAID }]
    expect(shouldApplyTerminalState('COMPLETE', logs)).toBe(false)
  })

  it('skips when no ticket row exists (null status)', () => {
    const logs = [{ action: SET_STATUS_PAID }]
    expect(shouldApplyTerminalState(null, logs)).toBe(false)
  })

  it('skips when no ticket row exists (undefined status)', () => {
    const logs = [{ action: SET_STATUS_PAID }]
    expect(shouldApplyTerminalState(undefined, logs)).toBe(false)
  })

  it('skips when logs do not contain SET_STATUS_PAID', () => {
    const logs = [{ action: 'SET_TABLE' }, { action: 'ADD_ITEM' }]
    expect(shouldApplyTerminalState('PAID', logs)).toBe(false)
  })

  it('skips when logs are empty', () => {
    expect(shouldApplyTerminalState('PAID', [])).toBe(false)
  })
})
