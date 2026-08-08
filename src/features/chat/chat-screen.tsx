import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'

import {
  buildTimelineItems,
  type FailedOptimisticMessage,
  type TimelineItem,
} from '@features/chat/domain/messages'
import { useMessageHistory } from '@features/chat/useMessageHistory'
import { useChatScroll } from '@features/chat/useChatScroll'
import { MessageComposer } from '@features/chat/message-composer'
import { useSendMessage } from '@features/chat/useSendMessage'
import { useDisplayName } from '@features/identity/use-display-name'
import { API_ERROR_CATEGORIES, type ApiError } from '@shared/api/errors'

const LOAD_OLDER_OBSERVER_TOP_MARGIN_PX = 240
const LIVE_ANNOUNCEMENT_PREVIEW_MAX_CHARS = 80
const SYNC_RECOVERY_NOTICE_DURATION_MS = 2500

const collapseAnnouncementWhitespace = (value: string) => {
  return value.replace(/\s+/g, ' ').trim()
}

const toAnnouncementPreview = (value: string) => {
  const collapsed = collapseAnnouncementWhitespace(value)

  if (collapsed.length <= LIVE_ANNOUNCEMENT_PREVIEW_MAX_CHARS) {
    return collapsed
  }

  return `${collapsed.slice(0, LIVE_ANNOUNCEMENT_PREVIEW_MAX_CHARS)}...`
}

const toLiveAnnouncement = (messages: Array<{ author: string; message: string }>) => {
  if (messages.length === 0) {
    return ''
  }

  if (messages.length <= 2) {
    return messages
      .map((entry) => {
        return `${entry.author}: ${toAnnouncementPreview(entry.message)}`
      })
      .join(' ')
  }

  const latest = messages[messages.length - 1]

  if (!latest) {
    return `${String(messages.length)} new messages.`
  }

  return `${String(messages.length)} new messages. Latest from ${latest.author}: ${toAnnouncementPreview(latest.message)}`
}

const formatMessageTime = (createdAt: string) => {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(createdAt))
    .replace(',', '')
}

const isOwnMessage = (author: string, displayName: string | null) => {
  return displayName !== null && author === displayName
}

type HistoryFailureCopy = {
  title: string
  message: string
  actionLabel: string
}

const getHistoryFailureCopy = (
  error: ApiError,
  scope: 'initial' | 'pagination'
): HistoryFailureCopy => {
  switch (error.category) {
    case API_ERROR_CATEGORIES.configuration:
      return {
        title:
          scope === 'initial' ? 'Chat configuration is invalid' : 'Could not load older messages',
        message: 'Check the API base URL and token, then try again.',
        actionLabel: scope === 'pagination' ? 'Retry older messages' : 'Retry',
      }
    case API_ERROR_CATEGORIES.unauthorized:
      return {
        title: scope === 'initial' ? 'Authentication required' : 'Could not load older messages',
        message: 'The chat token was rejected. Check the token and try again.',
        actionLabel: scope === 'pagination' ? 'Retry older messages' : 'Retry',
      }
    case API_ERROR_CATEGORIES.malformedResponse:
      return {
        title: scope === 'initial' ? 'Unexpected chat data' : 'Could not load older messages',
        message: 'The server returned a response this app could not read. Try again later.',
        actionLabel: scope === 'pagination' ? 'Retry older messages' : 'Retry',
      }
    case API_ERROR_CATEGORIES.network:
      return {
        title: scope === 'initial' ? 'Network error' : 'Could not load older messages',
        message: 'We could not reach the server. Check your connection and try again.',
        actionLabel: scope === 'pagination' ? 'Retry older messages' : 'Retry',
      }
    case API_ERROR_CATEGORIES.timeout:
      return {
        title: scope === 'initial' ? 'Request timed out' : 'Could not load older messages',
        message: 'The server took too long to respond. Try again.',
        actionLabel: scope === 'pagination' ? 'Retry older messages' : 'Retry',
      }
    default:
      return {
        title: scope === 'initial' ? 'Unable to load messages' : 'Could not load older messages',
        message: 'Try again in a moment.',
        actionLabel: scope === 'pagination' ? 'Retry older messages' : 'Retry',
      }
  }
}

const TimelineSeparator = ({
  item,
}: {
  item: Extract<TimelineItem, { kind: 'date-separator' }>
}) => {
  return (
    <li className="flex justify-center py-3">
      <span
        aria-label={item.label}
        className="chat-sync-status px-3 py-1 text-xs font-medium"
        role="separator"
      >
        {item.label}
      </span>
    </li>
  )
}

const TimelineMessage = ({
  item,
  displayName,
  onRemoveFailed,
  onRetryFailed,
}: {
  item: Extract<TimelineItem, { kind: 'message' }>
  displayName: string | null
  onRemoveFailed: (clientId: string) => void
  onRetryFailed: (clientId: string) => void
}) => {
  const ownMessage = isOwnMessage(item.message.author, displayName)
  const isFailedOutgoing =
    item.message.kind === 'optimistic' && item.message.deliveryStatus === 'failed'
  const isSendingOutgoing =
    item.message.kind === 'optimistic' && item.message.deliveryStatus === 'sending'
  const optimisticMessage = item.message.kind === 'optimistic' ? item.message : null
  const failedMessageError =
    optimisticMessage && optimisticMessage.deliveryStatus === 'failed'
      ? optimisticMessage.errorMessage
      : null

  return (
    <li
      className={[
        'flex',
        ownMessage ? 'justify-end' : 'justify-start',
        item.grouping.startsGroup ? 'mt-4' : 'mt-0.5',
      ].join(' ')}
      data-message-id={
        item.message.kind === 'persisted' ? item.message._id : `optimistic-${item.message.clientId}`
      }
    >
      <article
        className={[
          'chat-message-bubble text-[var(--app-text)]',
          ownMessage
            ? 'chat-message-bubble--own rounded-br-md'
            : 'chat-message-bubble--incoming rounded-bl-md',
          item.grouping.startsGroup && item.grouping.endsGroup
            ? ''
            : item.grouping.startsGroup
              ? 'chat-message-bubble--group-start'
              : item.grouping.endsGroup
                ? 'chat-message-bubble--group-end'
                : 'chat-message-bubble--group-middle',
        ].join(' ')}
      >
        {item.grouping.showAuthor && !ownMessage ? (
          <p className="chat-message-author mb-1 text-base font-medium leading-none">
            {item.message.author}
          </p>
        ) : null}
        <p className="whitespace-pre-wrap break-words text-base leading-[1.35]" dir="auto">
          {item.message.message}
        </p>
        {optimisticMessage ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p
              className={[
                'text-xs font-medium',
                isFailedOutgoing ? 'text-[var(--app-destructive)]' : 'chat-muted',
              ].join(' ')}
            >
              {isSendingOutgoing ? 'Sending…' : (failedMessageError ?? 'Failed to send')}
            </p>
            {isFailedOutgoing ? (
              <div className="flex items-center gap-2">
                <button
                  className="chat-control-secondary chat-focus-ring min-h-11 rounded-full px-3 py-2 text-xs font-medium"
                  onClick={() => {
                    onRetryFailed(optimisticMessage.clientId)
                  }}
                  type="button"
                >
                  Retry
                </button>
                <button
                  className="chat-control-destructive chat-focus-ring min-h-11 rounded-full px-3 py-2 text-xs font-medium"
                  onClick={() => {
                    onRemoveFailed(optimisticMessage.clientId)
                  }}
                  type="button"
                >
                  Remove
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className={['mt-2 flex', ownMessage ? 'justify-end' : 'justify-start'].join(' ')}>
          <time className="chat-message-time text-sm" dateTime={item.message.createdAt}>
            {formatMessageTime(item.message.createdAt)}
          </time>
        </div>
      </article>
    </li>
  )
}

const HistorySkeleton = () => {
  return (
    <div aria-label="Loading messages" className="space-y-4" role="status">
      {Array.from({ length: 5 }, (_, index) => {
        const own = index % 2 === 0

        return (
          <div
            className={['flex', own ? 'justify-end' : 'justify-start'].join(' ')}
            key={`skeleton-${String(index)}`}
          >
            <div
              className={[
                'h-18 w-full max-w-[min(82%,24rem)] animate-pulse rounded-[1.75rem] bg-white/75',
                own ? 'rounded-br-md bg-[var(--app-surface-own)]/70' : 'rounded-bl-md',
              ].join(' ')}
            />
          </div>
        )
      })}
    </div>
  )
}

const HistoryStateFrame = ({ children }: { children: ReactNode }) => {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-10 text-center">
      <div className="chat-empty-state w-full max-w-md px-6 py-6 sm:px-8 sm:py-7">{children}</div>
    </div>
  )
}

export const ChatScreen = () => {
  return <ChatScreenContent />
}

type ChatScreenContentProps = {
  editButtonRef?: RefObject<HTMLButtonElement | null>
}

export const ChatScreenContent = ({ editButtonRef }: ChatScreenContentProps) => {
  const { displayName, hasDisplayName, openEditor } = useDisplayName()
  const { sendMessage, retryFailedMessage, removeFailedMessage } = useSendMessage()
  const {
    messages,
    syncState,
    initialLoading,
    initialError,
    retry,
    hasOlderMessages,
    loadingOlder,
    loadOlder,
    loadOlderError,
  } = useMessageHistory({ syncEnabled: true })
  const {
    containerRef,
    isNearBottom,
    unreadCount,
    scrollToLatest,
    registerInitialLoad,
    registerOwnMessage,
    registerRemoteMessages,
    capturePrependAnchor,
    restorePrependAnchor,
  } = useChatScroll()

  const [liveAnnouncement, setLiveAnnouncement] = useState('')
  const [showSyncRecoveredNotice, setShowSyncRecoveredNotice] = useState(false)
  const hasRegisteredInitialLoad = useRef(false)
  const knownPersistedIdsRef = useRef<Set<string>>(new Set())
  const knownOwnOptimisticIdsRef = useRef<Set<string>>(new Set())
  const localAuthorAliasesRef = useRef<Set<string>>(new Set())
  const topLoadSentinelRef = useRef<HTMLDivElement | null>(null)
  const scrollContainerNodeRef = useRef<HTMLElement | null>(null)
  const isLoadingOlderRequestInFlightRef = useRef(false)
  const previousSyncStateRef = useRef(syncState)
  const syncRecoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setScrollContainerRef = useCallback(
    (node: HTMLElement | null) => {
      scrollContainerNodeRef.current = node
      containerRef(node)
    },
    [containerRef]
  )

  const timelineItems = useMemo(() => {
    return buildTimelineItems(messages)
  }, [messages])

  const syncStatusMessage = useMemo(() => {
    if (syncState === 'offline') {
      return 'You’re offline. New messages will appear when the connection returns.'
    }

    if (syncState === 'delayed') {
      return 'Messages may be delayed.'
    }

    if (showSyncRecoveredNotice) {
      return 'Connection restored. Messages are updating again.'
    }

    return null
  }, [showSyncRecoveredNotice, syncState])

  const initialFailureCopy = initialError ? getHistoryFailureCopy(initialError, 'initial') : null
  const loadOlderFailureCopy = loadOlderError
    ? getHistoryFailureCopy(loadOlderError, 'pagination')
    : null

  const requestOlderMessages = useCallback(() => {
    if (!hasOlderMessages || loadingOlder || isLoadingOlderRequestInFlightRef.current) {
      return
    }

    isLoadingOlderRequestInFlightRef.current = true
    capturePrependAnchor()

    void loadOlder()
      .catch(() => undefined)
      .finally(() => {
        restorePrependAnchor()
        isLoadingOlderRequestInFlightRef.current = false
      })
  }, [capturePrependAnchor, hasOlderMessages, loadOlder, loadingOlder, restorePrependAnchor])

  const handleComposerSubmit = async ({ message }: { message: string }) => {
    if (!displayName) {
      return
    }

    localAuthorAliasesRef.current.add(displayName)
    await sendMessage({ message, author: displayName })
  }

  useEffect(() => {
    if (!displayName) {
      return
    }

    localAuthorAliasesRef.current.add(displayName)
  }, [displayName])

  useEffect(() => {
    const previousOwnOptimisticIds = knownOwnOptimisticIdsRef.current
    const nextOwnOptimisticIds = new Set<string>()

    for (const message of messages) {
      if (message.kind !== 'optimistic') {
        continue
      }

      if (!localAuthorAliasesRef.current.has(message.author)) {
        continue
      }

      nextOwnOptimisticIds.add(message.clientId)
    }

    const hasNewOwnOptimisticMessage = [...nextOwnOptimisticIds].some((clientId) => {
      return !previousOwnOptimisticIds.has(clientId)
    })

    if (hasNewOwnOptimisticMessage) {
      registerOwnMessage()
    }

    knownOwnOptimisticIdsRef.current = nextOwnOptimisticIds
  }, [messages, registerOwnMessage])

  useEffect(() => {
    const previousSyncState = previousSyncStateRef.current

    if (syncRecoveryTimeoutRef.current) {
      clearTimeout(syncRecoveryTimeoutRef.current)
      syncRecoveryTimeoutRef.current = null
    }

    if (
      syncState === 'idle' &&
      (previousSyncState === 'offline' || previousSyncState === 'delayed')
    ) {
      setShowSyncRecoveredNotice(true)
      syncRecoveryTimeoutRef.current = setTimeout(() => {
        setShowSyncRecoveredNotice(false)
        syncRecoveryTimeoutRef.current = null
      }, SYNC_RECOVERY_NOTICE_DURATION_MS)
    }

    previousSyncStateRef.current = syncState
  }, [syncState])

  useEffect(() => {
    return () => {
      if (syncRecoveryTimeoutRef.current) {
        clearTimeout(syncRecoveryTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (hasRegisteredInitialLoad.current) {
      return
    }

    if (initialLoading || initialError || messages.length === 0) {
      return
    }

    hasRegisteredInitialLoad.current = true
    registerInitialLoad()
  }, [initialError, initialLoading, messages.length, registerInitialLoad])

  useEffect(() => {
    const previousKnownIds = knownPersistedIdsRef.current
    const nextKnownIds = new Set<string>()
    let previousNewestPersistedTimestamp = Number.NEGATIVE_INFINITY
    const newlySynchronizedRemoteMessages: Array<{ author: string; message: string }> = []
    let remoteIncomingCount = 0

    for (const message of messages) {
      if (message.kind !== 'persisted') {
        continue
      }

      if (previousKnownIds.has(message._id)) {
        const messageTimestamp = Date.parse(message.createdAt)

        if (Number.isFinite(messageTimestamp)) {
          previousNewestPersistedTimestamp = Math.max(
            previousNewestPersistedTimestamp,
            messageTimestamp
          )
        }
      }
    }

    for (const message of messages) {
      if (message.kind !== 'persisted') {
        continue
      }

      nextKnownIds.add(message._id)

      if (previousKnownIds.has(message._id)) {
        continue
      }

      if (localAuthorAliasesRef.current.has(message.author)) {
        continue
      }

      const messageTimestamp = Date.parse(message.createdAt)
      const isForwardSynchronized =
        !Number.isFinite(previousNewestPersistedTimestamp) ||
        (Number.isFinite(messageTimestamp) && messageTimestamp >= previousNewestPersistedTimestamp)

      if (!isForwardSynchronized) {
        continue
      }

      remoteIncomingCount += 1
      newlySynchronizedRemoteMessages.push({
        author: message.author,
        message: message.message,
      })
    }

    if (previousKnownIds.size > 0 && remoteIncomingCount > 0) {
      registerRemoteMessages(remoteIncomingCount)
      setLiveAnnouncement(toLiveAnnouncement(newlySynchronizedRemoteMessages))
    }

    knownPersistedIdsRef.current = nextKnownIds
  }, [displayName, messages, registerRemoteMessages])

  useEffect(() => {
    if (initialLoading || initialError || !hasOlderMessages) {
      return
    }

    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      return
    }

    const root = scrollContainerNodeRef.current
    const target = topLoadSentinelRef.current

    if (!root || !target) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const firstEntry = entries[0]

        if (!firstEntry?.isIntersecting) {
          return
        }

        requestOlderMessages()
      },
      {
        root,
        threshold: 0,
        rootMargin: `${String(LOAD_OLDER_OBSERVER_TOP_MARGIN_PX)}px 0px 0px 0px`,
      }
    )

    observer.observe(target)

    return () => {
      observer.disconnect()
    }
  }, [hasOlderMessages, initialError, initialLoading, requestOlderMessages])

  return (
    <main
      className="chat-page flex h-dvh min-h-dvh flex-col bg-[var(--app-bg)] text-[var(--app-text)]"
      role="main"
    >
      <header className="chat-header sticky top-0 z-10">
        <div className="chat-shell mx-auto flex w-full items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[var(--app-text)] sm:text-2xl">
              Doodle Chat
            </h1>
            <p className="chat-muted mt-1 text-sm">
              {hasDisplayName
                ? `Chatting as ${displayName ?? ''}. Changes affect future messages only.`
                : 'Choose a display name to participate in chat.'}
            </p>
          </div>
          {hasDisplayName ? (
            <button
              className="chat-control-secondary chat-focus-ring min-h-11 rounded-full px-4 py-2 text-sm font-medium"
              onClick={openEditor}
              ref={editButtonRef}
              type="button"
            >
              Edit name
            </button>
          ) : null}
        </div>
      </header>

      <section className="min-h-0 flex-1 overflow-hidden">
        <div className="chat-shell mx-auto flex h-full min-h-0 w-full flex-col">
          <div
            aria-atomic="true"
            aria-live="polite"
            aria-label="New message notifications"
            aria-relevant="additions text"
            className="sr-only"
            role="status"
          >
            {liveAnnouncement}
          </div>

          {syncStatusMessage && messages.length > 0 ? (
            <p
              aria-atomic="true"
              aria-live="polite"
              className={[
                'chat-sync-status mb-3 px-4 py-2 text-sm',
                syncState === 'offline'
                  ? 'chat-sync-status--destructive'
                  : 'chat-sync-status--warning',
              ].join(' ')}
              role="status"
            >
              {syncStatusMessage}
            </p>
          ) : null}

          <section
            aria-label="Conversation history"
            className="chat-history-panel min-h-0 flex-1 px-3 py-4 sm:px-5"
            ref={setScrollContainerRef}
          >
            {initialLoading ? <HistorySkeleton /> : null}

            {!initialLoading && initialFailureCopy ? (
              <HistoryStateFrame>
                <div>
                  <h2 className="text-lg font-semibold text-[var(--app-text)]">
                    {initialFailureCopy.title}
                  </h2>
                  <p className="chat-muted mt-2 text-sm">{initialFailureCopy.message}</p>
                  <button
                    className="chat-control-primary chat-focus-ring mt-4 min-h-11 rounded-full px-5 py-2 text-sm font-medium"
                    onClick={() => {
                      void retry()
                    }}
                    type="button"
                  >
                    {initialFailureCopy.actionLabel}
                  </button>
                </div>
              </HistoryStateFrame>
            ) : null}

            {!initialLoading && !initialError && messages.length === 0 ? (
              <HistoryStateFrame>
                <div>
                  <h2 className="text-lg font-semibold text-[var(--app-text)]">No messages yet</h2>
                  <p className="chat-muted mt-2 text-sm">
                    Historical chat is empty. The conversation will appear here once messages exist.
                  </p>
                </div>
              </HistoryStateFrame>
            ) : null}

            {!initialLoading && !initialError && messages.length > 0 ? (
              <div>
                <div aria-hidden="true" className="h-px w-full" ref={topLoadSentinelRef} />
                <div className="mb-4 flex flex-col items-center gap-3">
                  {hasOlderMessages ? (
                    <>
                      <button
                        className="chat-control-secondary chat-focus-ring min-h-11 rounded-full px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={loadingOlder}
                        onClick={requestOlderMessages}
                        type="button"
                      >
                        Load older messages
                      </button>
                      {loadingOlder ? (
                        <p className="chat-muted text-xs motion-safe:animate-pulse" role="status">
                          Loading older messages...
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="chat-sync-status px-3 py-1 text-xs font-medium">
                      Beginning of conversation
                    </p>
                  )}

                  {loadOlderFailureCopy ? (
                    <>
                      <p
                        className="chat-sync-status chat-sync-status--destructive px-4 py-2 text-sm"
                        role="alert"
                      >
                        {loadOlderFailureCopy.message}
                      </p>
                      <button
                        className="chat-control-destructive chat-focus-ring min-h-11 rounded-full px-4 py-2 text-sm font-medium"
                        onClick={requestOlderMessages}
                        type="button"
                      >
                        {loadOlderFailureCopy.actionLabel}
                      </button>
                    </>
                  ) : null}

                  {!hasOlderMessages ? (
                    <p className="sr-only" role="status">
                      Beginning of conversation reached.
                    </p>
                  ) : null}
                </div>

                <ol className="list-none p-0" role="list">
                  {timelineItems.map((item) => {
                    if (item.kind === 'date-separator') {
                      return <TimelineSeparator item={item} key={`separator-${item.dateKey}`} />
                    }

                    return (
                      <TimelineMessage
                        displayName={displayName}
                        item={item}
                        key={
                          item.message.kind === 'persisted'
                            ? item.message._id
                            : item.message.clientId
                        }
                        onRemoveFailed={removeFailedMessage}
                        onRetryFailed={(clientId) => {
                          const message = messages.find(
                            (candidate): candidate is FailedOptimisticMessage => {
                              return (
                                candidate.kind === 'optimistic' &&
                                candidate.clientId === clientId &&
                                candidate.deliveryStatus === 'failed'
                              )
                            }
                          )

                          if (!message) {
                            return
                          }

                          void retryFailedMessage(message).catch(() => undefined)
                        }}
                      />
                    )
                  })}
                </ol>
              </div>
            ) : null}
          </section>
        </div>
      </section>

      {!isNearBottom ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] z-20 flex justify-center px-4 sm:bottom-[calc(env(safe-area-inset-bottom)+5.5rem)]">
          <button
            aria-label={
              unreadCount > 0
                ? `Scroll to latest. ${String(unreadCount)} new messages.`
                : 'Scroll to latest messages'
            }
            className="chat-control-primary chat-focus-ring pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium shadow-lg motion-reduce:transition-none"
            onClick={scrollToLatest}
            type="button"
          >
            <span aria-hidden="true" className="text-base leading-none">
              ↓
            </span>
            <span>{unreadCount > 0 ? `${String(unreadCount)} new messages` : 'Latest'}</span>
          </button>
        </div>
      ) : null}

      <MessageComposer
        description={
          hasDisplayName
            ? 'Press Enter to send. Press Shift+Enter for a new line.'
            : 'Choose a display name before sending messages.'
        }
        disabled={!hasDisplayName}
        onSubmit={handleComposerSubmit}
      />
    </main>
  )
}
