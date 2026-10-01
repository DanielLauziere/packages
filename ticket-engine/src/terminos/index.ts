// Terminos module — single source of truth for the Términos y Condiciones
// content rendered by the acceptance splash.
//
// Source of truth for the WORDING is ../omni/docs/terminos/TERMINOS.MD
// (human-readable). These JSON files are the runtime copy consumed by both
// clients — regenerate them when the .md changes and bump `version`.
//
// Shared between frontend (Next.js) and rolonative (React Native)

export type {
  TerminosBlock,
  TerminosBlockType,
  TerminosSection,
  TerminosData,
} from './terminosData.js'

import terminosDataEn from './terminos.en.json' with { type: 'json' }
import terminosDataEs from './terminos.es.json' with { type: 'json' }
import type { TerminosData } from './terminosData.js'

export const terminosData: Record<string, TerminosData> = {
  en: terminosDataEn as TerminosData,
  es: terminosDataEs as TerminosData,
}

export function getTerminosData(lang: string): TerminosData {
  return terminosData[lang] ?? terminosData.en
}
