import { describe, expect, it } from 'vitest'

import {
  buildTimelineItems,
  createOptimisticMessage,
  getNewestPersistedTimestamp,
  getOldestPersistedTimestamp,
  markOptimisticMessageFailed,
  markOptimisticMessageSending,
  mergeMessages,
  reconcileOptimisticMessage,
  removeOptimisticMessage,
  sortMessagesChronologically,
  type ChatMessage,
  type OptimisticMessage,
  type PersistedMessage,
} from '@features/chat/domain/messages'

const makePersistedMessage = (overrides: Partial<PersistedMessage> = {}): PersistedMessage => {
  return {
    kind: 'persisted',
    _id: overrides._id ?? '00000000-0000-4000-8000-000000000001',
    message: overrides.message ?? 'Persisted message',
    author: overrides.author ?? 'Alex',
    createdAt: overrides.createdAt ?? '2026-01-01T10:00:00.000Z',
  }
}

const makeOptimisticMessage = (overrides: Partial<OptimisticMessage> = {}): OptimisticMessage => {
  const sendingMessage: OptimisticMessage = {
    kind: 'optimistic',
    clientId: overrides.clientId ?? 'client-1',
    message: overrides.message ?? 'Optimistic message',
    author: overrides.author ?? 'Alex',
    createdAt: overrides.createdAt ?? '2026-01-01T10:00:00.000Z',
    deliveryStatus: 'sending',
  }

  if (overrides.deliveryStatus === 'failed') {
    return {
      ...sendingMessage,
      deliveryStatus: 'failed',
      errorMessage: overrides.errorMessage ?? 'Failed to send',
    }
  }

  return sendingMessage
}

const getTimelineMessages = (messages: readonly ChatMessage[]) => {
  return buildTimelineItems(messages, { locale: 'en-US', timeZone: 'UTC' }).filter(
    (item) => item.kind === 'message'
  )
}

describe('message domain', () => {
  it('handles empty arrays', () => {
    expect(mergeMessages([], [])).toEqual([])
    expect(buildTimelineItems([], { locale: 'en-US', timeZone: 'UTC' })).toEqual([])
    expect(getOldestPersistedTimestamp([])).toBeNull()
    expect(getNewestPersistedTimestamp([])).toBeNull()
  })

  it('deduplicates persisted duplicates by _id', () => {
    const duplicate = makePersistedMessage({
      _id: '00000000-0000-4000-8000-000000000010',
      message: 'New copy',
    })

    const merged = mergeMessages(
      [makePersistedMessage({ _id: duplicate._id, message: 'Old copy' })],
      [duplicate]
    )

    expect(merged).toHaveLength(1)
    expect(merged[0]).toEqual(duplicate)
  })

  it('sorts unsorted data chronologically', () => {
    const earlier = makePersistedMessage({
      _id: '00000000-0000-4000-8000-000000000001',
      createdAt: '2026-01-01T08:00:00.000Z',
    })
    const later = makePersistedMessage({
      _id: '00000000-0000-4000-8000-000000000002',
      createdAt: '2026-01-01T09:00:00.000Z',
    })

    expect(sortMessagesChronologically([later, earlier])).toEqual([earlier, later])
  })

  it('uses _id as a deterministic secondary key for equal persisted timestamps', () => {
    const a = makePersistedMessage({
      _id: '00000000-0000-4000-8000-000000000001',
      createdAt: '2026-01-01T10:00:00.000Z',
    })
    const b = makePersistedMessage({
      _id: '00000000-0000-4000-8000-000000000002',
      createdAt: '2026-01-01T10:00:00.000Z',
    })

    expect(sortMessagesChronologically([b, a])).toEqual([a, b])
  })

  it('keeps optimistic items and uses clientId identity for optimistic duplicates', () => {
    const optimistic = makeOptimisticMessage({ clientId: 'client-1', message: 'new optimistic' })
    const merged = mergeMessages(
      [makeOptimisticMessage({ clientId: 'client-1', message: 'old optimistic' })],
      [optimistic]
    )

    expect(merged).toEqual([optimistic])
  })

  it('extracts oldest and newest persisted timestamps while ignoring optimistic items', () => {
    const oldest = makePersistedMessage({ createdAt: '2026-01-01T08:00:00.000Z' })
    const newest = makePersistedMessage({
      _id: '00000000-0000-4000-8000-000000000099',
      createdAt: '2026-01-01T12:00:00.000Z',
    })

    const messages: ChatMessage[] = [
      makeOptimisticMessage({ createdAt: '2026-01-01T07:00:00.000Z' }),
      newest,
      oldest,
    ]

    expect(getOldestPersistedTimestamp(messages)).toBe(oldest.createdAt)
    expect(getNewestPersistedTimestamp(messages)).toBe(newest.createdAt)
  })

  it('reconciles an optimistic message with a persisted message', () => {
    const optimistic = makeOptimisticMessage({
      clientId: 'client-123',
      createdAt: '2026-01-01T10:00:00.000Z',
      message: 'Pending message',
    })
    const reconciled = makePersistedMessage({
      _id: '00000000-0000-4000-8000-000000000555',
      createdAt: '2026-01-01T10:00:01.000Z',
      message: 'Pending message',
    })

    const result = reconcileOptimisticMessage([optimistic], 'client-123', reconciled)

    expect(result).toEqual([reconciled])
  })

  it('creates an optimistic message with sending delivery status', () => {
    expect(
      createOptimisticMessage({
        clientId: 'client-123',
        message: 'Hello',
        author: 'Alex',
        createdAt: '2026-01-01T10:00:00.000Z',
      })
    ).toEqual({
      kind: 'optimistic',
      clientId: 'client-123',
      message: 'Hello',
      author: 'Alex',
      createdAt: '2026-01-01T10:00:00.000Z',
      deliveryStatus: 'sending',
    })
  })

  it('marks an optimistic message as failed and preserves it', () => {
    const optimistic = makeOptimisticMessage({ clientId: 'client-123' })

    expect(markOptimisticMessageFailed([optimistic], 'client-123', 'Network request failed')).toEqual([
      {
        ...optimistic,
        deliveryStatus: 'failed',
        errorMessage: 'Network request failed',
      },
    ])
  })

  it('marks a failed optimistic message as sending when retrying', () => {
    const failed = makeOptimisticMessage({
      clientId: 'client-123',
      deliveryStatus: 'failed',
      errorMessage: 'Network request failed',
    })

    expect(markOptimisticMessageSending([failed], 'client-123')).toEqual([
      {
        kind: 'optimistic',
        clientId: 'client-123',
        message: failed.message,
        author: failed.author,
        createdAt: failed.createdAt,
        deliveryStatus: 'sending',
      },
    ])
  })

  it('removes an optimistic message by clientId', () => {
    expect(
      removeOptimisticMessage(
        [makeOptimisticMessage({ clientId: 'client-1' }), makeOptimisticMessage({ clientId: 'client-2' })],
        'client-1'
      )
    ).toEqual([makeOptimisticMessage({ clientId: 'client-2' })])
  })

  it('handles out-of-order persisted responses deterministically', () => {
    const optimisticA = makeOptimisticMessage({
      clientId: 'client-a',
      createdAt: '2026-01-01T10:00:00.000Z',
      message: 'First',
    })
    const optimisticB = makeOptimisticMessage({
      clientId: 'client-b',
      createdAt: '2026-01-01T10:01:00.000Z',
      message: 'Second',
    })

    const persistedB = makePersistedMessage({
      _id: '00000000-0000-4000-8000-000000000200',
      createdAt: '2026-01-01T10:01:02.000Z',
      message: 'Second',
    })
    const persistedA = makePersistedMessage({
      _id: '00000000-0000-4000-8000-000000000100',
      createdAt: '2026-01-01T10:00:02.000Z',
      message: 'First',
    })

    const afterSecond = reconcileOptimisticMessage([optimisticA, optimisticB], 'client-b', persistedB)
    const afterFirst = reconcileOptimisticMessage(afterSecond, 'client-a', persistedA)

    expect(afterFirst).toEqual([persistedA, persistedB])
  })

  it('creates localized date separators across a date boundary', () => {
    const items = buildTimelineItems(
      [
        makePersistedMessage({ createdAt: '2026-01-01T23:59:00.000Z' }),
        makePersistedMessage({
          _id: '00000000-0000-4000-8000-000000000002',
          createdAt: '2026-01-02T00:01:00.000Z',
        }),
      ],
      { locale: 'en-US', timeZone: 'UTC' }
    )

    const separators = items.filter((item) => item.kind === 'date-separator')

    expect(separators).toHaveLength(2)
    expect(separators[0]?.label).toBe('Thursday, January 1, 2026')
    expect(separators[1]?.label).toBe('Friday, January 2, 2026')
  })

  it('creates localized date separators across a year boundary', () => {
    const items = buildTimelineItems(
      [
        makePersistedMessage({ createdAt: '2025-12-31T23:59:00.000Z' }),
        makePersistedMessage({
          _id: '00000000-0000-4000-8000-000000000002',
          createdAt: '2026-01-01T00:01:00.000Z',
        }),
      ],
      { locale: 'en-US', timeZone: 'UTC' }
    )

    const separators = items.filter((item) => item.kind === 'date-separator')

    expect(separators).toHaveLength(2)
    expect(separators[0]?.label).toBe('Wednesday, December 31, 2025')
    expect(separators[1]?.label).toBe('Thursday, January 1, 2026')
  })

  it('labels recent separators as Today and Yesterday', () => {
    const items = buildTimelineItems(
      [
        makePersistedMessage({ createdAt: '2026-01-01T09:00:00.000Z' }),
        makePersistedMessage({
          _id: '00000000-0000-4000-8000-000000000002',
          createdAt: '2026-01-02T09:00:00.000Z',
        }),
      ],
      {
        locale: 'en-US',
        timeZone: 'UTC',
        referenceDate: new Date('2026-01-02T12:00:00.000Z'),
      }
    )

    const separators = items.filter((item) => item.kind === 'date-separator')

    expect(separators).toHaveLength(2)
    expect(separators[0]?.label).toBe('Yesterday')
    expect(separators[1]?.label).toBe('Today')
  })

  it('builds same-author consecutive groups and respects grouping window', () => {
    const groupedItems = getTimelineMessages([
      makePersistedMessage({ createdAt: '2026-01-01T10:00:00.000Z', author: 'Alex' }),
      makePersistedMessage({
        _id: '00000000-0000-4000-8000-000000000002',
        createdAt: '2026-01-01T10:03:00.000Z',
        author: 'Alex',
      }),
      makePersistedMessage({
        _id: '00000000-0000-4000-8000-000000000003',
        createdAt: '2026-01-01T10:20:00.000Z',
        author: 'Alex',
      }),
      makePersistedMessage({
        _id: '00000000-0000-4000-8000-000000000004',
        createdAt: '2026-01-01T10:21:00.000Z',
        author: 'Blair',
      }),
    ])

    expect(groupedItems).toHaveLength(4)
    expect(groupedItems[0]?.grouping).toEqual({
      startsGroup: true,
      endsGroup: false,
      showAuthor: true,
    })
    expect(groupedItems[1]?.grouping).toEqual({
      startsGroup: false,
      endsGroup: true,
      showAuthor: false,
    })
    expect(groupedItems[2]?.grouping).toEqual({
      startsGroup: true,
      endsGroup: true,
      showAuthor: true,
    })
    expect(groupedItems[3]?.grouping).toEqual({
      startsGroup: true,
      endsGroup: true,
      showAuthor: true,
    })
  })

  it('supports a custom maximum grouping gap', () => {
    const items = buildTimelineItems(
      [
        makePersistedMessage({ createdAt: '2026-01-01T10:00:00.000Z', author: 'Alex' }),
        makePersistedMessage({
          _id: '00000000-0000-4000-8000-000000000002',
          createdAt: '2026-01-01T10:03:00.000Z',
          author: 'Alex',
        }),
      ],
      { locale: 'en-US', timeZone: 'UTC', maximumTimeGapMs: 60 * 1000 }
    )

    const groupedItems = items.filter((item) => item.kind === 'message')

    expect(groupedItems[0]?.grouping.startsGroup).toBe(true)
    expect(groupedItems[0]?.grouping.endsGroup).toBe(true)
    expect(groupedItems[1]?.grouping.startsGroup).toBe(true)
    expect(groupedItems[1]?.grouping.endsGroup).toBe(true)
  })

  it('separates consecutive groups when authors differ', () => {
    const groupedItems = getTimelineMessages([
      makePersistedMessage({ author: 'Alex' }),
      makePersistedMessage({
        _id: '00000000-0000-4000-8000-000000000002',
        author: 'Blair',
      }),
    ])

    expect(groupedItems[0]?.grouping.endsGroup).toBe(true)
    expect(groupedItems[1]?.grouping.startsGroup).toBe(true)
  })
})
