import { describe, expect, it } from 'vitest'

import {
  cursorRequestParamsSchema,
  parseApiMessage,
  parseCreateMessageInput,
} from '@shared/api/contracts'

describe('api contracts', () => {
  it('parses a valid message', () => {
    const parsed = parseApiMessage({
      _id: '123e4567-e89b-12d3-a456-426614174000',
      message: 'Hello world',
      author: 'John Doe',
      createdAt: '2026-01-01T12:30:00.000Z',
    })

    expect(parsed._id).toBe('123e4567-e89b-12d3-a456-426614174000')
    expect(parsed.message).toBe('Hello world')
  })

  it('rejects malformed ID', () => {
    expect(() => {
      parseApiMessage({
        _id: 'not-a-uuid',
        message: 'Hello world',
        author: 'John Doe',
        createdAt: '2026-01-01T12:30:00.000Z',
      })
    }).toThrow('Message _id must be a valid UUID')
  })

  it('rejects malformed date', () => {
    expect(() => {
      parseApiMessage({
        _id: '123e4567-e89b-12d3-a456-426614174000',
        message: 'Hello world',
        author: 'John Doe',
        createdAt: 'not-a-date',
      })
    }).toThrow('createdAt must be a valid ISO datetime string')
  })

  it('rejects missing field', () => {
    expect(() => {
      parseApiMessage({
        _id: '123e4567-e89b-12d3-a456-426614174000',
        message: 'Hello world',
        author: 'John Doe',
      })
    }).toThrow()
  })

  it('rejects invalid create-message input', () => {
    expect(() => {
      parseCreateMessageInput({
        message: '   ',
        author: 'John Doe',
      })
    }).toThrow('Message cannot be empty')
  })

  it('rejects invalid author', () => {
    expect(() => {
      parseCreateMessageInput({
        message: 'Hello world',
        author: 'John@Doe',
      })
    }).toThrow('Author can only contain letters, numbers, spaces, hyphens, and underscores')
  })

  it('rejects message over 500 characters', () => {
    expect(() => {
      parseCreateMessageInput({
        message: 'a'.repeat(501),
        author: 'John Doe',
      })
    }).toThrow('Message cannot exceed 500 characters')
  })

  it('rejects combined before and after', () => {
    const result = cursorRequestParamsSchema.safeParse({
      limit: 10,
      before: '2026-01-01T12:00:00.000Z',
      after: '2026-01-01T10:00:00.000Z',
    })

    expect(result.success).toBe(false)

    if (result.success) {
      throw new Error('Expected schema validation to fail for combined cursors')
    }

    expect(result.error.issues[0]?.message).toBe(
      'Cannot use both "after" and "before" parameters simultaneously.'
    )
  })
})
