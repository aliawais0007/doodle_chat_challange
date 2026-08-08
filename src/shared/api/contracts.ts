import { z } from 'zod'

const AUTHOR_PATTERN = /^[\w\s-]+$/

export const apiMessageSchema = z.object({
  _id: z.uuid('Message _id must be a valid UUID'),
  message: z
    .string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(500, 'Message cannot exceed 500 characters'),
  author: z
    .string()
    .trim()
    .min(1, 'Author must be at least 1 characters')
    .max(50, 'Author cannot exceed 50 characters')
    .regex(AUTHOR_PATTERN, {
      message: 'Author can only contain letters, numbers, spaces, hyphens, and underscores',
    }),
  createdAt: z.iso.datetime('createdAt must be a valid ISO datetime string'),
})

export const apiMessageListResponseSchema = z.array(apiMessageSchema)

export const createMessageInputSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(500, 'Message cannot exceed 500 characters'),
  author: z
    .string()
    .trim()
    .min(1, 'Author must be at least 1 characters')
    .max(50, 'Author cannot exceed 50 characters')
    .regex(AUTHOR_PATTERN, {
      message: 'Author can only contain letters, numbers, spaces, hyphens, and underscores',
    }),
})

export const cursorRequestParamsSchema = z
  .object({
    limit: z.coerce
      .number()
      .int({ message: 'Limit must be an integer.' })
      .min(1, { message: 'Limit must be at least 1.' })
      .max(1000, { message: 'Limit cannot exceed 1000.' })
      .optional(),
    after: z.iso.datetime('Invalid timestamp format').optional(),
    before: z.iso.datetime('Invalid timestamp format').optional(),
  })
  .refine((data) => !(data.after && data.before), {
    message: 'Cannot use both "after" and "before" parameters simultaneously.',
    path: ['before'],
  })

const apiValidationIssueSchema = z.object({
  field: z.string(),
  message: z.string(),
})

export const apiAuthErrorResponseSchema = z.object({
  message: z.string(),
  statusCode: z.number().int(),
  error: z.literal('Unauthorized'),
})

export const apiWrappedErrorResponseSchema = z.object({
  error: z.object({
    message: z.union([z.string(), z.array(apiValidationIssueSchema)]),
    timestamp: z.iso.datetime('Error timestamp must be a valid ISO datetime string'),
  }),
})

const apiErrorResponseSchema = z.union([apiAuthErrorResponseSchema, apiWrappedErrorResponseSchema])

export type ApiMessage = z.infer<typeof apiMessageSchema>
export type ApiMessageListResponse = z.infer<typeof apiMessageListResponseSchema>
export type CreateMessageInput = z.infer<typeof createMessageInputSchema>
export type CursorRequestParams = z.infer<typeof cursorRequestParamsSchema>
export type ApiValidationIssue = z.infer<typeof apiValidationIssueSchema>
type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>

export const parseApiMessage = (input: unknown): ApiMessage => apiMessageSchema.parse(input)
export const parseCreateMessageInput = (input: unknown): CreateMessageInput =>
  createMessageInputSchema.parse(input)
export const parseCursorRequestParams = (input: unknown): CursorRequestParams =>
  cursorRequestParamsSchema.parse(input)
export const parseApiErrorResponse = (input: unknown): ApiErrorResponse =>
  apiErrorResponseSchema.parse(input)
