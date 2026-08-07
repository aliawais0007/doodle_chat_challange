export type PersistedMessage = {
  kind: 'persisted'
  _id: string
  message: string
  author: string
  createdAt: string
}

type OptimisticMessageBase = {
  kind: 'optimistic'
  clientId: string
  message: string
  author: string
  createdAt: string
}

export type SendingOptimisticMessage = OptimisticMessageBase & {
  deliveryStatus: 'sending'
}

export type FailedOptimisticMessage = OptimisticMessageBase & {
  deliveryStatus: 'failed'
  errorMessage: string
}

export type OptimisticMessage = SendingOptimisticMessage | FailedOptimisticMessage

export type ChatMessage = PersistedMessage | OptimisticMessage

export type TimelineDateSeparatorItem = {
  kind: 'date-separator'
  dateKey: string
  label: string
}

export type TimelineMessageItem = {
  kind: 'message'
  message: ChatMessage
  grouping: {
    startsGroup: boolean
    endsGroup: boolean
    showAuthor: boolean
  }
}

export type TimelineItem = TimelineDateSeparatorItem | TimelineMessageItem

type TimelineMessageSnapshot = {
  message: ChatMessage
  timestamp: number
  dateKey: string
}

export type BuildTimelineOptions = {
  locale?: Intl.LocalesArgument
  timeZone?: string
  maximumTimeGapMs?: number
  dateStyle?: Intl.DateTimeFormatOptions['dateStyle']
  referenceDate?: Date
}

const DEFAULT_MAXIMUM_TIME_GAP_MS = 5 * 60 * 1000

const isPersistedMessage = (message: ChatMessage): message is PersistedMessage => {
  return message.kind === 'persisted'
}

const isOptimisticMessage = (message: ChatMessage): message is OptimisticMessage => {
  return message.kind === 'optimistic'
}

const getTimestamp = (message: ChatMessage): number => {
  return Date.parse(message.createdAt)
}

const compareMessageIdentity = (left: ChatMessage, right: ChatMessage): number => {
  if (isPersistedMessage(left) && isPersistedMessage(right)) {
    return left._id.localeCompare(right._id)
  }

  if (isOptimisticMessage(left) && isOptimisticMessage(right)) {
    return left.clientId.localeCompare(right.clientId)
  }

  return isPersistedMessage(left) ? -1 : 1
}

const createDateKeyFormatter = (timeZone?: string) => {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  })
}

const getDateKey = (createdAt: string, timeZone?: string): string => {
  const parts = createDateKeyFormatter(timeZone).formatToParts(new Date(createdAt))

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  if (!year || !month || !day) {
    throw new Error('Could not derive a date key from createdAt')
  }

  return `${year}-${month}-${day}`
}

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000

const normalizeTimelineMessage = (message: ChatMessage, timeZone?: string): TimelineMessageSnapshot => {
  return {
    message,
    timestamp: getTimestamp(message),
    dateKey: getDateKey(message.createdAt, timeZone),
  }
}

const compareTimelineMessageSnapshots = (
  left: TimelineMessageSnapshot,
  right: TimelineMessageSnapshot
): number => {
  const timestampDifference = left.timestamp - right.timestamp

  if (timestampDifference !== 0) {
    return timestampDifference
  }

  return compareMessageIdentity(left.message, right.message)
}

const getRelativeDateLabel = (
  createdAt: string,
  dateFormatter: Intl.DateTimeFormat,
  options: {
    referenceDate: Date | undefined
    timeZone: string | undefined
  }
): string => {
  const referenceDate = options.referenceDate ?? new Date()
  const currentDateKey = getDateKey(createdAt, options.timeZone)
  const todayDateKey = getDateKey(referenceDate.toISOString(), options.timeZone)
  const yesterdayDateKey = getDateKey(
    new Date(referenceDate.getTime() - MILLIS_PER_DAY).toISOString(),
    options.timeZone
  )

  if (currentDateKey === todayDateKey) {
    return 'Today'
  }

  if (currentDateKey === yesterdayDateKey) {
    return 'Yesterday'
  }

  return dateFormatter.format(new Date(createdAt))
}

const shouldGroupConsecutiveMessages = (
  current: ChatMessage,
  next: ChatMessage,
  options: {
    timeZone: string | undefined
    maximumTimeGapMs: number | undefined
  }
): boolean => {
  if (current.author !== next.author) {
    return false
  }

  if (getDateKey(current.createdAt, options.timeZone) !== getDateKey(next.createdAt, options.timeZone)) {
    return false
  }

  const maximumTimeGapMs = options.maximumTimeGapMs ?? DEFAULT_MAXIMUM_TIME_GAP_MS

  return getTimestamp(next) - getTimestamp(current) <= maximumTimeGapMs
}

export const compareMessagesChronologically = (left: ChatMessage, right: ChatMessage): number => {
  const timestampDifference = getTimestamp(left) - getTimestamp(right)

  if (timestampDifference !== 0) {
    return timestampDifference
  }

  return compareMessageIdentity(left, right)
}

export const sortMessagesChronologically = (messages: readonly ChatMessage[]): ChatMessage[] => {
  return [...messages].sort(compareMessagesChronologically)
}

export const mergeMessages = (
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[]
): ChatMessage[] => {
  const persistedMessages = new Map<string, PersistedMessage>()
  const optimisticMessages = new Map<string, OptimisticMessage>()

  for (const message of [...current, ...incoming]) {
    if (isPersistedMessage(message)) {
      persistedMessages.set(message._id, message)
      continue
    }

    optimisticMessages.set(message.clientId, message)
  }

  return sortMessagesChronologically([
    ...persistedMessages.values(),
    ...optimisticMessages.values(),
  ])
}

export const createOptimisticMessage = (input: {
  clientId: string
  message: string
  author: string
  createdAt: string
}): OptimisticMessage => {
  return {
    kind: 'optimistic',
    clientId: input.clientId,
    message: input.message,
    author: input.author,
    createdAt: input.createdAt,
    deliveryStatus: 'sending',
  }
}

export const reconcileOptimisticMessage = (
  messages: readonly ChatMessage[],
  clientId: string,
  persistedMessage: PersistedMessage
): ChatMessage[] => {
  const withoutOptimisticMessage = messages.filter((message) => {
    return !(isOptimisticMessage(message) && message.clientId === clientId)
  })

  return mergeMessages(withoutOptimisticMessage, [persistedMessage])
}

export const markOptimisticMessageFailed = (
  messages: readonly ChatMessage[],
  clientId: string,
  errorMessage: string
): ChatMessage[] => {
  return messages.map((message) => {
    if (!isOptimisticMessage(message) || message.clientId !== clientId) {
      return message
    }

    return {
      kind: 'optimistic',
      clientId: message.clientId,
      message: message.message,
      author: message.author,
      createdAt: message.createdAt,
      deliveryStatus: 'failed',
      errorMessage,
    }
  })
}

export const markOptimisticMessageSending = (
  messages: readonly ChatMessage[],
  clientId: string
): ChatMessage[] => {
  return messages.map((message) => {
    if (!isOptimisticMessage(message) || message.clientId !== clientId) {
      return message
    }

    return {
      kind: 'optimistic',
      clientId: message.clientId,
      message: message.message,
      author: message.author,
      createdAt: message.createdAt,
      deliveryStatus: 'sending',
    }
  })
}

export const removeOptimisticMessage = (
  messages: readonly ChatMessage[],
  clientId: string
): ChatMessage[] => {
  return messages.filter((message) => {
    return !(isOptimisticMessage(message) && message.clientId === clientId)
  })
}

export const getOldestPersistedTimestamp = (messages: readonly ChatMessage[]): string | null => {
  let oldestMessage: PersistedMessage | null = null

  for (const message of messages) {
    if (!isPersistedMessage(message)) {
      continue
    }

    if (!oldestMessage || compareMessagesChronologically(message, oldestMessage) < 0) {
      oldestMessage = message
    }
  }

  return oldestMessage?.createdAt ?? null
}

export const getNewestPersistedTimestamp = (messages: readonly ChatMessage[]): string | null => {
  let newestMessage: PersistedMessage | null = null

  for (const message of messages) {
    if (!isPersistedMessage(message)) {
      continue
    }

    if (!newestMessage || compareMessagesChronologically(message, newestMessage) > 0) {
      newestMessage = message
    }
  }

  return newestMessage?.createdAt ?? null
}

export const buildTimelineItems = (
  messages: readonly ChatMessage[],
  options: BuildTimelineOptions = {}
): TimelineItem[] => {
  const referenceDate = options.referenceDate ?? new Date()
  const sortedMessages = messages.map((message) => {
    return normalizeTimelineMessage(message, options.timeZone)
  })

  sortedMessages.sort(compareTimelineMessageSnapshots)

  if (sortedMessages.length === 0) {
    return []
  }

  const dateFormatter = new Intl.DateTimeFormat(options.locale, {
    dateStyle: options.dateStyle ?? 'full',
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  })

  const items: TimelineItem[] = []

  for (const [index, message] of sortedMessages.entries()) {
    const previousMessage = sortedMessages[index - 1]
    const nextMessage = sortedMessages[index + 1]
    const currentDateKey = message.dateKey
    const previousDateKey = previousMessage?.dateKey ?? null

    if (currentDateKey !== previousDateKey) {
      items.push({
        kind: 'date-separator',
        dateKey: currentDateKey,
        label: getRelativeDateLabel(message.message.createdAt, dateFormatter, {
          referenceDate,
          timeZone: options.timeZone,
        }),
      })
    }

    const startsGroup =
      !previousMessage ||
      !shouldGroupConsecutiveMessages(previousMessage.message, message.message, {
        timeZone: options.timeZone,
        maximumTimeGapMs: options.maximumTimeGapMs,
      })

    const endsGroup =
      !nextMessage ||
      !shouldGroupConsecutiveMessages(message.message, nextMessage.message, {
        timeZone: options.timeZone,
        maximumTimeGapMs: options.maximumTimeGapMs,
      })

    items.push({
      kind: 'message',
      message: message.message,
      grouping: {
        startsGroup,
        endsGroup,
        showAuthor: startsGroup,
      },
    })
  }

  return items
}
