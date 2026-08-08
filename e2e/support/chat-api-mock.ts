import type { Page, Request, Route } from '@playwright/test'
import type { ApiMessage } from '@shared/api/contracts'

type ChatApiMockOptions = {
  initialMessages?: ApiMessage[]
}

type RequestRecord = {
  method: string
  url: string
  query: URLSearchParams
  headers: Record<string, string>
  body?: unknown
}

const API_PATH = '/api/v1/messages'
const AUTHORIZATION_HEADER = 'Bearer test-token'

const parseJsonBody = (request: Request) => {
  const postData = request.postData()

  if (!postData) {
    return undefined
  }

  return JSON.parse(postData) as unknown
}

const compareMessagesChronologically = (left: ApiMessage, right: ApiMessage) => {
  const timestampDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt)

  if (timestampDifference !== 0) {
    return timestampDifference
  }

  return left._id.localeCompare(right._id)
}

const createUuidFromIndex = (index: number) => {
  const suffix = index.toString().padStart(12, '0')

  return `00000000-0000-4000-8000-${suffix}`
}

const toMessage = (index: number, overrides: Partial<ApiMessage> = {}): ApiMessage => {
  const createdAt = overrides.createdAt ?? new Date(Date.UTC(2025, 0, 1, 12, 0, index)).toISOString()

  return {
    _id: overrides._id ?? createUuidFromIndex(index),
    author: overrides.author ?? `Author ${String(index)}`,
    message: overrides.message ?? `Message ${String(index)}`,
    createdAt,
  }
}

export const createChatApiMock = async (page: Page, options: ChatApiMockOptions = {}) => {
  const messages = [...(options.initialMessages ?? [])].sort(compareMessagesChronologically)
  const requestLog: RequestRecord[] = []
  let nextMessageIndex = messages.length + 1
  let postFailuresRemaining = 0

  const recordRequest = (request: Request) => {
    const url = new URL(request.url())

    requestLog.push({
      method: request.method(),
      url: request.url(),
      query: url.searchParams,
      headers: request.headers(),
      ...(request.method() === 'POST' ? { body: parseJsonBody(request) } : {}),
    })
  }

  const fulfillUnauthorized = async (route: Route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      json: {
        message: 'Unauthorized',
        statusCode: 401,
        error: 'Unauthorized',
      },
    })
  }

  const fulfillValidationError = async (route: Route, message: string) => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      json: {
        error: {
          message,
          timestamp: new Date().toISOString(),
        },
      },
    })
  }

  const fulfillServerError = async (route: Route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      json: {
        error: {
          message: 'Simulated server failure',
          timestamp: new Date().toISOString(),
        },
      },
    })
  }

  await page.route('**/*', async (route) => {
    const request = route.request()
    const requestUrl = new URL(request.url())

    if (!requestUrl.pathname.endsWith(API_PATH)) {
      await route.fallback()
      return
    }

    recordRequest(request)

    const authorization = request.headers()['authorization']

    if (authorization !== AUTHORIZATION_HEADER) {
      await fulfillUnauthorized(route)
      return
    }

    if (request.method() === 'GET') {
      const limitValue = requestUrl.searchParams.get('limit')
      const limit = limitValue ? Number(limitValue) : 50
      const before = requestUrl.searchParams.get('before')
      const after = requestUrl.searchParams.get('after')

      if (before && after) {
        await fulfillValidationError(route, 'Cannot use both before and after')
        return
      }

      let result = [...messages]

      if (after) {
        result = result.filter((message) => {
          return Date.parse(message.createdAt) > Date.parse(after)
        })
      } else if (before) {
        result = result.filter((message) => {
          return Date.parse(message.createdAt) < Date.parse(before)
        })
      }

      result.sort(compareMessagesChronologically)

      if (result.length > limit) {
        result = result.slice(-limit)
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: result,
      })
      return
    }

    if (request.method() === 'POST') {
      if (postFailuresRemaining > 0) {
        postFailuresRemaining -= 1
        await fulfillServerError(route)
        return
      }

      const body = parseJsonBody(request)

      if (!body || typeof body !== 'object') {
        await fulfillValidationError(route, 'Request body must be JSON')
        return
      }

      const input = body as Record<string, unknown>
      const message = typeof input.message === 'string' ? input.message.trim() : ''
      const author = typeof input.author === 'string' ? input.author.trim() : ''

      const createdAt = new Date(Date.UTC(2025, 0, 1, 12, 0, nextMessageIndex)).toISOString()
      const persistedMessage: ApiMessage = {
        _id: createUuidFromIndex(nextMessageIndex),
        message,
        author,
        createdAt,
      }

      nextMessageIndex += 1
      messages.push(persistedMessage)
      messages.sort(compareMessagesChronologically)

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        json: persistedMessage,
      })
      return
    }

    await route.fallback()
  })

  return {
    requestLog,
    seedMessages(nextMessages: ApiMessage[]) {
      messages.splice(0, messages.length, ...nextMessages.sort(compareMessagesChronologically))
      nextMessageIndex = messages.length + 1
    },
    addRemoteMessage(overrides: Partial<ApiMessage> = {}) {
      const nextMessage = toMessage(nextMessageIndex, {
        author: overrides.author ?? 'Remote User',
        message: overrides.message ?? 'Remote message',
        createdAt: overrides.createdAt,
        _id: overrides._id,
      })

      nextMessageIndex += 1
      messages.push(nextMessage)
      messages.sort(compareMessagesChronologically)

      return nextMessage
    },
    setNextPostFailure(count = 1) {
      postFailuresRemaining = count
    },
  }
}

export const createMessageBatch = (count: number, options: { author?: string; messagePrefix?: string } = {}) => {
  return Array.from({ length: count }, (_, index) => {
    const actualIndex = index + 1

    return toMessage(actualIndex, {
      _id: createUuidFromIndex(actualIndex),
      author: options.author ?? `Author ${String(actualIndex)}`,
      message: `${options.messagePrefix ?? 'Message'} ${String(actualIndex)}`,
      createdAt: new Date(Date.UTC(2025, 0, 1, 12, 0, actualIndex)).toISOString(),
    })
  })
}