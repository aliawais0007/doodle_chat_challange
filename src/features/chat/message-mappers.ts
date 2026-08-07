import type { PersistedMessage } from '@features/chat/domain/messages'
import type { ApiMessage } from '@shared/api/contracts'

export const toPersistedMessage = (message: ApiMessage): PersistedMessage => {
  return {
    kind: 'persisted',
    _id: message._id,
    message: message.message,
    author: message.author,
    createdAt: message.createdAt,
  }
}
