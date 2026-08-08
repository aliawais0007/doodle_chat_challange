import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '@app/app'
import { renderWithProviders } from '@test/renderWithProviders'
import { server } from '@test/server'

const messagesEndpoint = 'http://localhost:3000/api/v1/messages'

const mockUuid = vi.fn<() => string>()

type ObserverRecord = {
  observe: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  trigger: (isIntersecting: boolean) => void
}

let observerRecords: ObserverRecord[] = []

const makeMessageBatch = (size: number, prefix: string, startHour: number) => {
  return Array.from({ length: size }, (_, index) => {
    const sequence = index + 1
    const minute = String(index % 60).padStart(2, '0')
    const hour = String(startHour + Math.floor(index / 60)).padStart(2, '0')
    const idSuffix = String(sequence).padStart(12, '0')

    return {
      _id: `00000000-0000-4000-8000-${idSuffix}`,
      message: `${prefix} ${String(sequence)}`,
      author: 'Alex',
      createdAt: `2026-01-02T${hour}:${minute}:00.000Z`,
    }
  })
}

vi.stubGlobal('crypto', {
  randomUUID: () => mockUuid(),
})

describe('ChatScreen optimistic composer integration', () => {
  beforeEach(() => {
    observerRecords = []

    vi.stubGlobal(
      'IntersectionObserver',
      class {
        public observe = vi.fn()
        public disconnect = vi.fn()
        private callback: IntersectionObserverCallback

        public constructor(callback: IntersectionObserverCallback) {
          this.callback = callback
          observerRecords.push({
            observe: this.observe,
            disconnect: this.disconnect,
            trigger: (isIntersecting: boolean) => {
              this.callback(
                [
                  {
                    isIntersecting,
                  } as IntersectionObserverEntry,
                ],
                this as unknown as IntersectionObserver
              )
            },
          })
        }
      }
    )
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      value: globalThis.IntersectionObserver,
    })

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    })

    mockUuid.mockReset()
    mockUuid.mockReturnValue('client-1')
    window.localStorage.clear()
    window.localStorage.setItem('doodle-chat.display-name', 'Alex')

    server.use(
      http.get(messagesEndpoint, () => {
        return HttpResponse.json([])
      })
    )
  })

  it('keeps the draft while sending, then clears it after success', async () => {
    let releaseRequest: (() => void) | undefined
    const user = userEvent.setup()

    server.use(
      http.post(messagesEndpoint, async () => {
        await new Promise<void>((resolve) => {
          releaseRequest = resolve
        })

        return HttpResponse.json(
          {
            _id: '00000000-0000-4000-8000-000000000111',
            message: 'Hello world',
            author: 'Alex',
            createdAt: '2026-01-01T10:01:00.000Z',
          },
          { status: 201 }
        )
      })
    )

    renderWithProviders(<App />)

    const textarea = await screen.findByLabelText('Message')
    await user.type(textarea, 'Hello world')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(textarea).toHaveValue('Hello world')
      expect(
        within(screen.getByRole('region', { name: 'Conversation history' })).getByText(
          'Hello world',
          { exact: true }
        )
      ).toBeInTheDocument()
      expect(screen.getByText('Sending…')).toBeInTheDocument()
      expect(textarea).toHaveFocus()
    })

    if (releaseRequest) {
      releaseRequest()
    }

    await waitFor(() => {
      expect(screen.queryByText('Sending…')).not.toBeInTheDocument()
      expect(textarea).toHaveValue('')
    })
  })

  it('preserves text when local validation prevents submission', async () => {
    const user = userEvent.setup()

    renderWithProviders(<App />)

    const textarea = await screen.findByLabelText('Message')
    await user.type(textarea, '   ')
    await user.keyboard('{Enter}')

    expect(textarea).toHaveValue('   ')
    expect(screen.getByRole('alert')).toHaveTextContent('Message cannot be empty')
  })

  it('shows failed optimistic message actions and supports retry', async () => {
    let shouldFail = true
    const user = userEvent.setup()

    server.use(
      http.post(messagesEndpoint, async () => {
        await delay(10)

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
          {
            _id: '00000000-0000-4000-8000-000000000222',
            message: 'Retry me',
            author: 'Alex',
            createdAt: '2026-01-01T10:02:00.000Z',
          },
          { status: 201 }
        )
      })
    )

    renderWithProviders(<App />)

    const textarea = await screen.findByLabelText('Message')
    await user.type(textarea, 'Retry me')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(
        within(screen.getByRole('region', { name: 'Conversation history' })).getByText(
          'Internal Server Error'
        )
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    })

    shouldFail = false
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => {
      expect(
        within(screen.getByRole('region', { name: 'Conversation history' })).queryByText(
          'Internal Server Error'
        )
      ).not.toBeInTheDocument()
      expect(
        within(screen.getByRole('region', { name: 'Conversation history' })).getByText(
          'Retry me',
          { exact: true }
        )
      ).toBeInTheDocument()
    })
  })

  it('loads older messages when the top sentinel intersects and does not issue duplicate concurrent requests', async () => {
    let olderRequests = 0
    const initialMessages = makeMessageBatch(50, 'Latest message', 10)
    const olderMessage = {
      _id: '00000000-0000-4000-8000-999999999001',
      message: 'Older history message',
      author: 'Taylor',
      createdAt: '2026-01-01T09:00:00.000Z',
    }

    server.use(
      http.get(messagesEndpoint, async ({ request }) => {
        const before = new URL(request.url).searchParams.get('before')

        if (!before) {
          return HttpResponse.json(initialMessages)
        }

        olderRequests += 1
        await delay(50)

        return HttpResponse.json([olderMessage])
      })
    )

    renderWithProviders(<App />)

    await screen.findByText('Latest message 1')

    await waitFor(() => {
      expect(observerRecords.length).toBeGreaterThan(0)
    })

    observerRecords[0]?.trigger(true)
    observerRecords[0]?.trigger(true)

    await waitFor(
      () => {
        expect(screen.getByText('Older history message')).toBeInTheDocument()
      },
      { timeout: 3000 }
    )

    expect(olderRequests).toBe(1)
    expect(screen.getByText('Latest message 1')).toBeInTheDocument()
  })

  it('keeps timeline visible on older-load failure and offers retry action', async () => {
    let failOlder = true
    const initialMessages = makeMessageBatch(50, 'Latest message', 10)
    const olderMessage = {
      _id: '00000000-0000-4000-8000-999999999002',
      message: 'Recovered older message',
      author: 'Taylor',
      createdAt: '2026-01-01T09:00:00.000Z',
    }

    server.use(
      http.get(messagesEndpoint, ({ request }) => {
        const before = new URL(request.url).searchParams.get('before')

        if (!before) {
          return HttpResponse.json(initialMessages)
        }

        if (failOlder) {
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

        return HttpResponse.json([olderMessage])
      })
    )

    const user = userEvent.setup()

    renderWithProviders(<App />)

    await screen.findByText('Latest message 1')

    await user.click(screen.getByRole('button', { name: 'Load older messages' }))

    await waitFor(() => {
      expect(screen.getByText('Try again in a moment.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry older messages' })).toBeInTheDocument()
    })

    expect(screen.getByText('Latest message 1')).toBeInTheDocument()

    failOlder = false
    await user.click(screen.getByRole('button', { name: 'Retry older messages' }))

    await waitFor(() => {
      expect(screen.getByText('Recovered older message')).toBeInTheDocument()
    })
  })

  it('keeps live announcements silent for initial and older history loads', async () => {
    const initialMessages = makeMessageBatch(50, 'Latest message', 10)
    const olderMessage = {
      _id: '00000000-0000-4000-8000-999999999101',
      message: 'Older history message that should stay silent',
      author: 'Taylor',
      createdAt: '2026-01-01T09:00:00.000Z',
    }

    server.use(
      http.get(messagesEndpoint, ({ request }) => {
        const before = new URL(request.url).searchParams.get('before')

        if (!before) {
          return HttpResponse.json(initialMessages)
        }

        return HttpResponse.json([olderMessage])
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<App />)

    await screen.findByText('Latest message 1')

    const liveRegion = screen.getByRole('status', { name: 'New message notifications' })
    expect(liveRegion).toHaveTextContent(/^\s*$/)

    await user.click(screen.getByRole('button', { name: 'Load older messages' }))

    await waitFor(() => {
      expect(screen.getByText('Older history message that should stay silent')).toBeInTheDocument()
    })

    expect(liveRegion).toHaveTextContent(/^\s*$/)
  })

  it('does not announce own optimistic messages as incoming', async () => {
    const user = userEvent.setup()

    server.use(
      http.post(messagesEndpoint, async () => {
        await delay(10)

        return HttpResponse.json(
          {
            _id: '00000000-0000-4000-8000-000000000451',
            message: 'My own outgoing message',
            author: 'Alex',
            createdAt: '2026-01-01T10:03:00.000Z',
          },
          { status: 201 }
        )
      })
    )

    renderWithProviders(<App />)

    const textarea = await screen.findByLabelText('Message')
    const liveRegion = screen.getByRole('status', { name: 'New message notifications' })
    await user.type(textarea, 'My own outgoing message')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByText('My own outgoing message')).toBeInTheDocument()
    })

    expect(liveRegion).toHaveTextContent(/^\s*$/)
  })

  it('announces newly synchronized remote messages once and suppresses duplicates', async () => {
    let requestCount = 0
    const remoteMessage = {
      _id: '00000000-0000-4000-8000-000000009999',
      message:
        'A remote synchronized message body that is intentionally long to verify concise announcement formatting behavior.',
      author: 'Taylor',
      createdAt: '2026-01-01T10:03:00.000Z',
    }

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    })

    server.use(
      http.get(messagesEndpoint, ({ request }) => {
        const url = new URL(request.url)
        const before = url.searchParams.get('before')
        const after = url.searchParams.get('after')

        if (!before && !after) {
          return HttpResponse.json([
            {
              _id: '00000000-0000-4000-8000-000000000500',
              message: 'Baseline latest message',
              author: 'Alex',
              createdAt: '2026-01-01T10:00:00.000Z',
            },
          ])
        }

        if (after) {
          requestCount += 1

          if (requestCount === 1) {
            return HttpResponse.json([remoteMessage])
          }

          return HttpResponse.json([remoteMessage])
        }

        return HttpResponse.json([])
      })
    )

    renderWithProviders(<App />)

    await screen.findByText('Baseline latest message')

    const liveRegion = screen.getByRole('status', { name: 'New message notifications' })
    expect(liveRegion).toHaveTextContent(/^\s*$/)

    window.dispatchEvent(new Event('focus'))

    await waitFor(() => {
      expect(liveRegion).toHaveTextContent('Taylor: A remote synchronized message body')
    })

    const firstAnnouncement = liveRegion.textContent

    window.dispatchEvent(new Event('focus'))

    await waitFor(() => {
      expect(requestCount).toBeGreaterThanOrEqual(2)
    })

    expect(liveRegion.textContent).toBe(firstAnnouncement)
  })

  it('does not announce a pending own message as remote after display name changes', async () => {
    let releasePost: (() => void) | undefined
    const syncedCreatedAt = new Date(Date.now() + 1000).toISOString()

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    })

    server.use(
      http.get(messagesEndpoint, ({ request }) => {
        const url = new URL(request.url)
        const after = url.searchParams.get('after')
        const before = url.searchParams.get('before')

        if (!before && !after) {
          return HttpResponse.json([
            {
              _id: '00000000-0000-4000-8000-000000000700',
              message: 'Baseline latest message',
              author: 'Taylor',
              createdAt: '2026-01-01T10:00:00.000Z',
            },
          ])
        }

        if (after) {
          return HttpResponse.json([
            {
              _id: '00000000-0000-4000-8000-000000000701',
              message: 'Pending message authored with old name',
              author: 'Alex',
              createdAt: syncedCreatedAt,
            },
          ])
        }

        return HttpResponse.json([])
      }),
      http.post(messagesEndpoint, async () => {
        await new Promise<void>((resolve) => {
          releasePost = resolve
        })

        return HttpResponse.json(
          {
            _id: '00000000-0000-4000-8000-000000000701',
            message: 'Pending message authored with old name',
            author: 'Alex',
            createdAt: syncedCreatedAt,
          },
          { status: 201 }
        )
      })
    )

    const user = userEvent.setup()

    renderWithProviders(<App />)

    const textarea = await screen.findByLabelText('Message')
    const liveRegion = screen.getByRole('status', { name: 'New message notifications' })

    await user.type(textarea, 'Pending message authored with old name')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(
        within(screen.getByRole('region', { name: 'Conversation history' })).getByText(
          'Pending message authored with old name',
          { exact: true }
        )
      ).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Edit name' }))

    const displayNameField = screen.getByLabelText('Display name')
    await user.clear(displayNameField)
    await user.type(displayNameField, 'Jordan')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() => {
      expect(
        screen.getByText('Chatting as Jordan. Changes affect future messages only.')
      ).toBeInTheDocument()
    })

    window.dispatchEvent(new Event('focus'))

    await waitFor(() => {
      expect(
        screen.getAllByText('Pending message authored with old name').length
      ).toBeGreaterThanOrEqual(1)
    })

    expect(liveRegion).toHaveTextContent(/^\s*$/)

    if (releasePost) {
      releasePost()
    }
  })

  it('shows offline then recovered sync status on browser reconnect without hiding history', async () => {
    let online = true

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    })

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => online,
    })

    server.use(
      http.get(messagesEndpoint, ({ request }) => {
        const url = new URL(request.url)
        const before = url.searchParams.get('before')

        if (!before) {
          return HttpResponse.json([
            {
              _id: '00000000-0000-4000-8000-000000000650',
              message: 'History remains visible',
              author: 'Alex',
              createdAt: '2026-01-01T10:00:00.000Z',
            },
          ])
        }

        return HttpResponse.json([])
      })
    )

    renderWithProviders(<App />)

    await screen.findByText('History remains visible')

    online = false
    window.dispatchEvent(new Event('offline'))

    await waitFor(() => {
      expect(
        screen.getByText('You’re offline. New messages will appear when the connection returns.')
      ).toBeInTheDocument()
    })

    expect(screen.getByText('History remains visible')).toBeInTheDocument()

    online = true
    window.dispatchEvent(new Event('online'))

    await waitFor(() => {
      expect(
        screen.getByText('Connection restored. Messages are updating again.')
      ).toBeInTheDocument()
    })
  })
})
