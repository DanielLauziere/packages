import { describe, it, expect } from 'vitest'
import { terminosData, getTerminosData } from './index.js'
import type { TerminosBlock, TerminosSection } from './terminosData.js'

const blockShape = (block: TerminosBlock): string =>
  block.type === 'p'
    ? 'p'
    : `${block.type}:${block.items.length}`

const sectionShape = (section: TerminosSection): string =>
  `${section.heading.split('.')[0]}.${section.blocks
    .map(blockShape)
    .join(',')}`

const LOCALES = ['en', 'es']

describe('getTerminosData', () => {
  it('returns the requested locale', () => {
    expect(getTerminosData('es')).toBe(terminosData.es)
    expect(getTerminosData('en')).toBe(terminosData.en)
  })

  it('falls back to en for an unsupported lang', () => {
    expect(getTerminosData('fr')).toBe(terminosData.en)
  })
})

describe('terminos content', () => {
  it.each(LOCALES)('%s has the full document', (lang) => {
    const data = getTerminosData(lang)

    expect(data.version).toBe('1.0')
    expect(data.title).toBeTruthy()
    expect(data.lastUpdated).toBeTruthy()
    expect(data.versionLabel).toBeTruthy()
    expect(data.acceptanceTitle).toBeTruthy()
    expect(data.acceptanceIntro).toBeTruthy()
    expect(data.acceptanceCheckbox).toContain('{{version}}')
    expect(data.acceptButton).toBeTruthy()
    expect(data.sections).toHaveLength(42)
  })

  it('keeps en/es structurally identical (translation cannot drop content)', () => {
    const en = getTerminosData('en')
    const es = getTerminosData('es')

    expect(en.sections.map(sectionShape)).toEqual(
      es.sections.map(sectionShape),
    )
  })
})
