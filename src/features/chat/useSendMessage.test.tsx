import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSendMessage } from '@features/chat/useSendMessage'
import { useMessageHistory } from '@features/chat/useMessageHistory'
import { DisplayNameProvider } from '@features/identity'
import { API_ERROR_CATEGORIES } from '@shared/api/errors'
import { makeMessage } from '@test/factories'
import { createTestQueryClient } from '@test/renderWithProviders'
import { server } from '@test/server'

const messagesEndpoint = 'http://localhost:3000/api/v1/messages'

const mockUuid = vi.fn<() => string>()

vi.stubGlobal('crypto', {
  randomUUID: () => mockUuid(),
})

const renderSharedHooks = (options: { syncEnabled?: boolean } = {}) => {
  const queryClient = createTestQueryClient()
  const wrapper = ({ children }: PropsWithChildren) => {
    return (
      <QueryClientProvider client={queryClient}>
        <DisplayNameProvider>{children}</DisplayNameProvider>
      </QueryClientProvider>
    )
  }

  const syncEnabled = options.syncEnabled ?? false

  return {
    queryClient,
    sendResult: renderHook(() => useSendMessage(), { wrapper }).result,
    historyResult: renderHook(() => useMessageHistory({ syncEnabled }), { wrapper }).result,
  }
}

describe('useSendMessage', () => {
  beforeEach(() => {
    mockUuid.mockReset()
    mockUuid.mockReturnValue('client-1')

    server.use(
      http.get(messagesEndpoint, () => {
        return HttpResponse.json([])
      })
    )
  })

  it('shows an optimistic message immediately', async () => {
    let releaseRequest: (() => void) | undefined

    server.use(
      http.post(messagesEndpoint, async () => {
        await new Promise<void>((resolve) => {
          releaseRequest = resolve
        })

        return HttpResponse.json(
          makeMessage({
            _id: '00000000-0000-4000-8000-000000000111',
            message: 'Hello world',
            author: 'Alex',
            createdAt: '2026-01-01T10:01:00.000Z',
          }),
          { status: 201 }
        )
      })
    )

    const { sendResult, historyResult } = renderSharedHooks()

    const sendPromise = sendResult.current.sendMessage({ message: 'Hello world', author: 'Alex' })

    await waitFor(() => {
      expect(historyResult.current.messages).toHaveLength(1)
      expect(historyResult.current.messages[0]).toMatchObject({
        kind: 'optimistic',
        clientId: 'client-1',
        deliveryStatus: 'sending',
        message: 'Hello world',
      })
    })

    if (releaseRequest) {
      releaseRequest()
    }
    await act(async () => {
      await sendPromise
    })
  })

  it('reconciles optimistic message on success', async () => {
    server.use(
      http.post(messagesEndpoint, () => {
        return HttpResponse.json(
          makeMessage({
            _id: '00000000-0000-4000-8000-000000000111',
            message: 'Hello world',
            author: 'Alex',
            createdAt: '2026-01-01T10:01:00.000Z',
          }),
          { status: 201 }
        )
      })
    )

    const { sendResult, historyResult } = renderSharedHooks()

    await act(async () => {
      await sendResult.current.sendMessage({ message: 'Hello world', author: 'Alex' })
    })

    await waitFor(() => {
      expect(historyResult.current.messages).toHaveLength(1)
      expect(historyResult.current.messages[0]).toMatchObject({
        kind: 'persisted',
        _id: '00000000-0000-4000-8000-000000000111',
        createdAt: '2026-01-01T10:01:00.000Z',
      })
    })
  })

  it('marks optimistic message as failed on error and preserves it', async () => {
    server.use(
      http.post(messagesEndpoint, () => {
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

    const { sendResult, historyResult } = renderSharedHooks()

    await act(async () => {
      await expect(
        sendResult.current.sendMessage({ message: 'Hello world', author: 'Alex' })
      ).rejects.toMatchObject({
        category: API_ERROR_CATEGORIES.server,
      })
    })

    await waitFor(() => {
      expect(historyResult.current.messages[0]).toMatchObject({
        kind: 'optimistic',
        clientId: 'client-1',
        deliveryStatus: 'failed',
        errorMessage: 'Internal Server Error',
      })
    })
  })

  it('retries a failed optimistic message', async () => {
    let shouldFail = true

    server.use(
      http.post(messagesEndpoint, () => {
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

        return HttpResponse.json(
          makeMessage({
            _id: '00000000-0000-4000-8000-000000000222',
            message: 'Retry me',
            author: 'Alex',
            createdAt: '2026-01-01T10:05:00.000Z',
          }),
          { status: 201 }
        )
      })
    )

    const { sendResult, historyResult } = renderSharedHooks()

    await act(async () => {
      await expect(
        sendResult.current.sendMessage({ message: 'Retry me', author: 'Alex' })
      ).rejects.toBeDefined()
    })

    shouldFail = false

    await waitFor(() => {
      expect(historyResult.current.messages[0]).toMatchObject({
        kind: 'optimistic',
        deliveryStatus: 'failed',
      })
    })

    const failedMessage = historyResult.current.messages[0]

    if (failedMessage?.kind !== 'optimistic' || failedMessage.deliveryStatus !== 'failed') {
      throw new Error('Expected an optimistic failed message before retrying')
    }

    await act(async () => {
      await sendResult.current.retryFailedMessage(failedMessage)
    })

    await waitFor(() => {
      expect(historyResult.current.messages[0]).toMatchObject({
        kind: 'persisted',
        _id: '00000000-0000-4000-8000-000000000222',
      })
    })
  })

  it('removes a failed optimistic message', async () => {
    server.use(
      http.post(messagesEndpoint, () => {
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

    const { sendResult, historyResult } = renderSharedHooks()

    await act(async () => {
      await expect(
        sendResult.current.sendMessage({ message: 'Remove me', author: 'Alex' })
      ).rejects.toBeDefined()
    })

    act(() => {
      sendResult.current.removeFailedMessage('client-1')
    })

    await waitFor(() => {
      expect(historyResult.current.messages).toEqual([])
    })
  })

  it('supports concurrent sends and reversed response order safely', async () => {
    let resolveFirst: (() => void) | undefined
    let resolveSecond: (() => void) | undefined

    mockUuid.mockReturnValueOnce('client-1').mockReturnValueOnce('client-2')

    server.use(
      http.post(messagesEndpoint, async ({ request }) => {
        const body = (await request.json()) as { message: string }

        if (body.message === 'First') {
          await new Promise<void>((resolve) => {
            resolveFirst = resolve
          })

          return HttpResponse.json(
            makeMessage({
              _id: '00000000-0000-4000-8000-000000000111',
              message: 'First',
              author: 'Alex',
              createdAt: '2026-01-01T10:00:02.000Z',
            }),
            { status: 201 }
          )
        }

        await new Promise<void>((resolve) => {
          resolveSecond = resolve
        })

        return HttpResponse.json(
          makeMessage({
            _id: '00000000-0000-4000-8000-000000000222',
            message: 'Second',
            author: 'Alex',
            createdAt: '2026-01-01T10:00:01.000Z',
          }),
          { status: 201 }
        )
      })
    )

    const { sendResult, historyResult } = renderSharedHooks()

    const firstPromise = sendResult.current.sendMessage({ message: 'First', author: 'Alex' })
    const secondPromise = sendResult.current.sendMessage({ message: 'Second', author: 'Alex' })

    await waitFor(() => {
      expect(historyResult.current.messages).toHaveLength(2)
    })

    if (resolveSecond) {
      resolveSecond()
    }
    await secondPromise

    if (resolveFirst) {
      resolveFirst()
    }
    await firstPromise

    await waitFor(() => {
      expect(historyResult.current.messages).toHaveLength(2)
      expect(historyResult.current.messages.map((message) => message.message)).toEqual([
        'Second',
        'First',
      ])
    })
  })

  it('deduplicates when persisted history later contains the reconciled message', async () => {
    server.use(
      http.post(messagesEndpoint, () => {
        return HttpResponse.json(
          makeMessage({
            _id: '00000000-0000-4000-8000-000000000333',
            message: 'Hello world',
            author: 'Alex',
            createdAt: '2026-01-01T10:01:00.000Z',
          }),
          { status: 201 }
        )
      }),
      http.get(messagesEndpoint, () => {
        return HttpResponse.json([
          makeMessage({
            _id: '00000000-0000-4000-8000-000000000333',
            message: 'Hello world',
            author: 'Alex',
            createdAt: '2026-01-01T10:01:00.000Z',
          }),
        ])
      })
    )

    const { sendResult, historyResult } = renderSharedHooks()

    await act(async () => {
      await sendResult.current.sendMessage({ message: 'Hello world', author: 'Alex' })
    })

    await waitFor(() => {
      expect(historyResult.current.messages).toHaveLength(1)
    })
  })

  it('does not show duplicate optimistic and persisted copies when sync returns before POST resolves', async () => {
    let releasePost: (() => void) | undefined
    let shouldReturnSyncedMessage = false

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    })

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => true,
    })

    mockUuid.mockReturnValue('client-race-1')

    server.use(
      http.get(messagesEndpoint, ({ request }) => {
        const after = new URL(request.url).searchParams.get('after')

        if (!after) {
          return HttpResponse.json([
            makeMessage({
              _id: '00000000-0000-4000-8000-000000000100',
              author: 'Taylor',
              message: 'Existing baseline',
              createdAt: '2026-01-01T10:00:00.000Z',
            }),
          ])
        }

        if (!shouldReturnSyncedMessage) {
          return HttpResponse.json([])
        }

        return HttpResponse.json([
          makeMessage({
            _id: '00000000-0000-4000-8000-000000000200',
            author: 'Alex',
            message: 'Race message',
            createdAt: '2026-01-01T10:00:01.000Z',
          }),
        ])
      }),
      http.post(messagesEndpoint, async () => {
        await new Promise<void>((resolve) => {
          releasePost = resolve
        })

        return HttpResponse.json(
          makeMessage({
            _id: '00000000-0000-4000-8000-000000000200',
            author: 'Alex',
            message: 'Race message',
            createdAt: '2026-01-01T10:00:01.000Z',
          }),
          { status: 201 }
        )
      })
    )

    const { sendResult, historyResult } = renderSharedHooks({ syncEnabled: true })

    await waitFor(() => {
      expect(historyResult.current.messages).toHaveLength(1)
    })

    const sendPromise = sendResult.current.sendMessage({ message: 'Race message', author: 'Alex' })

    await waitFor(() => {
      expect(historyResult.current.messages.some((message) => message.kind === 'optimistic')).toBe(
        true
      )
    })

    shouldReturnSyncedMessage = true

    await waitFor(
      () => {
        const raceMessages = historyResult.current.messages.filter((message) => {
          return message.message === 'Race message'
        })

        expect(raceMessages).toHaveLength(1)
      },
      { timeout: 5000 }
    )

    if (releasePost) {
      releasePost()
    }

    await act(async () => {
      await sendPromise
    })
  })
})
