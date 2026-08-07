import { useMemo, useState, type PropsWithChildren } from 'react'
import { ZodError } from 'zod'

import {
  DisplayNameContext,
  type DisplayNameContextValue,
  type SaveDisplayNameResult,
} from '@features/identity/display-name-context-value'
import { validateDisplayName } from '@features/identity/schema'
import { readStoredDisplayName, writeStoredDisplayName } from '@features/identity/storage'

export const DisplayNameProvider = ({ children }: PropsWithChildren) => {
  const [displayName, setDisplayName] = useState<string | null>(() => readStoredDisplayName())
  const [isEditing, setIsEditing] = useState(false)

  const hasDisplayName = displayName !== null
  const isRequired = !hasDisplayName
  const isDialogOpen = isRequired || isEditing

  const saveDisplayName = (value: string): SaveDisplayNameResult => {
    try {
      const validatedDisplayName = validateDisplayName(value)

      setDisplayName(validatedDisplayName)
      writeStoredDisplayName(validatedDisplayName)
      setIsEditing(false)

      return {
        success: true,
        value: validatedDisplayName,
      }
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          success: false,
          error: error.issues[0]?.message ?? 'Display name is invalid',
        }
      }

      return {
        success: false,
        error: 'Display name is invalid',
      }
    }
  }

  const value = useMemo<DisplayNameContextValue>(() => {
    return {
      displayName,
      hasDisplayName,
      isDialogOpen,
      isRequired,
      openEditor: () => {
        setIsEditing(true)
      },
      closeEditor: () => {
        if (isRequired) {
          return
        }

        setIsEditing(false)
      },
      saveDisplayName,
    }
  }, [displayName, hasDisplayName, isDialogOpen, isRequired])

  return <DisplayNameContext.Provider value={value}>{children}</DisplayNameContext.Provider>
}
