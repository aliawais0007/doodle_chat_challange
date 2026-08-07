import { createContext } from 'react'

export type SaveDisplayNameResult =
  | {
      success: true
      value: string
    }
  | {
      success: false
      error: string
    }

export type DisplayNameContextValue = {
  displayName: string | null
  hasDisplayName: boolean
  isDialogOpen: boolean
  isRequired: boolean
  openEditor: () => void
  closeEditor: () => void
  saveDisplayName: (value: string) => SaveDisplayNameResult
}

export const DisplayNameContext = createContext<DisplayNameContextValue | null>(null)