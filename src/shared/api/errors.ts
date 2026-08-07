import {
  apiAuthErrorResponseSchema,
  apiWrappedErrorResponseSchema,
  type ApiValidationIssue,
} from '@shared/api/contracts'

export const API_ERROR_CATEGORIES = {
  configuration: 'CONFIGURATION',
  unauthorized: 'UNAUTHORIZED',
  validation: 'VALIDATION',
  notFound: 'NOT_FOUND',
  timeout: 'TIMEOUT',
  server: 'SERVER',
  network: 'NETWORK',
  malformedResponse: 'MALFORMED_RESPONSE',
  aborted: 'ABORTED',
  unknown: 'UNKNOWN',
} as const

export type ApiErrorCategory =
  (typeof API_ERROR_CATEGORIES)[keyof typeof API_ERROR_CATEGORIES]

export class ApiError extends Error {
  public readonly category: ApiErrorCategory
  public readonly statusCode: number | undefined
  public readonly validationIssues: ApiValidationIssue[] | undefined
  public readonly timestamp: string | undefined

  public constructor(params: {
    message: string
    category: ApiErrorCategory
    statusCode: number | undefined
    validationIssues: ApiValidationIssue[] | undefined
    timestamp: string | undefined
  }) {
    super(params.message)
    this.name = 'ApiError'
    this.category = params.category
    this.statusCode = params.statusCode
    this.validationIssues = params.validationIssues
    this.timestamp = params.timestamp
  }
}

const categoryFromStatusCode = (statusCode?: number): ApiErrorCategory => {
  if (statusCode === 401) {
    return API_ERROR_CATEGORIES.unauthorized
  }

  if (statusCode === 404) {
    return API_ERROR_CATEGORIES.notFound
  }

  if (statusCode === 408) {
    return API_ERROR_CATEGORIES.timeout
  }

  if (typeof statusCode === 'number' && statusCode >= 500) {
    return API_ERROR_CATEGORIES.server
  }

  return API_ERROR_CATEGORIES.unknown
}

export const mapApiError = (input: unknown, statusCode?: number): ApiError => {
  const authParsed = apiAuthErrorResponseSchema.safeParse(input)

  if (authParsed.success) {
    return new ApiError({
      message: authParsed.data.message,
      statusCode: authParsed.data.statusCode,
      category: API_ERROR_CATEGORIES.unauthorized,
      validationIssues: undefined,
      timestamp: undefined,
    })
  }

  const wrappedParsed = apiWrappedErrorResponseSchema.safeParse(input)

  if (wrappedParsed.success) {
    const payload = wrappedParsed.data.error

    if (Array.isArray(payload.message)) {
      return new ApiError({
        message: 'Validation failed',
        statusCode,
        category: API_ERROR_CATEGORIES.validation,
        validationIssues: payload.message,
        timestamp: payload.timestamp,
      })
    }

    return new ApiError({
      message: payload.message,
      statusCode,
      category: categoryFromStatusCode(statusCode),
      validationIssues: undefined,
      timestamp: payload.timestamp,
    })
  }

  return new ApiError({
    message: 'Unexpected API error response',
    statusCode,
    category: categoryFromStatusCode(statusCode),
    validationIssues: undefined,
    timestamp: undefined,
  })
}
