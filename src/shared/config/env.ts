import { z } from 'zod'

const envSchema = z.object({
  VITE_API_BASE_URL: z.url('VITE_API_BASE_URL must be a valid URL'),
  VITE_API_TOKEN: z.string().min(1, 'VITE_API_TOKEN is required'),
})

export type Env = z.infer<typeof envSchema>

export const validateEnv = (source: unknown): Env => {
  const parsed = envSchema.safeParse(source)

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')

    throw new Error(`Invalid environment configuration: ${issues}`)
  }

  return parsed.data
}

export const getEnv = (): Env => {
  return validateEnv(import.meta.env)
}
