// Terms of Service acceptance — the wire contract shared by both clients
// (frontend TerminosSplash, rolonative TerminosGate) and the omni backend
// (GET/POST /v1/{locationGroupUuid}/terms, docs/features/TERMS.md).
//
// The gate rule: on first install / first login a device asks the backend
// whether the latest ToS version has been accepted for its location group.
// If not, the gate shows the bundled terminos (terminos/index.ts) and one
// admin's acceptance is recorded server-side for the whole location group.

export interface TermsAcceptanceResponse {
  /** The server's latest ToS version (Go: modals.LatestTermsVersion). */
  latest_version: string
  /** True when latest_version is already accepted for the location group. */
  accepted: boolean
  accepted_version: string | null
  acepted_date: string | null
  acepted_admin_uuid: string | null
}

/** The POST body for accepting the bundled ToS version. */
export interface AcceptTermsRequest {
  terms_acepted_version: string
}

/**
 * Whether the acceptance gate can be skipped. The server only ever records
 * its own latest version, so an `accepted` response for a different latest
 * than what this client bundles means version skew (the client predates the
 * new terms) — the app-update gate owns that case, and re-accepting the old
 * bundled version would be rejected by the server anyway: skip the gate.
 */
export function isTermsGateSatisfied(
  resp: TermsAcceptanceResponse,
  bundledVersion: string,
): boolean {
  if (resp.latest_version !== bundledVersion) return true
  return resp.accepted === true
}
