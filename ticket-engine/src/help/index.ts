// Help data module — single source of truth for all help content
// Shared between frontend (Next.js) and rolonative (React Native)

export type { HelpBlock, HelpBlockType, HelpSection, HelpData } from './helpData.js'

import helpDataEn from './help.en.json' with { type: 'json' }
import helpDataEs from './help.es.json' with { type: 'json' }
import type { HelpData } from './helpData.js'

export const helpData: Record<string, HelpData> = {
  en: helpDataEn as HelpData,
  es: helpDataEs as HelpData,
}

export function getHelpData(lang: string): HelpData {
  return helpData[lang] ?? helpData.en
}
