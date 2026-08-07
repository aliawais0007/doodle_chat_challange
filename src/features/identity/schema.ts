import { z } from 'zod'

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Display name is required')
  .max(50, 'Display name cannot exceed 50 characters')
  .regex(/^[\w\s-]+$/, {
    message: 'Display name can only contain letters, numbers, spaces, hyphens, and underscores',
  })

export type DisplayName = z.infer<typeof displayNameSchema>

export const validateDisplayName = (value: unknown): DisplayName => {
  return displayNameSchema.parse(value)
}