import { describe, it, expect } from 'vitest'
import { ticketIdFromUUID } from './ticketId.js'

describe('ticketIdFromUUID', () => {
  it('returns deterministic id for a given UUID', () => {
    expect(ticketIdFromUUID('00000000-0000-0000-0000-000000000001')).toBe(11167)
    expect(ticketIdFromUUID('00000000-0000-0000-0000-000000000010')).toBe(46856)
    expect(ticketIdFromUUID('00000000-0000-0000-0000-000000000100')).toBe(52686)
    expect(ticketIdFromUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(17873)
    expect(ticketIdFromUUID('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(94530)
    expect(ticketIdFromUUID('ffffffff-ffff-ffff-ffff-ffffffffffff')).toBe(37631)
  })

  it('always returns value between 10000 and 99999 inclusive', () => {
    const uuids = [
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000004',
      '00000000-0000-0000-0000-000000000005',
      '00000000-0000-0000-0000-000000000010',
      '00000000-0000-0000-0000-000000000020',
      '00000000-0000-0000-0000-000000000050',
      '00000000-0000-0000-0000-000000000100',
      '00000000-0000-0000-0000-000000000200',
      '00000000-0000-0000-0000-000000000500',
      '00000000-0000-0000-0000-000000001000',
      'random-uuid-here-for-testing',
      '550e8400-e29b-41d4-a716-446655440000',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    ]
    for (const uuid of uuids) {
      const id = ticketIdFromUUID(uuid)
      expect(id).toBeGreaterThanOrEqual(10000)
      expect(id).toBeLessThanOrEqual(99999)
    }
  })

  it('treats empty string as valid input', () => {
    expect(ticketIdFromUUID('')).toBe(10000)
  })

  it('same UUID always produces same id', () => {
    const results = Array.from({ length: 10 }, () =>
      ticketIdFromUUID('550e8400-e29b-41d4-a716-446655440000'),
    )
    expect(results.every((v) => v === results[0])).toBe(true)
  })
})
