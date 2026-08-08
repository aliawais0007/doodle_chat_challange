import { act, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { useMessageHistory } from '@features/chat/useMessageHistory'
import { API_ERROR_CATEGORIES } from '@shared/api/errors'
import { makeMessage } from '@test/factories'
import { renderHookWithProviders } from '@test/renderWithProviders'
import { server } from '@test/server'

const messagesEndpoint = 'http://localhost:3000/api/v1/messages'

describe('useMessageHistory', () => {
  it('loads the initial recent page', async () => {
    server.use(
      http.get(messagesEndpoint, () => {
        return HttpResponse.json([
          makeMessage({ createdAt: '2026-01-01T10:00:00.000Z' }),
          makeMessage({
            _id: '00000000-0000-4000-8000-000000000002',
            createdAt: '2026-01-01T10:05:00.000Z',
          }),
        ])
      })
    )

    const { result } = renderHookWithProviders(() => useMessageHistory({ pageSize: 2 }))

    expect(result.current.initialLoading).toBe(true)

    await waitFor(() => {
      expect(result.current.initialLoading).toBe(false)
    })

    expect(result.current.messages).toHaveLength(2)
    expect(result.current.initialError).toBeNull()
  })

  it('handles an empty initial history page', async () => {
    server.use(
      http.get(messagesEndpoint, () => {
        return HttpResponse.json([])
      })
    )

    const { result } = renderHookWithProviders(() => useMessageHistory({ pageSize: 2 }))

    await waitFor(() => {
      expect(result.current.initialLoading).toBe(false)
    })

    expect(result.current.messages).toEqual([])
    expect(result.current.hasOlderMessages).toBe(false)
    expect(result.current.initialError).toBeNull()
  })

  it('derives chronological ordering correctly from loaded pages', async () => {
    server.use(
      http.get(messagesEndpoint, ({ request }) => {
        const before = new URL(request.url).searchParams.get('before')

        if (!before) {
          return HttpResponse.json([
            makeMessage({
              _id: '00000000-0000-4000-8000-000000000010',
              createdAt: '2026-01-01T10:10:00.000Z',
            }),
            makeMessage({
              _id: '00000000-0000-4000-8000-000000000011',
              createdAt: '2026-01-01T10:20:00.000Z',
            }),
          ])
        }

        return HttpResponse.json([
          makeMessage({
            _id: '00000000-0000-4000-8000-000000000001',
            createdAt: '2026-01-01T09:00:00.000Z',
          }),
          makeMessage({
            _id: '00000000-0000-4000-8000-000000000002',
            createdAt: '2026-01-01T09:30:00.000Z',
          }),
        ])
      })
    )

    const { result } = renderHookWithProviders(() => useMessageHistory({ pageSize: 2 }))

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2)
    })

    await act(async () => {
      await result.current.loadOlder()
    })

    await waitFor(() => {
      expect(result.current.messages.map((message) => message.createdAt)).toEqual([
        '2026-01-01T09:00:00.000Z',
        '2026-01-01T09:30:00.000Z',
        '2026-01-01T10:10:00.000Z',
        '2026-01-01T10:20:00.000Z',
      ])
    })
  })

  it('paginates older messages using strict before cursor', async () => {
    let capturedBefore: string | null = null

    server.use(
      http.get(messagesEndpoint, ({ request }) => {
        const before = new URL(request.url).searchParams.get('before')

        if (!before) {
          return HttpResponse.json([
            makeMessage({ createdAt: '2026-01-01T10:10:00.000Z' }),
            makeMessage({
              _id: '00000000-0000-4000-8000-000000000002',
              createdAt: '2026-01-01T10:20:00.000Z',
            }),
          ])
        }

        capturedBefore = before

        return HttpResponse.json([
          makeMessage({
            _id: '00000000-0000-4000-8000-000000000003',
            createdAt: '2026-01-01T09:00:00.000Z',
          }),
        ])
      })
    )

    const { result } = renderHookWithProviders(() => useMessageHistory({ pageSize: 2 }))

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2)
    })

    await act(async () => {
      await result.current.loadOlder()
    })

    expect(capturedBefore).toBe('2026-01-01T10:10:00.000Z')
  })

  it('preserves correct page ordering when flattening', async () => {
    server.use(
      http.get(messagesEndpoint, ({ request }) => {
        const before = new URL(request.url).searchParams.get('before')

        if (!before) {
          return HttpResponse.json([
            makeMessage({
              _id: '00000000-0000-4000-8000-000000000010',
              createdAt: '2026-01-03T10:00:00.000Z',
            }),
            makeMessage({
              _id: '00000000-0000-4000-8000-000000000011',
              createdAt: '2026-01-03T10:05:00.000Z',
            }),
          ])
        }

        return HttpResponse.json([
          makeMessage({
            _id: '00000000-0000-4000-8000-000000000001',
            createdAt: '2026-01-02T10:00:00.000Z',
          }),
          makeMessage({
            _id: '00000000-0000-4000-8000-000000000002',
            createdAt: '2026-01-02T10:05:00.000Z',
          }),
        ])
      })
    )

    const { result } = renderHookWithProviders(() => useMessageHistory({ pageSize: 2 }))

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2)
    })

    await act(async () => {
      await result.current.loadOlder()
    })

    await waitFor(() => {
      expect(
        result.current.messages
          .filter((message) => message.kind === 'persisted')
          .map((message) => message._id)
      ).toEqual([
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000010',
        '00000000-0000-4000-8000-000000000011',
      ])
    })
  })

  it('stops pagination when the oldest page is shorter than page size', async () => {
    server.use(
      http.get(messagesEndpoint, ({ request }) => {
        const before = new URL(request.url).searchParams.get('before')

        if (!before) {
          return HttpResponse.json([
            makeMessage({ createdAt: '2026-01-01T10:10:00.000Z' }),
            makeMessage({
              _id: '00000000-0000-4000-8000-000000000002',
              createdAt: '2026-01-01T10:20:00.000Z',
            }),
          ])
        }

        return HttpResponse.json([
          makeMessage({
            _id: '00000000-0000-4000-8000-000000000003',
            createdAt: '2026-01-01T09:00:00.000Z',
          }),
        ])
      })
    )

    const { result } = renderHookWithProviders(() => useMessageHistory({ pageSize: 2 }))

    await waitFor(() => {
      expect(result.current.hasOlderMessages).toBe(true)
    })

    await act(async () => {
      await result.current.loadOlder()
    })

    await waitFor(() => {
      expect(result.current.hasOlderMessages).toBe(false)
    })
  })

  it('supports retry after an initial error', async () => {
    let shouldFail = true

    server.use(
      http.get(messagesEndpoint, () => {
        if (shouldFail) {
          return HttpResponse.json(
            {
              error: {
                message: 'Internal Server Error',
                timestamp: '2026-01-01T10:00:00.000Z',
              },
            },
            { status: 500 }
          )
        }

        return HttpResponse.json([makeMessage()])
      })
    )

    const { result } = renderHookWithProviders(() => useMessageHistory({ pageSize: 2 }))

    await waitFor(() => {
      expect(result.current.initialError?.category).toBe(API_ERROR_CATEGORIES.server)
    })

    shouldFail = false

    await act(async () => {
      await result.current.retry()
    })

    await waitFor(() => {
      expect(result.current.initialError).toBeNull()
      expect(result.current.messages).toHaveLength(1)
    })
  })

  it('preserves current history when loading an older page fails', async () => {
    server.use(
      http.get(messagesEndpoint, ({ request }) => {
        const before = new URL(request.url).searchParams.get('before')

        if (!before) {
          return HttpResponse.json([
            makeMessage({ createdAt: '2026-01-01T10:10:00.000Z' }),
            makeMessage({
              _id: '00000000-0000-4000-8000-000000000002',
              createdAt: '2026-01-01T10:20:00.000Z',
            }),
          ])
        }

        return HttpResponse.json(
          {
            error: {
              message: 'Internal Server Error',
              timestamp: '2026-01-01T10:00:00.000Z',
            },
          },
          { status: 500 }
        )
      })
    )

    const { result } = renderHookWithProviders(() => useMessageHistory({ pageSize: 2 }))

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2)
    })

    const currentIds = result.current.messages
      .filter((message) => message.kind === 'persisted')
      .map((message) => message._id)

    await act(async () => {
      await result.current.loadOlder().catch(() => {
        return undefined
      })
    })

    await waitFor(() => {
      expect(result.current.loadOlderError?.category).toBe(API_ERROR_CATEGORIES.server)
    })

    expect(
      result.current.messages
        .filter((message) => message.kind === 'persisted')
        .map((message) => message._id)
    ).toEqual(currentIds)
  })
})