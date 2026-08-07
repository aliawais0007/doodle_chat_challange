import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatScreen } from '@features/chat/chat-screen'
import type { PersistedMessage } from '@features/chat/domain/messages'
import type { UseMessageHistoryResult } from '@features/chat/useMessageHistory'
import type { UseChatScrollResult } from '@features/chat/useChatScroll'
import { ApiError, API_ERROR_CATEGORIES } from '@shared/api/errors'
import type { DisplayNameContextValue } from '@features/identity/display-name-context-value'
import { renderWithProviders } from '@test/renderWithProviders'

const { mockUseMessageHistory, mockUseDisplayName, mockUseChatScroll } = vi.hoisted(() => {
  return {
    mockUseMessageHistory: vi.fn<() => UseMessageHistoryResult>(),
    mockUseDisplayName: vi.fn<() => DisplayNameContextValue>(),
    mockUseChatScroll: vi.fn<() => UseChatScrollResult>(),
  }
})

vi.mock('@features/chat/useMessageHistory', () => {
  return {
    useMessageHistory: mockUseMessageHistory,
  }
})

vi.mock('@features/identity/use-display-name', () => {
  return {
    useDisplayName: mockUseDisplayName,
  }
})

vi.mock('@features/chat/useChatScroll', () => {
  return {
    useChatScroll: mockUseChatScroll,
  }
})

const makePersistedMessage = (overrides: Partial<PersistedMessage> = {}): PersistedMessage => {
  return {
    kind: 'persisted',
    _id: overrides._id ?? '00000000-0000-4000-8000-000000000001',
    message: overrides.message ?? 'Hello world',
    author: overrides.author ?? 'Alex',
    createdAt: overrides.createdAt ?? '2026-01-01T10:00:00.000Z',
  }
}

beforeEach(() => {
  const scrollApi: UseChatScrollResult = {
    containerRef: vi.fn(),
    isNearBottom: true,
    unreadCount: 0,
    scrollToLatest: vi.fn(),
    registerInitialLoad: vi.fn(),
    registerOwnMessage: vi.fn(),
    registerRemoteMessages: vi.fn(),
    capturePrependAnchor: vi.fn(),
    restorePrependAnchor: vi.fn(),
  }

  mockUseChatScroll.mockReturnValue(scrollApi)

  mockUseDisplayName.mockReturnValue({
    displayName: 'Alex',
    hasDisplayName: true,
    isDialogOpen: false,
    isRequired: false,
    openEditor: vi.fn(),
    closeEditor: vi.fn(),
    saveDisplayName: vi.fn(),
  })

  mockUseMessageHistory.mockReturnValue({
    messages: [],
    syncState: 'idle',
    initialLoading: false,
    initialError: null,
    retry: vi.fn(),
    hasOlderMessages: false,
    loadingOlder: false,
    loadOlder: vi.fn(),
    loadOlderError: null,
  })
})

describe('ChatScreen', () => {
  it('renders main landmark and heading', () => {
    renderWithProviders(<ChatScreen />)

    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Doodle Chat' })).toBeInTheDocument()
  })

  it('renders the initial skeleton while loading', () => {
    mockUseMessageHistory.mockReturnValue({
      messages: [],
      syncState: 'idle',
      initialLoading: true,
      initialError: null,
      retry: vi.fn(),
      hasOlderMessages: false,
      loadingOlder: false,
      loadOlder: vi.fn(),
      loadOlderError: null,
    })

    renderWithProviders(<ChatScreen />)

    expect(screen.getByRole('status', { name: 'Loading messages' })).toBeInTheDocument()
  })

  it('renders the empty state', () => {
    renderWithProviders(<ChatScreen />)

    expect(screen.getByText('No messages yet')).toBeInTheDocument()
  })

  it('renders configuration failure state and retry action', async () => {
    const retry = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    mockUseMessageHistory.mockReturnValue({
      messages: [],
      syncState: 'idle',
      initialLoading: false,
      initialError: new ApiError({
        message: 'Chat configuration is invalid. Check the API settings and reload the page.',
        category: API_ERROR_CATEGORIES.configuration,
        statusCode: undefined,
        validationIssues: undefined,
        timestamp: undefined,
      }),
      retry,
      hasOlderMessages: false,
      loadingOlder: false,
      loadOlder: vi.fn(),
      loadOlderError: null,
    })

    renderWithProviders(<ChatScreen />)

    expect(
      screen.getByRole('heading', { name: 'Chat configuration is invalid' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Check the API base URL and token, then try again.')
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('renders ordered conversation list with message articles, timestamps, separators, and load older UI', async () => {
    const loadOlder = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    mockUseMessageHistory.mockReturnValue({
      messages: [
        makePersistedMessage({
          _id: '00000000-0000-4000-8000-000000000001',
          author: 'Taylor',
          message: 'Incoming hello',
          createdAt: '2026-01-01T09:00:00.000Z',
        }),
        makePersistedMessage({
          _id: '00000000-0000-4000-8000-000000000002',
          author: 'Taylor',
          message: 'Incoming follow up',
          createdAt: '2026-01-01T09:02:00.000Z',
        }),
        makePersistedMessage({
          _id: '00000000-0000-4000-8000-000000000003',
          author: 'Alex',
          message: '<b>Own message</b>',
          createdAt: '2026-01-02T10:00:00.000Z',
        }),
      ],
      syncState: 'idle',
      initialLoading: false,
      initialError: null,
      retry: vi.fn(),
      hasOlderMessages: true,
      loadingOlder: false,
      loadOlder,
      loadOlderError: null,
    })

    renderWithProviders(<ChatScreen />)

    const conversationList = screen.getByRole('list')
    expect(conversationList).toBeInTheDocument()

    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(screen.getAllByText('Taylor')).toHaveLength(1)
    expect(screen.getByText('<b>Own message</b>')).toBeInTheDocument()
    expect(screen.getByText(/January 1, 2026/i)).toBeInTheDocument()
    expect(screen.getByText(/January 2, 2026/i)).toBeInTheDocument()
    expect(screen.getAllByText((_, element) => element?.tagName === 'TIME')).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: 'Load older messages' }))

    expect(loadOlder).toHaveBeenCalledTimes(1)
  })

  it('renders beginning-of-history state and malformed pagination errors without losing messages', () => {
    mockUseMessageHistory.mockReturnValue({
      messages: [makePersistedMessage()],
      syncState: 'idle',
      initialLoading: false,
      initialError: null,
      retry: vi.fn(),
      hasOlderMessages: false,
      loadingOlder: false,
      loadOlder: vi.fn(),
      loadOlderError: new ApiError({
        message: 'Response body did not match the expected API contract',
        category: API_ERROR_CATEGORIES.malformedResponse,
        statusCode: 200,
        validationIssues: undefined,
        timestamp: undefined,
      }),
    })

    renderWithProviders(<ChatScreen />)

    expect(screen.getByText('Beginning of conversation')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The server returned a response this app could not read. Try again later.'
    )
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('applies full-height responsive layout classes where practical', () => {
    const { container } = renderWithProviders(<ChatScreen />)

    expect(container.firstChild).toHaveClass('flex', 'min-h-dvh', 'flex-col')
  })

  it('shows floating scroll-to-latest control with unread count when away from bottom', () => {
    mockUseChatScroll.mockReturnValue({
      containerRef: vi.fn(),
      isNearBottom: false,
      unreadCount: 3,
      scrollToLatest: vi.fn(),
      registerInitialLoad: vi.fn(),
      registerOwnMessage: vi.fn(),
      registerRemoteMessages: vi.fn(),
      capturePrependAnchor: vi.fn(),
      restorePrependAnchor: vi.fn(),
    })

    renderWithProviders(<ChatScreen />)

    expect(
      screen.getByRole('button', { name: 'Scroll to latest. 3 new messages.' })
    ).toBeInTheDocument()
    expect(screen.getByText('3 new messages')).toBeInTheDocument()
  })

  it('invokes scrollToLatest when floating control is clicked', async () => {
    const user = userEvent.setup()
    const scrollToLatest = vi.fn()

    mockUseChatScroll.mockReturnValue({
      containerRef: vi.fn(),
      isNearBottom: false,
      unreadCount: 1,
      scrollToLatest,
      registerInitialLoad: vi.fn(),
      registerOwnMessage: vi.fn(),
      registerRemoteMessages: vi.fn(),
      capturePrependAnchor: vi.fn(),
      restorePrependAnchor: vi.fn(),
    })

    renderWithProviders(<ChatScreen />)

    await user.click(screen.getByRole('button', { name: 'Scroll to latest. 1 new messages.' }))

    expect(scrollToLatest).toHaveBeenCalledTimes(1)
  })

  it('shows offline sync status while preserving visible history', () => {
    mockUseMessageHistory.mockReturnValue({
      messages: [makePersistedMessage()],
      syncState: 'offline',
      initialLoading: false,
      initialError: null,
      retry: vi.fn(),
      hasOlderMessages: false,
      loadingOlder: false,
      loadOlder: vi.fn(),
      loadOlderError: null,
    })

    renderWithProviders(<ChatScreen />)

    expect(
      screen.getByText('You’re offline. New messages will appear when the connection returns.')
    ).toBeInTheDocument()
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('shows delayed sync status while preserving visible history', () => {
    mockUseMessageHistory.mockReturnValue({
      messages: [makePersistedMessage()],
      syncState: 'delayed',
      initialLoading: false,
      initialError: null,
      retry: vi.fn(),
      hasOlderMessages: false,
      loadingOlder: false,
      loadOlder: vi.fn(),
      loadOlderError: null,
    })

    renderWithProviders(<ChatScreen />)

    expect(screen.getByText('Messages may be delayed.')).toBeInTheDocument()
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('shows and then clears a brief recovered status after offline', () => {
    vi.useFakeTimers()

    let currentSyncState: UseMessageHistoryResult['syncState'] = 'offline'

    mockUseMessageHistory.mockImplementation(() => {
      return {
        messages: [makePersistedMessage()],
        syncState: currentSyncState,
        initialLoading: false,
        initialError: null,
        retry: vi.fn(),
        hasOlderMessages: false,
        loadingOlder: false,
        loadOlder: vi.fn(),
        loadOlderError: null,
      }
    })

    const { rerender } = renderWithProviders(<ChatScreen />)

    expect(
      screen.getByText('You’re offline. New messages will appear when the connection returns.')
    ).toBeInTheDocument()

    currentSyncState = 'idle'
    rerender(<ChatScreen />)

    expect(
      screen.getByText('Connection restored. Messages are updating again.')
    ).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2500)
    })

    expect(
      screen.queryByText('Connection restored. Messages are updating again.')
    ).not.toBeInTheDocument()

    vi.useRealTimers()
  })
})
