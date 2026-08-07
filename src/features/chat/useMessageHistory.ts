import { useMemo } from 'react'
import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query'

import { getMessages } from '@shared/api/client'
import type { ApiMessage } from '@shared/api/contracts'
import { ApiError, API_ERROR_CATEGORIES } from '@shared/api/errors'
import {
  compareMessagesChronologically,
  getNewestPersistedTimestamp,
  mergeMessages,
  type OptimisticMessage,
  type PersistedMessage,
} from '@features/chat/domain/messages'
import { toPersistedMessage } from '@features/chat/message-mappers'
import { chatQueryKeys } from '@features/chat/query-keys'
import { useMessageSync } from '@features/chat/useMessageSync'

const DEFAULT_HISTORY_PAGE_SIZE = 50
const INITIAL_HISTORY_PAGE_PARAM: string | undefined = undefined

const getOldestTimestampFromPage = (
  page: readonly {
    createdAt: string
  }[]
): string | undefined => {
  return page[0]?.createdAt
}

const flattenHistoryPages = (
  pages: readonly (readonly ApiMessage[])[]
): PersistedMessage[] => {
  const persistedMessages = pages.flatMap((page) => page.map(toPersistedMessage))
  const deduplicatedById = new Map<string, PersistedMessage>()

  for (const message of persistedMessages) {
    deduplicatedById.set(message._id, message)
  }

  return [...deduplicatedById.values()].sort(compareMessagesChronologically)
}

const OUTGOING_MESSAGES_INITIAL_DATA: OptimisticMessage[] = []
const OPTIMISTIC_PERSISTED_MATCH_WINDOW_MS = 2 * 60 * 1000

const buildOptimisticDeduplicationKey = (message: {
  author: string
  message: string
}) => {
  return `${message.author}\u0000${message.message}`
}

const suppressRedundantOptimisticMessages = (
  persistedMessages: readonly PersistedMessage[],
  optimisticMessages: readonly OptimisticMessage[]
): OptimisticMessage[] => {
  const persistedByKey = new Map<string, number[]>()

  for (const message of persistedMessages) {
    const timestamp = Date.parse(message.createdAt)

    if (!Number.isFinite(timestamp)) {
      continue
    }

    const key = buildOptimisticDeduplicationKey(message)
    const timestamps = persistedByKey.get(key)

    if (timestamps) {
      timestamps.push(timestamp)
    } else {
      persistedByKey.set(key, [timestamp])
    }
  }

  for (const timestamps of persistedByKey.values()) {
    timestamps.sort((left, right) => left - right)
  }

  return [...optimisticMessages]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .filter((optimisticMessage) => {
      const optimisticTimestamp = Date.parse(optimisticMessage.createdAt)

      if (!Number.isFinite(optimisticTimestamp)) {
        return true
      }

      const key = buildOptimisticDeduplicationKey(optimisticMessage)
      const timestamps = persistedByKey.get(key)

      if (!timestamps || timestamps.length === 0) {
        return true
      }

      const matchingIndex = timestamps.findIndex((timestamp) => {
        return Math.abs(timestamp - optimisticTimestamp) <= OPTIMISTIC_PERSISTED_MATCH_WINDOW_MS
      })

      if (matchingIndex === -1) {
        return true
      }

      timestamps.splice(matchingIndex, 1)
      return false
    })
}

const normalizeQueryError = (error: unknown): ApiError => {
  if (error instanceof ApiError) {
    return error
  }

  return new ApiError({
    message: 'Unexpected history query error',
    category: API_ERROR_CATEGORIES.unknown,
    statusCode: undefined,
    validationIssues: undefined,
    timestamp: undefined,
  })
}

type UseMessageHistoryOptions = {
  pageSize?: number
  syncEnabled?: boolean
}

export type UseMessageHistoryResult = ReturnType<typeof useMessageHistory>

export const useMessageHistory = (options: UseMessageHistoryOptions = {}) => {
  const pageSize = options.pageSize ?? DEFAULT_HISTORY_PAGE_SIZE
  const syncEnabled = options.syncEnabled ?? false
  const historyQueryKey = useMemo(() => chatQueryKeys.history(pageSize), [pageSize])

  const query = useInfiniteQuery<
    ApiMessage[],
    ApiError,
    InfiniteData<ApiMessage[]>,
    ReturnType<typeof chatQueryKeys.history>,
    string | undefined
  >({
    queryKey: historyQueryKey,
    initialPageParam: INITIAL_HISTORY_PAGE_PARAM,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
    retryDelay: 10,
    queryFn: ({ pageParam, signal }) => {
      return getMessages(
        pageParam ? { limit: pageSize, before: pageParam } : { limit: pageSize },
        { signal }
      )
    },
    getPreviousPageParam: (firstPage) => {
      if (firstPage.length < pageSize) {
        return undefined
      }

      return getOldestTimestampFromPage(firstPage)
    },
    getNextPageParam: () => undefined,
  })

  const outgoingMessagesQuery = useQuery({
    queryKey: chatQueryKeys.outgoing(),
    queryFn: () => OUTGOING_MESSAGES_INITIAL_DATA,
    initialData: OUTGOING_MESSAGES_INITIAL_DATA,
    staleTime: Number.POSITIVE_INFINITY,
  })

  const hasInitialData = query.data !== undefined
  const persistedMessages = flattenHistoryPages(query.data?.pages ?? [])
  const deduplicatedOutgoingMessages = suppressRedundantOptimisticMessages(
    persistedMessages,
    outgoingMessagesQuery.data
  )
  const messages = mergeMessages(persistedMessages, deduplicatedOutgoingMessages)
  const newestPersistedTimestamp = getNewestPersistedTimestamp(persistedMessages)
  const messageSync = useMessageSync({
    historyQueryKey,
    enabled: query.isSuccess && syncEnabled,
    newestPersistedTimestamp,
  })

  return {
    messages,
    syncState: messageSync.syncState,
    initialLoading: query.isPending && !hasInitialData,
    initialError: !hasInitialData && query.error ? normalizeQueryError(query.error) : null,
    retry: query.refetch,
    hasOlderMessages: query.hasPreviousPage,
    loadingOlder: query.isFetchingPreviousPage,
    loadOlder: query.fetchPreviousPage,
    loadOlderError:
      hasInitialData && query.isFetchPreviousPageError ? normalizeQueryError(query.error) : null,
  }
}