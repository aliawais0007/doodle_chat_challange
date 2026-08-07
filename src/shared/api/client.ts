import { ZodError, type z } from 'zod'

import {
  apiMessageListResponseSchema,
  apiMessageSchema,
  parseApiErrorResponse,
  parseCreateMessageInput,
  parseCursorRequestParams,
  type ApiMessage,
  type ApiMessageListResponse,
  type CreateMessageInput,
  type CursorRequestParams,
} from '@shared/api/contracts'
import {
  ApiError,
  API_ERROR_CATEGORIES,
  mapApiError,
} from '@shared/api/errors'
import { getEnv } from '@shared/config/env'

type RequestOptions = {
  signal?: AbortSignal
}

type JsonRequestOptions<TSchema extends z.ZodType> = RequestOptions & {
  path: string
  method: 'GET' | 'POST'
  responseSchema: TSchema
  body?: BodyInit
  query?: URLSearchParams
}

const buildUrl = (path: string, query?: URLSearchParams) => {
  const env = getEnv()
  const baseUrl = env.VITE_API_BASE_URL.endsWith('/')
    ? env.VITE_API_BASE_URL
    : `${env.VITE_API_BASE_URL}/`
  const url = new URL(path, baseUrl)

  if (query) {
    url.search = query.toString()
  }

  return url
}

const createHeaders = (hasBody: boolean) => {
  const env = getEnv()
  const headers = new Headers()

  headers.set('Accept', 'application/json')
  headers.set('Authorization', `Bearer ${env.VITE_API_TOKEN}`)

  if (hasBody) {
    headers.set('Content-Type', 'application/json')
  }

  return headers
}

const parseJsonResponse = async (response: Response): Promise<unknown> => {
  try {
    return (await response.json()) as unknown
  } catch {
    throw new ApiError({
      message: 'Response body was not valid JSON',
      statusCode: response.status,
      category: API_ERROR_CATEGORIES.malformedResponse,
      validationIssues: undefined,
      timestamp: undefined,
    })
  }
}

const parseSuccessfulResponse = <TSchema extends z.ZodType>(
  payload: unknown,
  schema: TSchema,
  statusCode: number
): z.infer<TSchema> => {
  try {
    return schema.parse(payload)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ApiError({
        message: 'Response body did not match the expected API contract',
        statusCode,
        category: API_ERROR_CATEGORIES.malformedResponse,
        validationIssues: undefined,
        timestamp: undefined,
      })
    }

    throw error
  }
}

const parseErrorResponse = (payload: unknown, statusCode: number): ApiError => {
  try {
    const parsed = parseApiErrorResponse(payload)

    return mapApiError(parsed, statusCode)
  } catch {
    return new ApiError({
      message: 'Response body did not match the expected error contract',
      statusCode,
      category: API_ERROR_CATEGORIES.malformedResponse,
      validationIssues: undefined,
      timestamp: undefined,
    })
  }
}

const requestJson = async <TSchema extends z.ZodType>({
  path,
  method,
  responseSchema,
  body,
  query,
  signal,
}: JsonRequestOptions<TSchema>): Promise<z.infer<TSchema>> => {
  try {
    const requestInit: RequestInit = {
      method,
      headers: createHeaders(body !== undefined),
      ...(body !== undefined ? { body } : {}),
      ...(signal ? { signal } : {}),
    }

    const response = await fetch(buildUrl(path, query), requestInit)

    const payload = await parseJsonResponse(response)

    if (!response.ok) {
      throw parseErrorResponse(payload, response.status)
    }

    return parseSuccessfulResponse(payload, responseSchema, response.status)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid environment configuration:')) {
      throw new ApiError({
        message: 'Chat configuration is invalid. Check the API settings and reload the page.',
        statusCode: undefined,
        category: API_ERROR_CATEGORIES.configuration,
        validationIssues: undefined,
        timestamp: undefined,
      })
    }

    if (error instanceof ApiError) {
      throw error
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError({
        message: 'Request was aborted',
        statusCode: undefined,
        category: API_ERROR_CATEGORIES.aborted,
        validationIssues: undefined,
        timestamp: undefined,
      })
    }

    if (error instanceof TypeError) {
      throw new ApiError({
        message: 'Network request failed',
        statusCode: undefined,
        category: API_ERROR_CATEGORIES.network,
        validationIssues: undefined,
        timestamp: undefined,
      })
    }

    throw error
  }
}

const buildQueryString = (params?: CursorRequestParams) => {
  if (!params) {
    return undefined
  }

  const query = new URLSearchParams()

  if (params.limit !== undefined) {
    query.set('limit', String(params.limit))
  }

  if (params.before) {
    query.set('before', params.before)
  }

  if (params.after) {
    query.set('after', params.after)
  }

  return query
}

export const getMessages = async (
  params?: CursorRequestParams,
  options?: RequestOptions
): Promise<ApiMessageListResponse> => {
  const validatedParams = parseCursorRequestParams(params ?? {})
  const query = buildQueryString(validatedParams)

  return requestJson({
    path: 'messages',
    method: 'GET',
    responseSchema: apiMessageListResponseSchema,
    ...(query ? { query } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  })
}

export const createMessage = async (
  input: CreateMessageInput,
  options?: RequestOptions
): Promise<ApiMessage> => {
  const validatedInput = parseCreateMessageInput(input)

  return requestJson({
    path: 'messages',
    method: 'POST',
    responseSchema: apiMessageSchema,
    body: JSON.stringify(validatedInput),
    ...(options?.signal ? { signal: options.signal } : {}),
  })
}