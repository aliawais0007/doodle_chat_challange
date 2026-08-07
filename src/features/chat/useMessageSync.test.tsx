import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { chatQueryKeys } from '@features/chat/query-keys'
import { useMessageSync } from '@features/chat/useMessageSync'
import type { ApiMessage } from '@shared/api/contracts'
import { makeMessage } from '@test/factories'
import { server } from '@test/server'

const messagesEndpoint = 'http://localhost:3000/api/v1/messages'
const historyQueryKey = chatQueryKeys.history(50)

const setHistoryData = (messagesByPage: ApiMessage[][]) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Number.POSITIVE_INFINITY,
        staleTime: 0,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
  const initialData: InfiniteData<ApiMessage[]> = {
    pageParams: messagesByPage.map(() => undefined),
    pages: messagesByPage,
  }

  queryClient.setQueryData(historyQueryKey, initialData)

  return queryClient
}

describe('useMessageSync', () => {
  let hidden = false
  let online = true

  const settleAsyncWork = async () => {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    hidden = false
    online = true

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    })

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => online,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits for history success enablement, then polls with after and limit 100', async () => {
    vi.useFakeTimers()

    const newestTimestamp = '2026-01-01T10:20:00.000Z'
    const expectedAfterCursor = new Date(Date.parse(newestTimestamp) - 1).toISOString()
    const capturedAfter: Array<string | null> = []
    const capturedLimit: Array<string | null> = []
    const olderPage = [
      makeMessage({
        _id: '00000000-0000-4000-8000-000000000001',
        createdAt: '2026-01-01T09:00:00.000Z',
      }),
    ]
    const newestPage = [
      makeMessage({
        _id: '00000000-0000-4000-8000-000000000010',
        createdAt: newestTimestamp,
      }),
    ]

    server.use(
      http.get(messagesEndpoint, ({ request }) => {
        const url = new URL(request.url)
        capturedAfter.push(url.searchParams.get('after'))
        capturedLimit.push(url.searchParams.get('limit'))

        return HttpResponse.json([
          makeMessage({
            _id: '00000000-0000-4000-8000-000000000010',
            createdAt: newestTimestamp,
          }),
          makeMessage({
            _id: '00000000-0000-4000-8000-000000000011',
            createdAt: '2026-01-01T10:30:00.000Z',
            message: 'new remote message',
          }),
        ])
      })
    )

    const queryClient = setHistoryData([olderPage, newestPage])
    const wrapper = ({ children }: PropsWithChildren) => {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }

    const { result, rerender } = renderHook(
      ({ enabled }) => {
        return useMessageSync({
          historyQueryKey,
          enabled,
          newestPersistedTimestamp: newestTimestamp,
        })
      },
      {
        wrapper,
        initialProps: { enabled: false },
      }
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(capturedAfter).toEqual([])
    expect(result.current.syncState).toBe('idle')

    rerender({ enabled: true })
    await settleAsyncWork()

    expect(capturedAfter).toEqual([expectedAfterCursor])
    expect(capturedLimit).toEqual(['100'])
    expect(result.current.syncState).toBe('idle')

    const historyData = queryClient.getQueryData<InfiniteData<ApiMessage[]>>(historyQueryKey)

    expect(historyData).toBeDefined()
    if (!historyData) {
      throw new Error('Expected history data to exist after sync merge')
    }

    expect(historyData.pages).toHaveLength(2)
    expect(historyData.pages[0]?.map((message) => message._id)).toEqual([
      '00000000-0000-4000-8000-000000000001',
    ])
    expect(historyData.pages[1]?.map((message) => message._id)).toEqual([
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000011',
    ])
  })

  it('does not duplicate a previously merged remote message on repeated polls', async () => {
    vi.useFakeTimers()

    const newestTimestamp = '2026-01-01T10:20:00.000Z'
    const expectedAfterCursor = new Date(Date.parse(newestTimestamp) - 1).toISOString()
    let requestCount = 0

    const remoteMessage = makeMessage({
      _id: '00000000-0000-4000-8000-000000000050',
      createdAt: '2026-01-01T10:30:00.000Z',
      message: 'new remote message',
    })

    server.use(
      http.get(messagesEndpoint, ({ request }) => {
        const url = new URL(request.url)
        requestCount += 1

        if (requestCount === 1) {
          expect(url.searchParams.get('after')).toBe(expectedAfterCursor)
          return HttpResponse.json([remoteMessage])
        }

        expect(url.searchParams.get('after')).toBe(expectedAfterCursor)
        return HttpResponse.json([remoteMessage])
      })
    )

    const queryClient = setHistoryData([
      [
        makeMessage({
          _id: '00000000-0000-4000-8000-000000000010',
          createdAt: newestTimestamp,
        }),
      ],
    ])

    const wrapper = ({ children }: PropsWithChildren) => {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }

    renderHook(
      () => {
        return useMessageSync({
          historyQueryKey,
          enabled: true,
          newestPersistedTimestamp: newestTimestamp,
        })
      },
      { wrapper }
    )

    await settleAsyncWork()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    await settleAsyncWork()

    const historyData = queryClient.getQueryData<InfiniteData<ApiMessage[]>>(historyQueryKey)
    expect(historyData?.pages[0]).toHaveLength(2)
    expect(historyData?.pages[0]?.map((message) => message._id)).toEqual([
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000050',
    ])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    await settleAsyncWork()

    expect(requestCount).toBeGreaterThanOrEqual(2)
    expect(
      queryClient.getQueryData<InfiniteData<ApiMessage[]>>(historyQueryKey)?.pages[0]
    ).toHaveLength(2)
  })

  it('pauses while hidden or offline and refreshes immediately on visibility, focus, and reconnect', async () => {
    vi.useFakeTimers()

    const newestTimestamp = '2026-01-01T10:20:00.000Z'
    let requestCount = 0

    server.use(
      http.get(messagesEndpoint, () => {
        requestCount += 1
        return HttpResponse.json([])
      })
    )

    const queryClient = setHistoryData([
      [
        makeMessage({
          _id: '00000000-0000-4000-8000-000000000010',
          createdAt: newestTimestamp,
        }),
      ],
    ])
    const wrapper = ({ children }: PropsWithChildren) => {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }

    const { result } = renderHook(
      () => {
        return useMessageSync({
          historyQueryKey,
          enabled: true,
          newestPersistedTimestamp: newestTimestamp,
        })
      },
      { wrapper }
    )

    await settleAsyncWork()
    expect(requestCount).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(requestCount).toBe(2)

    hidden = true
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000)
    })

    expect(requestCount).toBe(2)
    expect(result.current.syncState).toBe('idle')

    hidden = false
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await settleAsyncWork()
    expect(requestCount).toBe(3)

    online = false
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })

    expect(requestCount).toBe(3)
    expect(result.current.syncState).toBe('offline')

    online = true
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await settleAsyncWork()
    expect(requestCount).toBe(4)

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await settleAsyncWork()
    expect(requestCount).toBe(5)
  })

  it('uses bounded retry/backoff and keeps existing history visible on sync failures', async () => {
    vi.useFakeTimers()

    const newestTimestamp = '2026-01-01T10:20:00.000Z'
    let requestCount = 0

    server.use(
      http.get(messagesEndpoint, () => {
        requestCount += 1

        if (requestCount <= 3) {
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

        return HttpResponse.json([
          makeMessage({
            _id: '00000000-0000-4000-8000-000000000099',
            createdAt: '2026-01-01T10:50:00.000Z',
          }),
        ])
      })
    )

    const queryClient = setHistoryData([
      [
        makeMessage({
          _id: '00000000-0000-4000-8000-000000000010',
          createdAt: newestTimestamp,
          message: 'existing',
        }),
      ],
    ])

    const wrapper = ({ children }: PropsWithChildren) => {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }

    const { result } = renderHook(
      () => {
        return useMessageSync({
          historyQueryKey,
          enabled: true,
          newestPersistedTimestamp: newestTimestamp,
        })
      },
      { wrapper }
    )

    await settleAsyncWork()
    expect(requestCount).toBe(1)
    expect(result.current.syncState).toBe('delayed')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999)
    })
    await settleAsyncWork()
    expect(requestCount).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    await settleAsyncWork()
    expect(requestCount).toBe(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999)
    })
    await settleAsyncWork()
    expect(requestCount).toBe(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    await settleAsyncWork()
    expect(requestCount).toBe(3)

    const beforeRecovery = queryClient.getQueryData<InfiniteData<ApiMessage[]>>(historyQueryKey)
    expect(beforeRecovery).toBeDefined()
    if (!beforeRecovery) {
      throw new Error('Expected history data before recovery')
    }

    expect(beforeRecovery.pages[0]?.map((message) => message._id)).toEqual([
      '00000000-0000-4000-8000-000000000010',
    ])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    await settleAsyncWork()
    expect(requestCount).toBe(4)
    expect(result.current.syncState).toBe('idle')

    const afterRecovery = queryClient.getQueryData<InfiniteData<ApiMessage[]>>(historyQueryKey)
    expect(afterRecovery).toBeDefined()
    if (!afterRecovery) {
      throw new Error('Expected history data after recovery')
    }

    expect(afterRecovery.pages[0]?.map((message) => message._id)).toEqual([
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000099',
    ])
  })

  it('uses an overlap cursor so late-arriving messages with equal timestamps are recovered', async () => {
    vi.useFakeTimers()

    const newestTimestamp = '2026-01-01T10:20:00.000Z'
    let capturedAfter: string | null = null

    const existingAtTimestamp = makeMessage({
      _id: '00000000-0000-4000-8000-000000000010',
      createdAt: newestTimestamp,
      message: 'existing at timestamp',
    })

    const lateAtSameTimestamp = makeMessage({
      _id: '00000000-0000-4000-8000-000000000011',
      createdAt: newestTimestamp,
      message: 'late same timestamp',
    })

    server.use(
      http.get(messagesEndpoint, ({ request }) => {
        const url = new URL(request.url)
        capturedAfter = url.searchParams.get('after')

        if (!capturedAfter) {
          return HttpResponse.json([])
        }

        // Simulate backend behavior where overlap cursor includes both records.
        if (Date.parse(capturedAfter) < Date.parse(newestTimestamp)) {
          return HttpResponse.json([existingAtTimestamp, lateAtSameTimestamp])
        }

        return HttpResponse.json([])
      })
    )

    const queryClient = setHistoryData([[existingAtTimestamp]])
    const wrapper = ({ children }: PropsWithChildren) => {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }

    renderHook(
      () => {
        return useMessageSync({
          historyQueryKey,
          enabled: true,
          newestPersistedTimestamp: newestTimestamp,
        })
      },
      { wrapper }
    )

    await settleAsyncWork()

    expect(capturedAfter).not.toBeNull()
    if (!capturedAfter) {
      throw new Error('Expected after cursor to be captured')
    }

    expect(Date.parse(capturedAfter)).toBeLessThan(Date.parse(newestTimestamp))

    const historyData = queryClient.getQueryData<InfiniteData<ApiMessage[]>>(historyQueryKey)
    expect(historyData?.pages[0]?.map((message) => message._id)).toEqual([
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000011',
    ])
  })
})
