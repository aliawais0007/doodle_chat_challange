import { displayNameSchema } from '@features/identity/schema'

export const DISPLAY_NAME_STORAGE_KEY = 'doodle-chat.display-name'

export type DisplayNameStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const getBrowserStorage = (): DisplayNameStorage | null => {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const readStoredDisplayName = (storage: DisplayNameStorage | null = getBrowserStorage()) => {
  if (!storage) {
    return null
  }

  try {
    const storedValue = storage.getItem(DISPLAY_NAME_STORAGE_KEY)

    if (!storedValue) {
      return null
    }

    const parsed = displayNameSchema.safeParse(storedValue)

    if (!parsed.success) {
      storage.removeItem(DISPLAY_NAME_STORAGE_KEY)
      return null
    }

    return parsed.data
  } catch {
    return null
  }
}

export const writeStoredDisplayName = (
  value: string,
  storage: DisplayNameStorage | null = getBrowserStorage()
) => {
  if (!storage) {
    return false
  }

  try {
    storage.setItem(DISPLAY_NAME_STORAGE_KEY, value)
    return true
  } catch {
    return false
  }
}

export const clearStoredDisplayName = (storage: DisplayNameStorage | null = getBrowserStorage()) => {
  if (!storage) {
    return
  }

  try {
    storage.removeItem(DISPLAY_NAME_STORAGE_KEY)
  } catch {
    // Intentionally ignore storage failures so identity remains usable in-memory.
  }
}