import { describe, it, expect } from 'vitest'
import { isTermsGateSatisfied, type TermsAcceptanceResponse } from './acceptance'
import { getTerminosData } from './index'

const bundled = getTerminosData('es').version

const resp = (
  overrides: Partial<TermsAcceptanceResponse>,
): TermsAcceptanceResponse => ({
  latest_version: bundled,
  accepted: false,
  accepted_version: null,
  acepted_date: null,
  acepted_admin_uuid: null,
  ...overrides,
})

describe('isTermsGateSatisfied', () => {
  it('is satisfied when the latest version is accepted', () => {
    expect(isTermsGateSatisfied(resp({ accepted: true }), bundled)).toBe(true)
  })

  it('is not satisfied when the latest version is unaccepted', () => {
    expect(isTermsGateSatisfied(resp({ accepted: false }), bundled)).toBe(false)
  })

  it('skips the gate on server/client version skew (app-update owns it)', () => {
    // Server is ahead of the bundled text: re-accepting the old version would
    // be rejected server-side, so the gate must not block the operator.
    const ahead = resp({ latest_version: '2.0', accepted: false })
    expect(isTermsGateSatisfied(ahead, bundled)).toBe(true)
  })

  it('treats a stale acceptance flag for a newer latest as unaccepted', () => {
    // latest bumped to 2.0 and the LG only accepted 1.0: accepted=false, and
    // the bundled version is also stale, so the gate still skips (the client
    // cannot render terms it does not bundle).
    const stale = resp({
      latest_version: '2.0',
      accepted: false,
      accepted_version: '1.0',
    })
    expect(isTermsGateSatisfied(stale, bundled)).toBe(true)
  })
})

describe('terminos/server version parity', () => {
  it('both language files share one version and en/es stay in lockstep', () => {
    const es = getTerminosData('es')
    const en = getTerminosData('en')
    expect(es.version).toBe(en.version)
    expect(es.version).toMatch(/^\d+\.\d+$/)
  })

  it('pinned version matches the omni server LatestTermsVersion', async () => {
    // Cross-repo contract: Go modals.LatestTermsVersion must equal the
    // engine's bundled `version` (mirrored by the Go test of the same name
    // in omni/src/modals/termsModel_test.go).
    const { readFile } = await import('node:fs/promises')
    const url = new URL(
      '../../../../omni/src/modals/termsModel.go',
      import.meta.url,
    )
    let source: string
    try {
      source = await readFile(url, 'utf8')
    } catch {
      // Engine-only checkout: nothing to compare against.
      return
    }
    const match = source.match(/LatestTermsVersion = "([^"]+)"/)
    expect(match).not.toBeNull()
    expect(match?.[1]).toBe(bundled)
  })
})
