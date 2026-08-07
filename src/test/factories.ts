type MessageFactoryInput = {
  _id?: string
  message?: string
  author?: string
  createdAt?: string
}

type Message = {
  _id: string
  message: string
  author: string
  createdAt: string
}

let sequence = 0

export const makeMessage = (overrides: MessageFactoryInput = {}): Message => {
  sequence += 1
  const suffix = String(sequence).padStart(12, '0')

  return {
    _id: overrides._id ?? `00000000-0000-4000-8000-${suffix}`,
    message: overrides.message ?? 'Placeholder message',
    author: overrides.author ?? 'Test User',
    createdAt: overrides.createdAt ?? new Date('2024-01-01T00:00:00.000Z').toISOString(),
  }
}
