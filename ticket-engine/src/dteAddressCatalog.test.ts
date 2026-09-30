import { describe, it, expect } from 'vitest'
import {
  DTE_DEPARTAMENTOS,
  DTE_MUNICIPIOS,
  DTE_DISTRITOS,
  dteMunicipiosFor,
  dteDistritosFor,
  dteOptionLabel,
  dteOptionsWithCurrent,
} from './dteAddressCatalog.js'

const TWO_DIGITS = /^\d{2}$/

describe('dteAddressCatalog (MH CAT-012/013/008)', () => {
  it('has the official counts: 15 departamentos, 45 municipios, 263 distritos', () => {
    expect(DTE_DEPARTAMENTOS).toHaveLength(15)
    expect(DTE_MUNICIPIOS).toHaveLength(45)
    expect(DTE_DISTRITOS).toHaveLength(263)
  })

  it('excludes nothing but the "00" foreigners entry when counting real localities', () => {
    const real = <T extends { codigo: string }>(list: T[]) =>
      list.filter((o) => o.codigo !== '00')
    expect(real(DTE_DEPARTAMENTOS)).toHaveLength(14)
    expect(real(DTE_MUNICIPIOS)).toHaveLength(44)
    expect(real(DTE_DISTRITOS)).toHaveLength(262)
  })

  it('uses zero-padded 2-digit string codes everywhere', () => {
    for (const o of [...DTE_DEPARTAMENTOS, ...DTE_MUNICIPIOS, ...DTE_DISTRITOS]) {
      expect(o.codigo).toMatch(TWO_DIGITS)
      expect(o.nombre.length).toBeGreaterThan(0)
    }
  })

  it('nests every municipio and distrito under an existing parent', () => {
    const deptCodes = new Set(DTE_DEPARTAMENTOS.map((d) => d.codigo))
    const muniKeys = new Set(DTE_MUNICIPIOS.map((m) => `${m.departamento}/${m.codigo}`))
    expect(muniKeys.size).toBe(DTE_MUNICIPIOS.length)

    for (const m of DTE_MUNICIPIOS) expect(deptCodes.has(m.departamento)).toBe(true)

    const distritoKeys = new Set(
      DTE_DISTRITOS.map((d) => `${d.departamento}/${d.municipio}/${d.codigo}`),
    )
    expect(distritoKeys.size).toBe(DTE_DISTRITOS.length)
    for (const d of DTE_DISTRITOS) expect(muniKeys.has(`${d.departamento}/${d.municipio}`)).toBe(true)
  })

  it('never has more than 99 children in one department (codes stay 2 digits)', () => {
    expect(Math.max(...DTE_DEPARTAMENTOS.map((d) => dteMunicipiosFor(d.codigo).length))).toBeLessThanOrEqual(10)
    expect(
      Math.max(...DTE_MUNICIPIOS.map((m) => dteDistritosFor(m.departamento, m.codigo).length)),
    ).toBeLessThan(100)
  })

  it('filters by departamento (codes repeat across departments)', () => {
    // dept 01 Ahuachapán: municipios 13/14/15
    expect(dteMunicipiosFor('01').map((m) => m.codigo)).toEqual(['13', '14', '15'])
    // dept 00 is the foreigners catch-all
    expect(dteMunicipiosFor('00').map((m) => m.codigo)).toEqual(['00'])
    expect(dteMunicipiosFor('99')).toEqual([])
    expect(dteDistritosFor('99', '99')).toEqual([])
  })

  it('filters distritos by (departamento, municipio)', () => {
    // the triple accepted by MH in a real transmission: 02 / 17 / 09
    expect(dteMunicipiosFor('02').map((m) => m.codigo)).toEqual(['14', '15', '16', '17'])
    const distritos = dteDistritosFor('02', '17')
    expect(distritos.map((d) => d.codigo)).toEqual(['01', '03', '05', '08', '09', '12'])
    expect(distritos.every((d) => d.departamento === '02' && d.municipio === '17')).toBe(true)
  })

  it('numbers municipios after the distritos of the same department', () => {
    const distritoCount = (departamento: string) =>
      DTE_DISTRITOS.filter((d) => d.departamento === departamento && d.codigo !== '00').length
    for (const { codigo } of DTE_DEPARTAMENTOS.filter((d) => d.codigo !== '00')) {
      const codes = dteMunicipiosFor(codigo)
        .map((m) => Number(m.codigo))
        .sort((a, b) => a - b)
      expect(codes[0]).toBe(distritoCount(codigo) + 1)
      expect(codes).toEqual(codes.map((_, i) => codes[0] + i))
    }
  })

  it('labels options as "codigo · nombre"', () => {
    expect(dteOptionLabel({ codigo: '06', nombre: 'San Salvador' })).toBe('06 · San Salvador')
  })

  it('keeps an unknown saved code as an option instead of blanking it', () => {
    const options = dteMunicipiosFor('01')
    expect(dteOptionsWithCurrent(options, '14')).toEqual(options)
    const withStale = dteOptionsWithCurrent(options, '99')
    expect(withStale[0]).toEqual({ codigo: '99', nombre: '99' })
    expect(withStale).toHaveLength(options.length + 1)
    expect(dteOptionsWithCurrent(options, '')).toEqual(options)
  })
})
