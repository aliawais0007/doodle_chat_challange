import { describe, expect, it } from 'vitest'

import { validateEnv } from '@shared/config/env'

describe('validateEnv', () => {
  it('returns validated environment values', () => {
    const result = validateEnv({
      VITE_API_BASE_URL: 'http://localhost:3000/api/v1',
      VITE_API_TOKEN: 'test-token',
    })

    expect(result).toEqual({
      VITE_API_BASE_URL: 'http://localhost:3000/api/v1',
      VITE_API_TOKEN: 'test-token',
    })
  })

  it('throws for invalid API URL', () => {
    expect(() => {
      validateEnv({
        VITE_API_BASE_URL: 'not-a-url',
        VITE_API_TOKEN: 'test-token',
      })
    }).toThrow('VITE_API_BASE_URL must be a valid URL')
  })

  it('throws for missing API token', () => {
    expect(() => {
      validateEnv({
        VITE_API_BASE_URL: 'http://localhost:3000/api/v1',
        VITE_API_TOKEN: '',
      })
    }).toThrow('VITE_API_TOKEN is required')
  })
})
