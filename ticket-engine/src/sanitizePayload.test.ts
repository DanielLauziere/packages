import { describe, it, expect } from 'vitest'
import { sanitizePayload } from './sanitizePayload.js'

describe('sanitizePayload', () => {
  it('replaces undefined with null at top level', () => {
    expect(sanitizePayload(undefined)).toBeNull()
  })

  it('returns null when given null', () => {
    expect(sanitizePayload(null)).toBeNull()
  })

  it('leaves primitives unchanged', () => {
    expect(sanitizePayload(42)).toBe(42)
    expect(sanitizePayload('hello')).toBe('hello')
    expect(sanitizePayload(true)).toBe(true)
    expect(sanitizePayload(false)).toBe(false)
    expect(sanitizePayload(0)).toBe(0)
    expect(sanitizePayload('')).toBe('')
  })

  it('replaces undefined values in objects with null', () => {
    const input = { a: 1, b: undefined, c: 'hello' }
    const expected = { a: 1, b: null, c: 'hello' }
    expect(sanitizePayload(input)).toEqual(expected)
  })

  it('replaces undefined in nested objects', () => {
    const input = { a: { b: undefined, c: 2 }, d: undefined }
    const expected = { a: { b: null, c: 2 }, d: null }
    expect(sanitizePayload(input)).toEqual(expected)
  })

  it('replaces undefined in arrays with null', () => {
    const input = [1, undefined, 3]
    const expected = [1, null, 3]
    expect(sanitizePayload(input)).toEqual(expected)
  })

  it('handles arrays of objects with undefined values', () => {
    const input = [{ a: 1, b: undefined }, { a: undefined, c: 3 }]
    const expected = [{ a: 1, b: null }, { a: null, c: 3 }]
    expect(sanitizePayload(input)).toEqual(expected)
  })

  it('handles deeply nested mixed structures', () => {
    const input = {
      level1: {
        level2: [
          { value: undefined },
          { value: 'keep', extra: undefined },
        ],
        done: undefined,
      },
      top: undefined,
      keep: 'this',
    }
    const expected = {
      level1: {
        level2: [
          { value: null },
          { value: 'keep', extra: null },
        ],
        done: null,
      },
      top: null,
      keep: 'this',
    }
    expect(sanitizePayload(input)).toEqual(expected)
  })

  it('handles empty object', () => {
    expect(sanitizePayload({})).toEqual({})
  })

  it('handles empty array', () => {
    expect(sanitizePayload([])).toEqual([])
  })

  it('does not mutate the original object', () => {
    const input = { a: undefined, b: 2 }
    const copy = { ...input, a: undefined }
    sanitizePayload(input)
    expect(input).toEqual(copy)
  })
})
