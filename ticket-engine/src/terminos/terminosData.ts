// Type definitions for the Términos y Condiciones content
// Shared between @omni/ticket-engine and consuming apps (frontend + rolonative)

export type TerminosBlockType = 'p' | 'ul' | 'ol'

export type TerminosBlock =
  | { type: 'p'; text: string }
  | { type: 'ul' | 'ol'; items: string[] }

export interface TerminosSection {
  heading: string
  blocks: TerminosBlock[]
}

export interface TerminosData {
  title: string
  lastUpdated: string
  versionLabel: string
  version: string
  sections: TerminosSection[]
  acceptanceTitle: string
  acceptanceIntro: string
  acceptanceCheckbox: string
  acceptButton: string
}
