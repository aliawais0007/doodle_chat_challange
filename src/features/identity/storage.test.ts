import { describe, expect, it, vi } from 'vitest'

import {
  DISPLAY_NAME_STORAGE_KEY,
  clearStoredDisplayName,
  readStoredDisplayName,
  writeStoredDisplayName,
  type DisplayNameStorage,
} from '@features/identity'

const createStorage = (initialValue: string | null): DisplayNameStorage => {
  let storedValue = initialValue

  return {
    getItem: vi.fn((key: string) => {
      return key === DISPLAY_NAME_STORAGE_KEY ? storedValue : null
    }),
    setItem: vi.fn((key: string, value: string) => {
      if (key === DISPLAY_NAME_STORAGE_KEY) {
        storedValue = value
      }
    }),
    removeItem: vi.fn((key: string) => {
      if (key === DISPLAY_NAME_STORAGE_KEY) {
        storedValue = null
      }
    }),
  }
}

describe('identity storage', () => {
  it('reads a valid stored display name', () => {
    const storage = createStorage('Awais')

    expect(readStoredDisplayName(storage)).toBe('Awais')
  })

  it('recovers from corrupt stored data', () => {
    const storage = createStorage('@@@')

    expect(readStoredDisplayName(storage)).toBeNull()
    expect(storage.removeItem).toHaveBeenCalledWith(DISPLAY_NAME_STORAGE_KEY)
  })

  it('tolerates localStorage read failures', () => {
    const storage: DisplayNameStorage = {
      getItem: vi.fn(() => {
        throw new Error('storage unavailable')
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }

    expect(readStoredDisplayName(storage)).toBeNull()
  })

  it('tolerates localStorage write failures', () => {
    const storage: DisplayNameStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(() => {
        throw new Error('storage unavailable')
      }),
      removeItem: vi.fn(),
    }

    expect(writeStoredDisplayName('Awais', storage)).toBe(false)
  })

  it('clears stored display name without throwing on failure', () => {
    const storage: DisplayNameStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(() => {
        throw new Error('storage unavailable')
      }),
    }

    expect(() => {
      clearStoredDisplayName(storage)
    }).not.toThrow()
  })
})