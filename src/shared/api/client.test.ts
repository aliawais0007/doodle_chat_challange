import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'

import { getMessages, createMessage } from '@shared/api/client'
import { createMessageInputSchema } from '@shared/api/contracts'
import { API_ERROR_CATEGORIES } from '@shared/api/errors'
import { makeMessage } from '@test/factories'
import { server } from '@test/server'

const { mockGetEnv } = vi.hoisted(() => {
  return {
    mockGetEnv: vi.fn(() => ({
      VITE_API_BASE_URL: 'http://localhost:3000/api/v1',
      VITE_API_TOKEN: 'test-token',
    })),
  }
})

vi.mock('@shared/config/env', () => {
  return {
    getEnv: mockGetEnv,
  }
})

const messagesEndpoint = 'http://localhost:3000/api/v1/messages'

describe('api client', () => {
  it('handles a basic GET request', async () => {
    server.use(
      http.get(messagesEndpoint, () => {
        return HttpResponse.json([makeMessage()])
      })
    )

    await expect(getMessages()).resolves.toHaveLength(1)
  })

  it('sends the limit query parameter', async () => {
    server.use(
      http.get(messagesEndpoint, ({ request }) => {
        expect(new URL(request.url).searchParams.get('limit')).toBe('2')

        return HttpResponse.json([makeMessage(), makeMessage()])
      })
    )

    await expect(getMessages({ limit: 2 })).resolves.toHaveLength(2)
  })

  it('sends the before query parameter', async () => {
    const before = '2026-01-01T12:00:00.000Z'

    server.use(
      http.get(messagesEndpoint, ({ request }) => {
        expect(new URL(request.url).searchParams.get('before')).toBe(before)

        return HttpResponse.json([makeMessage()])
      })
    )

    await expect(getMessages({ before })).resolves.toHaveLength(1)
  })

  it('sends the after query parameter', async () => {
    const after = '2026-01-01T12:00:00.000Z'

    server.use(
      http.get(messagesEndpoint, ({ request }) => {
        expect(new URL(request.url).searchParams.get('after')).toBe(after)

        return HttpResponse.json([makeMessage()])
      })
    )

    await expect(getMessages({ after })).resolves.toHaveLength(1)
  })

  it('handles a successful POST request', async () => {
    server.use(
      http.post(messagesEndpoint, async ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer test-token')
        expect(request.headers.get('accept')).toBe('application/json')
        expect(request.headers.get('content-type')).toContain('application/json')

        const body = createMessageInputSchema.parse(await request.json())
        expect(body).toEqual({ message: 'Hello world', author: 'John Doe' })

        return HttpResponse.json(makeMessage({ message: body.message, author: body.author }), {
          status: 201,
        })
      })
    )

    await expect(createMessage({ message: 'Hello world', author: 'John Doe' })).resolves.toMatchObject(
      {
        message: 'Hello world',
        author: 'John Doe',
      }
    )
  })

  it('categorizes POST 401 responses as unauthorized', async () => {
    server.use(
      http.post(messagesEndpoint, () => {
        return HttpResponse.json(
          {
            message: 'Invalid token',
            statusCode: 401,
            error: 'Unauthorized',
          },
          { status: 401 }
        )
      })
    )

    await expect(createMessage({ message: 'Hello world', author: 'John Doe' })).rejects.toMatchObject(
      {
        category: API_ERROR_CATEGORIES.unauthorized,
        message: 'Invalid token',
        statusCode: 401,
      }
    )
  })

  it('categorizes POST 500 responses as server errors', async () => {
    server.use(
      http.post(messagesEndpoint, () => {
        return HttpResponse.json(
          {
            error: {
              message: 'Internal Server Error',
              timestamp: '2026-01-01T12:00:00.000Z',
            },
          },
          { status: 500 }
        )
      })
    )

    await expect(createMessage({ message: 'Hello world', author: 'John Doe' })).rejects.toMatchObject(
      {
        category: API_ERROR_CATEGORIES.server,
        message: 'Internal Server Error',
        statusCode: 500,
      }
    )
  })

  it('categorizes malformed POST responses distinctly', async () => {
    server.use(
      http.post(messagesEndpoint, () => {
        return HttpResponse.json({
          _id: 'not-a-uuid',
          message: 'Hello world',
          author: 'John Doe',
          createdAt: '2026-01-01T12:30:00.000Z',
        })
      })
    )

    await expect(createMessage({ message: 'Hello world', author: 'John Doe' })).rejects.toMatchObject(
      {
        category: API_ERROR_CATEGORIES.malformedResponse,
        message: 'Response body did not match the expected API contract',
        statusCode: 200,
      }
    )
  })

  it('categorizes POST network failures distinctly', async () => {
    server.use(
      http.post(messagesEndpoint, () => {
        return HttpResponse.error()
      })
    )

    await expect(createMessage({ message: 'Hello world', author: 'John Doe' })).rejects.toMatchObject(
      {
        category: API_ERROR_CATEGORIES.network,
        message: 'Network request failed',
      }
    )
  })

  it('categorizes 401 responses as unauthorized', async () => {
    server.use(
      http.get(messagesEndpoint, () => {
        return HttpResponse.json(
          {
            message: 'Invalid token',
            statusCode: 401,
            error: 'Unauthorized',
          },
          { status: 401 }
        )
      })
    )

    await expect(getMessages()).rejects.toMatchObject({
      category: API_ERROR_CATEGORIES.unauthorized,
      message: 'Invalid token',
      statusCode: 401,
    })
  })

  it('categorizes 500 responses as server errors', async () => {
    server.use(
      http.get(messagesEndpoint, () => {
        return HttpResponse.json(
          {
            error: {
              message: 'Internal Server Error',
              timestamp: '2026-01-01T12:00:00.000Z',
            },
          },
          { status: 500 }
        )
      })
    )

    await expect(getMessages()).rejects.toMatchObject({
      category: API_ERROR_CATEGORIES.server,
      message: 'Internal Server Error',
      statusCode: 500,
    })
  })

  it('categorizes malformed responses distinctly', async () => {
    server.use(
      http.get(messagesEndpoint, () => {
        return HttpResponse.json([
          makeMessage({ _id: 'not-a-uuid' }),
        ])
      })
    )

    await expect(getMessages()).rejects.toMatchObject({
      category: API_ERROR_CATEGORIES.malformedResponse,
      message: 'Response body did not match the expected API contract',
      statusCode: 200,
    })
  })

  it('categorizes aborted requests distinctly', async () => {
    server.use(
      http.get(messagesEndpoint, async () => {
        await delay(100)
        return HttpResponse.json([makeMessage()])
      })
    )

    const controller = new AbortController()
    const request = getMessages(undefined, { signal: controller.signal })

    controller.abort()

    await expect(request).rejects.toMatchObject({
      category: API_ERROR_CATEGORIES.aborted,
      message: 'Request was aborted',
    })
  })

  it('categorizes network failures distinctly', async () => {
    server.use(
      http.get(messagesEndpoint, () => {
        return HttpResponse.error()
      })
    )

    await expect(getMessages()).rejects.toMatchObject({
      category: API_ERROR_CATEGORIES.network,
      message: 'Network request failed',
    })
  })

  it('categorizes invalid runtime configuration distinctly', async () => {
    mockGetEnv.mockImplementation(() => {
      throw new Error('Invalid environment configuration: VITE_API_BASE_URL: Invalid url')
    })

    await expect(getMessages()).rejects.toMatchObject({
      category: API_ERROR_CATEGORIES.configuration,
      message: 'Chat configuration is invalid. Check the API settings and reload the page.',
    })

    mockGetEnv.mockReturnValue({
      VITE_API_BASE_URL: 'http://localhost:3000/api/v1',
      VITE_API_TOKEN: 'test-token',
    })
  })
})