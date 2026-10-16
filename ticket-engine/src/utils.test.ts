import { describe, expect, it } from 'vitest'
import {
  coerceBools,
  days,
  daysLetter,
  getPrinterTypeName,
  getShortPermissionLabel,
  isEmail,
  safe,
  shadeColor,
  toCents,
  toPostgresTimestampTz,
  toSentenceCase,
  toTitleCase,
} from './utils.js'

const ESCPOS = '102e9428-4e72-4439-a97a-4b8d32fc7626'
const RELAY = '8352ed8a-a0a8-4a11-b117-b241c0865f1a'
const UPDATE_LOYALTY = 'ba15e452-f491-4fe9-ac05-f632b06ea202'
const SEE_ANALYTICS = '885ffd6d-e223-447b-94af-452007ae119a'

describe('toCents', () => {
  it('pads single-digit cents', () => {
    expect(toCents(5)).toBe('05')
  })
  it('pads zero', () => {
    expect(toCents(0)).toBe('00')
  })
  it('keeps double digits', () => {
    expect(toCents(99)).toBe('99')
  })
})

describe('toSentenceCase', () => {
  it('capitalizes first letter and lowercases the rest', () => {
    expect(toSentenceCase('hELLO world')).toBe('Hello world')
  })
  it('returns empty for falsy input', () => {
    expect(toSentenceCase('')).toBe('')
  })
})

describe('toTitleCase', () => {
  it('capitalizes each word', () => {
    expect(toTitleCase('hello WORLD')).toBe('Hello World')
  })
})

describe('shadeColor', () => {
  it('lightens a color', () => {
    expect(shadeColor('#800000', 50)).toBe('#c00000')
  })
  it('darkens a color', () => {
    expect(shadeColor('#ff0000', -50)).toBe('#7f0000')
  })
  it('clamps at 255', () => {
    expect(shadeColor('#808080', 200)).toBe('#ffffff')
  })
  it('returns input unchanged for invalid colors', () => {
    expect(shadeColor('red', 10)).toBe('red')
    expect(shadeColor('', 10)).toBe('')
    expect(shadeColor('#fff', 10)).toBe('#fff')
  })
})

describe('isEmail', () => {
  it('accepts a plain address', () => {
    expect(isEmail('a@b.co')).toBe(true)
  })
  it('rejects missing parts', () => {
    expect(isEmail('a@b')).toBe(false)
    expect(isEmail('ab.co')).toBe(false)
  })
})

describe('safe', () => {
  it('nulls undefined and empty string, keeps other falsy values', () => {
    expect(safe(undefined)).toBe(null)
    expect(safe('')).toBe(null)
    expect(safe(0)).toBe(0)
    expect(safe(false)).toBe(false)
    expect(safe('x')).toBe('x')
  })
})

describe('coerceBools', () => {
  it('coerces only the named keys', () => {
    const out = coerceBools({ a: 1, b: '' }, ['b'])
    expect(out.a).toBe(1)
    expect(out.b).toBe(false)
  })
  it('treats any non-empty string as truthy', () => {
    const out = coerceBools({ a: 'false' }, ['a'])
    expect(out.a).toBe(true)
  })
})

describe('getPrinterTypeName', () => {
  it('maps ESC/POS uuid', () => {
    expect(getPrinterTypeName(ESCPOS)).toBe('ESC POS')
  })
  it('maps Relay uuid', () => {
    expect(getPrinterTypeName(RELAY)).toBe('Relay')
  })
  it('defaults to Traditional', () => {
    expect(getPrinterTypeName('anything-else')).toBe('Traditional')
  })
})

describe('getShortPermissionLabel', () => {
  it('maps known permission uuids', () => {
    expect(getShortPermissionLabel(UPDATE_LOYALTY)).toBe('permUpdateLoyalty')
    expect(getShortPermissionLabel(SEE_ANALYTICS)).toBe('permSeeAnalytics')
  })
  it('passes unknown uuids through', () => {
    expect(getShortPermissionLabel('nope')).toBe('nope')
  })
})

describe('toPostgresTimestampTz', () => {
  it('formats a fixed date with microseconds and tz', () => {
    const d = new Date(2026, 0, 2, 3, 4, 5, 6)
    const out = toPostgresTimestampTz(d)
    expect(out).toMatch(/^2026-01-02 03:04:05\.006000 [+-]\d{4} /)
  })
})

describe('days / daysLetter', () => {
  it('has 7 days in order', () => {
    expect(days.map((d) => d.name)).toEqual([
      'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
    ])
  })
  it('has matching 3-letter codes', () => {
    expect(daysLetter).toEqual(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])
  })
})
