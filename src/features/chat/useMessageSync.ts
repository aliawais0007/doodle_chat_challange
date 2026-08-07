import { useEffect, useRef, useState } from 'react'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'

import { getMessages } from '@shared/api/client'
import { ApiError, API_ERROR_CATEGORIES } from '@shared/api/errors'
import type { ApiMessage } from '@shared/api/contracts'

const DEFAULT_SYNC_LIMIT = 100
const DEFAULT_SYNC_INTERVAL_MS = 3000
const SYNC_CURSOR_OVERLAP_MS = 1
const INITIAL_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 8000
const MAX_BACKOFF_STEPS = 4

export type MessageSyncState = 'idle' | 'syncing' | 'delayed' | 'offline'

type UseMessageSyncOptions = {
  historyQueryKey: readonly unknown[]
  enabled: boolean
  newestPersistedTimestamp: string | null
}

const compareApiMessagesChronologically = (left: ApiMessage, right: ApiMessage): number => {
  const timestampDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt)

  if (timestampDifference !== 0) {
    return timestampDifference
  }

  return left._id.localeCompare(right._id)
}

const mergeApiMessages = (current: readonly ApiMessage[], incoming: readonly ApiMessage[]): ApiMessage[] => {
  const byId = new Map<string, ApiMessage>()

  for (const message of current) {
    byId.set(message._id, message)
  }

  for (const message of incoming) {
    byId.set(message._id, message)
  }

  return [...byId.values()].sort(compareApiMessagesChronologically)
}

const findNewestPageIndex = (pages: readonly (readonly ApiMessage[])[]): number => {
  let newestPageIndex = pages.length - 1
  let newestTimestamp = Number.NEGATIVE_INFINITY

  for (const [index, page] of pages.entries()) {
    const pageNewest = page.at(-1)

    if (!pageNewest) {
      continue
    }

    const pageTimestamp = Date.parse(pageNewest.createdAt)

    if (pageTimestamp > newestTimestamp) {
      newestTimestamp = pageTimestamp
      newestPageIndex = index
    }
  }

  return newestPageIndex
}

const mergeIncomingIntoHistory = (
  historyData: InfiniteData<ApiMessage[]> | undefined,
  incoming: readonly ApiMessage[]
): InfiniteData<ApiMessage[]> | undefined => {
  if (!historyData || incoming.length === 0) {
    return historyData
  }

  if (historyData.pages.length === 0) {
    return historyData
  }

  const nextPages = [...historyData.pages]
  const newestPageIndex = findNewestPageIndex(nextPages)
  const targetPage = nextPages[newestPageIndex] ?? []
  const mergedPage = mergeApiMessages(targetPage, incoming)

  const unchanged =
    mergedPage.length === targetPage.length &&
    mergedPage.every((message, index) => {
      return targetPage[index]?._id === message._id
    })

  if (unchanged) {
    return historyData
  }

  nextPages[newestPageIndex] = mergedPage

  return {
    pageParams: historyData.pageParams,
    pages: nextPages,
  }
}

const calculateBackoffDelay = (step: number): number => {
  const boundedStep = Math.min(step, MAX_BACKOFF_STEPS)

  return Math.min(INITIAL_BACKOFF_MS * 2 ** boundedStep, MAX_BACKOFF_MS)
}

const canUseBrowserApis = () => {
  return typeof window !== 'undefined' && typeof document !== 'undefined' && typeof navigator !== 'undefined'
}

const buildAfterCursor = (newestPersistedTimestamp: string): string => {
  const newestTimestampMs = Date.parse(newestPersistedTimestamp)

  if (!Number.isFinite(newestTimestampMs)) {
    return newestPersistedTimestamp
  }

  return new Date(newestTimestampMs - SYNC_CURSOR_OVERLAP_MS).toISOString()
}

const isRecoverableSyncApiError = (error: ApiError): boolean => {
  return (
    error.category === API_ERROR_CATEGORIES.network ||
    error.category === API_ERROR_CATEGORIES.timeout ||
    error.category === API_ERROR_CATEGORIES.server ||
    error.category === API_ERROR_CATEGORIES.malformedResponse ||
    error.category === API_ERROR_CATEGORIES.unknown
  )
}

export const useMessageSync = ({
  historyQueryKey,
  enabled,
  newestPersistedTimestamp,
}: UseMessageSyncOptions) => {
  const queryClient = useQueryClient()
  const [syncState, setSyncState] = useState<MessageSyncState>('idle')

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef(false)
  const backoffStepRef = useRef(0)

  const clearScheduledTimeout = () => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }

  const cancelInFlight = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    inFlightRef.current = false
  }

  useEffect(() => {
    if (!canUseBrowserApis()) {
      return
    }

    let active = true

    const schedule = (delayMs: number) => {
      clearScheduledTimeout()

      timeoutRef.current = setTimeout(() => {
        void runSyncCycle()
      }, delayMs)
    }

    const runSyncCycle = async () => {
      if (!active || !enabled || inFlightRef.current) {
        return
      }

      if (document.hidden) {
        setSyncState('idle')
        return
      }

      if (!navigator.onLine) {
        setSyncState('offline')
        return
      }

      if (!newestPersistedTimestamp) {
        setSyncState('idle')
        schedule(DEFAULT_SYNC_INTERVAL_MS)
        return
      }

      const controller = new AbortController()

      abortControllerRef.current = controller
      inFlightRef.current = true
      setSyncState('syncing')

      try {
        const incoming = await getMessages(
          {
            after: buildAfterCursor(newestPersistedTimestamp),
            limit: DEFAULT_SYNC_LIMIT,
          },
          { signal: controller.signal }
        )

        queryClient.setQueryData<InfiniteData<ApiMessage[]>>(historyQueryKey, (current) => {
          return mergeIncomingIntoHistory(current, incoming)
        })

        backoffStepRef.current = 0
        setSyncState('idle')
        schedule(DEFAULT_SYNC_INTERVAL_MS)
      } catch (error) {
        if (error instanceof ApiError && error.category === API_ERROR_CATEGORIES.aborted) {
          setSyncState('idle')
          return
        }

        if (error instanceof ApiError && !isRecoverableSyncApiError(error)) {
          setSyncState('idle')
          clearScheduledTimeout()
          return
        }

        backoffStepRef.current = Math.min(backoffStepRef.current + 1, MAX_BACKOFF_STEPS)
        setSyncState('delayed')
        schedule(calculateBackoffDelay(backoffStepRef.current))
      } finally {
        inFlightRef.current = false
        abortControllerRef.current = null
      }
    }

    if (!enabled) {
      clearScheduledTimeout()
      cancelInFlight()
      return
    }

    void runSyncCycle()

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearScheduledTimeout()
        cancelInFlight()
        setSyncState('idle')
        return
      }

      backoffStepRef.current = 0
      void runSyncCycle()
    }

    const handleFocus = () => {
      if (document.hidden || !navigator.onLine) {
        return
      }

      backoffStepRef.current = 0
      void runSyncCycle()
    }

    const handleOffline = () => {
      clearScheduledTimeout()
      cancelInFlight()
      setSyncState('offline')
    }

    const handleOnline = () => {
      backoffStepRef.current = 0
      void runSyncCycle()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)

    return () => {
      active = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      clearScheduledTimeout()
      cancelInFlight()
    }
  }, [enabled, historyQueryKey, newestPersistedTimestamp, queryClient])

  return {
    syncState,
  }
}