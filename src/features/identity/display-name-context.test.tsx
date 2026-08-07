import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useDisplayName } from '@features/identity'
import { renderHookWithProviders } from '@test/renderWithProviders'

describe('useDisplayName', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('starts with required dialog open when no stored name exists', () => {
    const { result } = renderHookWithProviders(() => useDisplayName())

    expect(result.current.displayName).toBeNull()
    expect(result.current.isDialogOpen).toBe(true)
    expect(result.current.isRequired).toBe(true)
  })

  it('loads a valid stored display name', () => {
    window.localStorage.setItem('doodle-chat.display-name', 'Awais')

    const { result } = renderHookWithProviders(() => useDisplayName())

    expect(result.current.displayName).toBe('Awais')
    expect(result.current.isDialogOpen).toBe(false)
  })

  it('saves a valid display name and persists it', () => {
    const { result } = renderHookWithProviders(() => useDisplayName())

    act(() => {
      const saveResult = result.current.saveDisplayName('  Awais  ')
      expect(saveResult).toEqual({ success: true, value: 'Awais' })
    })

    expect(result.current.displayName).toBe('Awais')
    expect(window.localStorage.getItem('doodle-chat.display-name')).toBe('Awais')
    expect(result.current.isDialogOpen).toBe(false)
  })

  it('returns validation errors for invalid names', () => {
    const { result } = renderHookWithProviders(() => useDisplayName())

    act(() => {
      const saveResult = result.current.saveDisplayName('@@@')
      expect(saveResult).toEqual({
        success: false,
        error: 'Display name can only contain letters, numbers, spaces, hyphens, and underscores',
      })
    })

    expect(result.current.displayName).toBeNull()
    expect(result.current.isDialogOpen).toBe(true)
  })
})
