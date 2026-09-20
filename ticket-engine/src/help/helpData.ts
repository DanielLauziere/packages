// Type definitions for the help block system
// Shared between @omni/ticket-engine and consuming apps (frontend + rolonative)

export type HelpBlockType =
  | 'summary'
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'note'
  | 'warning'
  | 'breadcrumb'

export interface HelpBlock {
  type: HelpBlockType
  body?: string
  items?: string[]
  /** Device-specific navigation path for breadcrumb blocks */
  devices?: {
    web: string
    mobile: string
  }
}

export interface HelpSection {
  id: string
  title: string
  blocks: HelpBlock[]
}

export interface HelpData {
  sections: HelpSection[]
}
