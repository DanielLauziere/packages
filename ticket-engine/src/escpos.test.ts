import { describe, it, expect } from 'vitest'
import {
  charsPerLineMM,
  wrapText,
  truncateText,
  leftRight,
  toAscii,
  formatAsciiDate,
  EscPosBuilder,
  escposToBase64,
  sortByName,
  scaleMatrix,
  rasterizeForEscPos,
  resolvePrinterWidth,
  safePrint,
} from './escpos.js'

describe('charsPerLineMM', () => {
  it('returns floor of width * 0.45', () => {
    expect(charsPerLineMM(80)).toBe(36)
    expect(charsPerLineMM(58)).toBe(26)
    expect(charsPerLineMM(0)).toBe(0)
    expect(charsPerLineMM(1)).toBe(0)
    expect(charsPerLineMM(2)).toBe(0)
    expect(charsPerLineMM(3)).toBe(1)
  })
})

describe('wrapText', () => {
  it('wraps text at word boundaries', () => {
    const result = wrapText('a b c d e', 3)
    expect(result).toEqual(['a b', 'c d', 'e'])
  })

  it('returns single line if text fits', () => {
    expect(wrapText('hello world', 20)).toEqual(['hello world'])
  })

  it('handles empty string', () => {
    expect(wrapText('', 10)).toEqual([])
  })

  it('handles single word longer than width', () => {
    const result = wrapText('superlongword', 5)
    expect(result[result.length - 1]).toBe('superlongword')
  })

  it('trims whitespace from lines', () => {
    const result = wrapText('  a   b   c  ', 3)
    expect(result).toEqual(['a b', 'c'])
  })
})

describe('truncateText', () => {
  it('returns text unchanged if within width', () => {
    expect(truncateText('hello', 10)).toBe('hello')
    expect(truncateText('hello', 5)).toBe('hello')
  })

  it('truncates with ellipsis when text exceeds width', () => {
    expect(truncateText('hello', 4)).toBe('hel…')
    expect(truncateText('hello world', 6)).toBe('hello…')
  })

  it('handles width of 1', () => {
    expect(truncateText('hi', 1)).toBe('h')
  })

  it('handles width of 0', () => {
    expect(truncateText('hi', 0)).toBe('')
  })
})

describe('leftRight', () => {
  it('pads space between left and right', () => {
    const width = 12
    const spaces = width - 'left'.length - 'right'.length
    expect(leftRight('left', 'right', width)).toBe('left' + ' '.repeat(spaces) + 'right')
  })

  it('returns left only if not enough space for both', () => {
    expect(leftRight('left', 'right', 4)).toBe('left')
  })

  it('returns left only when left+right equals width (space < 1)', () => {
    expect(leftRight('ab', 'cd', 4)).toBe('ab')
  })
})

describe('toAscii', () => {
  it('strips diacritics', () => {
    expect(toAscii('café')).toBe('cafe')
    expect(toAscii('piñata')).toBe('pinata')
    expect(toAscii('über')).toBe('uber')
  })

  it('removes non-ASCII characters', () => {
    expect(toAscii('hello—world')).toBe('helloworld')
    expect(toAscii('★')).toBe('')
  })

  it('returns empty string for null or undefined', () => {
    expect(toAscii(null)).toBe('')
    expect(toAscii(undefined)).toBe('')
  })

  it('preserves ASCII-safe text', () => {
    expect(toAscii('Hello World 123!')).toBe('Hello World 123!')
  })
})

describe('formatAsciiDate', () => {
  it('formats date in DD-MM-YYYY HH:MM:SS AM/PM', () => {
    const d = new Date('2026-07-09T14:30:00')
    const result = formatAsciiDate(d)
    expect(result).toMatch(/^\d{2}-\d{2}-\d{4} \d{1,2}:\d{2}:\d{2} [AP]M$/)
    expect(result).toContain('09-07-2026')
  })

  it('returns empty string for invalid date', () => {
    expect(formatAsciiDate('not-a-date')).toBe('')
  })

  it('handles midnight as 12:00:00 AM', () => {
    const d = new Date('2026-01-01T00:00:00')
    const result = formatAsciiDate(d)
    expect(result).toContain('12:00:00 AM')
  })

  it('handles noon as 12:00:00 PM', () => {
    const d = new Date('2026-01-01T12:00:00')
    const result = formatAsciiDate(d)
    expect(result).toContain('12:00:00 PM')
  })
})

describe('EscPosBuilder', () => {
  it('init produces ESC @', () => {
    const builder = new EscPosBuilder()
    builder.init()
    expect(Array.from(builder.build())).toEqual([0x1b, 0x40])
  })

  it('build returns empty array for new builder', () => {
    const builder = new EscPosBuilder()
    expect(Array.from(builder.build())).toEqual([])
  })

  it('alignLeft produces ESC a 0', () => {
    const builder = new EscPosBuilder()
    builder.alignLeft()
    expect(Array.from(builder.build())).toEqual([0x1b, 0x61, 0])
  })

  it('alignCenter produces ESC a 1', () => {
    const builder = new EscPosBuilder()
    builder.alignCenter()
    expect(Array.from(builder.build())).toEqual([0x1b, 0x61, 1])
  })

  it('alignRight produces ESC a 2', () => {
    const builder = new EscPosBuilder()
    builder.alignRight()
    expect(Array.from(builder.build())).toEqual([0x1b, 0x61, 2])
  })

  it('bold true produces ESC E 1', () => {
    const builder = new EscPosBuilder()
    builder.bold(true)
    expect(Array.from(builder.build())).toEqual([0x1b, 0x45, 1])
  })

  it('bold false produces ESC E 0', () => {
    const builder = new EscPosBuilder()
    builder.bold(false)
    expect(Array.from(builder.build())).toEqual([0x1b, 0x45, 0])
  })

  it('text appends encoded string plus newline', () => {
    const builder = new EscPosBuilder()
    builder.text('Hello')
    const bytes = Array.from(builder.build())
    expect(bytes.slice(-1)).toEqual([0x0a])
    const textPart = String.fromCharCode(...bytes.slice(0, -1))
    expect(textPart).toBe('Hello')
  })

  it('feed produces ESC d N', () => {
    const builder = new EscPosBuilder()
    builder.feed(3)
    expect(Array.from(builder.build())).toEqual([0x1b, 0x64, 3])
  })

  it('feed defaults to 1 line', () => {
    const builder = new EscPosBuilder()
    builder.feed()
    expect(Array.from(builder.build())).toEqual([0x1b, 0x64, 1])
  })

  it('setTextSize clamps width and height to 0-7', () => {
    const builder = new EscPosBuilder()
    builder.setTextSize(8, 8)
    // 7<<4 | 7 = 0x77
    expect(Array.from(builder.build())).toEqual([0x1d, 0x21, 0x77])
  })

  it('setTextSize with minimum values', () => {
    const builder = new EscPosBuilder()
    builder.setTextSize(0, 0)
    expect(Array.from(builder.build())).toEqual([0x1d, 0x21, 0x00])
  })

  it('setTextSize encodes width and height with -1 offset', () => {
    const builder = new EscPosBuilder()
    builder.setTextSize(2, 3)
    // h=3-1=2, w=2-1=1: (2<<4) | 1 = 0x21
    expect(Array.from(builder.build())).toEqual([0x1d, 0x21, 0x21])
  })

  it('resetTextSize sends GS ! 0x00', () => {
    const builder = new EscPosBuilder()
    builder.resetTextSize()
    expect(Array.from(builder.build())).toEqual([0x1d, 0x21, 0x00])
  })

  it('fullCut produces GS V 0x00', () => {
    const builder = new EscPosBuilder()
    builder.fullCut()
    expect(Array.from(builder.build())).toEqual([0x1d, 0x56, 0x00])
  })

  it('partialCut produces GS V 0x01', () => {
    const builder = new EscPosBuilder()
    builder.partialCut()
    expect(Array.from(builder.build())).toEqual([0x1d, 0x56, 0x01])
  })

  it('pulseDrawer produces ESC p 0x00 0x19 0xfa', () => {
    const builder = new EscPosBuilder()
    builder.pulseDrawer()
    expect(Array.from(builder.build())).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa])
  })

  it('raw appends given bytes', () => {
    const builder = new EscPosBuilder()
    builder.raw([0x01, 0x02, 0x03])
    expect(Array.from(builder.build())).toEqual([0x01, 0x02, 0x03])
  })

  it('accumulates multiple commands in sequence', () => {
    const builder = new EscPosBuilder()
    builder.init()
    builder.alignCenter()
    builder.bold(true)
    builder.text('test')
    builder.bold(false)
    builder.fullCut()
    const bytes = Array.from(builder.build())
    expect(bytes.length).toBeGreaterThan(0)
    expect(bytes[0]).toBe(0x1b)
    expect(bytes[1]).toBe(0x40)
  })

  it('addRasterImage writes correct header and pixel data', () => {
    const builder = new EscPosBuilder()
    // bytesPerRow = ceil(16/8) = 2, totalBytes = 2 * 2 = 4
    const pixels = new Uint8Array([0xff, 0x00, 0xaa, 0x55])
    builder.addRasterImage(16, 2, pixels)
    const bytes = Array.from(builder.build())
    // Header: GS v 0 0x00
    expect(bytes[0]).toBe(0x1d)
    expect(bytes[1]).toBe(0x76)
    expect(bytes[2]).toBe(0x30)
    expect(bytes[3]).toBe(0x00)
    // bytesPerRow = ceil(16/8) = 2
    expect(bytes[4]).toBe(2)
    expect(bytes[5]).toBe(0)
    // height = 2
    expect(bytes[6]).toBe(2)
    expect(bytes[7]).toBe(0)
    // pixel data (4 bytes)
    expect(bytes.slice(8)).toEqual([0xff, 0x00, 0xaa, 0x55])
  })
})

describe('escposToBase64', () => {
  it('converts Uint8Array to base64', () => {
    const data = new Uint8Array([0x1b, 0x40, 0x48, 0x65, 0x6c])
    const result = escposToBase64(data)
    expect(result).toBe('G0BIZWw=')
  })

  it('handles empty array', () => {
    expect(escposToBase64(new Uint8Array([]))).toBe('')
  })
})

describe('sortByName', () => {
  it('sorts by name locale-aware', () => {
    const items = [
      { name: 'Zebra' },
      { name: 'Águila' },
      { name: 'Banana' },
    ]
    const sorted = sortByName(items)
    expect(sorted.map((i) => i.name)).toEqual(['Águila', 'Banana', 'Zebra'])
  })

  it('does not mutate original array', () => {
    const items = [{ name: 'b' }, { name: 'a' }]
    sortByName(items)
    expect(items[0]!.name).toBe('b')
  })

  it('handles empty array', () => {
    expect(sortByName([])).toEqual([])
  })
})

describe('scaleMatrix', () => {
  it('scales a 2x2 matrix to target size', () => {
    const matrix = [
      [1, 0],
      [0, 1],
    ]
    const result = scaleMatrix(matrix, 4)
    expect(result.length).toBe(16)
    // Top-left 2x2 should be 1s
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        expect(result[r * 4 + c]).toBe(1)
      }
    }
    // Top-right 2x2 should be 0s
    for (let r = 0; r < 2; r++) {
      for (let c = 2; c < 4; c++) {
        expect(result[r * 4 + c]).toBe(0)
      }
    }
  })

  it('all-zero matrix produces all-zero output', () => {
    const matrix = [
      [0, 0],
      [0, 0],
    ]
    const result = scaleMatrix(matrix, 4)
    expect(result.every((v) => v === 0)).toBe(true)
  })

  it('all-one matrix produces all-one output', () => {
    const matrix = [
      [1, 1],
      [1, 1],
    ]
    const result = scaleMatrix(matrix, 4)
    expect(result.every((v) => v === 1)).toBe(true)
  })
})

describe('rasterizeForEscPos', () => {
  it('packs bits correctly for a simple pattern', () => {
    const width = 8
    const height = 1
    const bitmap = new Uint8Array([1, 0, 1, 0, 1, 0, 1, 0])
    const result = rasterizeForEscPos(width, height, bitmap)
    // byte = 10101010 = 0xaa
    expect(result.length).toBe(1)
    expect(result[0]).toBe(0xaa)
  })

  it('handles width not divisible by 8', () => {
    const width = 10
    const height = 1
    const bitmap = new Uint8Array(10)
    bitmap[0] = 1
    const result = rasterizeForEscPos(width, height, bitmap)
    expect(result.length).toBe(Math.ceil(10 / 8))
    // First bit set: 10000000 = 0x80
    expect(result[0]).toBe(0x80)
  })

  it('multiple rows', () => {
    const width = 8
    const height = 3
    const bitmap = new Uint8Array(24)
    // Row 0: all 1s
    for (let x = 0; x < 8; x++) bitmap[x] = 1
    const result = rasterizeForEscPos(width, height, bitmap)
    expect(result.length).toBe(3)
    expect(result[0]).toBe(0xff)
    expect(result[1]).toBe(0x00)
    expect(result[2]).toBe(0x00)
  })
})

describe('resolvePrinterWidth', () => {
  it('defaults to 80mm width when widthMM is not provided', () => {
    expect(resolvePrinterWidth()).toBe(36)
  })

  it('defaults to 80mm when widthMM is 0 or negative', () => {
    expect(resolvePrinterWidth(0)).toBe(36)
    expect(resolvePrinterWidth(-1)).toBe(36)
  })

  it('uses provided widthMM', () => {
    expect(resolvePrinterWidth(58)).toBe(26)
    expect(resolvePrinterWidth(48)).toBe(21)
  })
})

describe('safePrint', () => {
  it('adds cut command and returns bytes', () => {
    const builder = new EscPosBuilder()
    const result = safePrint(builder)
    const bytes = Array.from(result)
    expect(bytes.length).toBeGreaterThan(0)
    // Should end with partial cut
    expect(bytes.slice(-3)).toEqual([0x1d, 0x56, 0x01])
  })

  it('includes pulse drawer when openDrawer option is set', () => {
    const builder = new EscPosBuilder()
    const result = safePrint(builder, { openDrawer: true })
    const bytes = Array.from(result)
    // ESC p 0x00 0x19 0xfa should be present
    const drawerSeq = [0x1b, 0x70, 0x00, 0x19, 0xfa]
    for (let i = 0; i <= bytes.length - drawerSeq.length; i++) {
      if (bytes.slice(i, i + drawerSeq.length).every((v, j) => v === drawerSeq[j])) {
        expect(true).toBe(true)
        return
      }
    }
    expect('drawer pulse not found').toBe('should not reach')
  })

  it('adds BEL beep when beepMode is bel', () => {
    const builder = new EscPosBuilder()
    const result = safePrint(builder, { beepMode: 'bel' })
    const bytes = Array.from(result)
    expect(bytes).toContain(0x07)
  })

  it('adds ESC B beep when beepMode is escb', () => {
    const builder = new EscPosBuilder()
    const result = safePrint(builder, { beepMode: 'escb' })
    const bytes = Array.from(result)
    const escbSeq = [0x1b, 0x42, 0x03, 0x03]
    for (let i = 0; i <= bytes.length - escbSeq.length; i++) {
      if (bytes.slice(i, i + escbSeq.length).every((v, j) => v === escbSeq[j])) {
        expect(true).toBe(true)
        return
      }
    }
    expect('ESC B not found').toBe('should not reach')
  })
})
