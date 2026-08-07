import { useMutation, useQueryClient } from '@tanstack/react-query'

import { createMessage } from '@shared/api/client'
import { parseCreateMessageInput, type CreateMessageInput } from '@shared/api/contracts'
import type { ApiError } from '@shared/api/errors'
import type {
  ChatMessage,
  FailedOptimisticMessage,
  PersistedMessage,
} from '@features/chat/domain/messages'
import {
  createOptimisticMessage,
  markOptimisticMessageFailed,
  markOptimisticMessageSending,
  mergeMessages,
  reconcileOptimisticMessage,
  removeOptimisticMessage,
} from '@features/chat/domain/messages'
import { toPersistedMessage } from '@features/chat/message-mappers'
import { chatQueryKeys } from '@features/chat/query-keys'

const OUTGOING_MESSAGES_INITIAL_DATA: ChatMessage[] = []

const getOutgoingMessages = (current: ChatMessage[] | undefined): ChatMessage[] => {
  return current ?? OUTGOING_MESSAGES_INITIAL_DATA
}

type SendMessageVariables = CreateMessageInput & {
  clientId?: string
}

type SendMessageContext = {
  clientId: string
}

export const useSendMessage = () => {
  const queryClient = useQueryClient()

  const mutation = useMutation<PersistedMessage, ApiError, SendMessageVariables, SendMessageContext>({
    mutationFn: async (variables) => {
      const persistedMessage = await createMessage(
        parseCreateMessageInput({
          author: variables.author,
          message: variables.message,
        })
      )

      return toPersistedMessage(persistedMessage)
    },
    onMutate: ({ clientId, ...input }) => {
      const validatedInput = parseCreateMessageInput(input)
      const resolvedClientId = clientId ?? crypto.randomUUID()
      const optimisticMessage = createOptimisticMessage({
        clientId: resolvedClientId,
        message: validatedInput.message,
        author: validatedInput.author,
        createdAt: new Date().toISOString(),
      })

      queryClient.setQueryData<ChatMessage[]>(chatQueryKeys.outgoing(), (current) => {
        return mergeMessages(getOutgoingMessages(current), [optimisticMessage])
      })

      return {
        clientId: resolvedClientId,
      }
    },
    onSuccess: (persistedMessage, _variables, context: SendMessageContext) => {
      queryClient.setQueryData<ChatMessage[]>(chatQueryKeys.outgoing(), (current) => {
        return reconcileOptimisticMessage(
          getOutgoingMessages(current),
          context.clientId,
          persistedMessage
        )
      })
    },
    onError: (error, _variables, context: SendMessageContext | undefined) => {
      if (context === undefined) {
        return
      }

      queryClient.setQueryData<ChatMessage[]>(chatQueryKeys.outgoing(), (current) => {
        return markOptimisticMessageFailed(
          getOutgoingMessages(current),
          context.clientId,
          error.message
        )
      })
    },
  })

  const retryFailedMessage = async (message: FailedOptimisticMessage) => {
    queryClient.setQueryData<ChatMessage[]>(chatQueryKeys.outgoing(), (current) => {
      return markOptimisticMessageSending(getOutgoingMessages(current), message.clientId)
    })

    await mutation.mutateAsync({
      clientId: message.clientId,
      author: message.author,
      message: message.message,
    })
  }

  const removeFailedMessage = (clientId: string) => {
    queryClient.setQueryData<ChatMessage[]>(chatQueryKeys.outgoing(), (current) => {
      return removeOptimisticMessage(getOutgoingMessages(current), clientId)
    })
  }

  return {
    sendMessage: mutation.mutateAsync,
    retryFailedMessage,
    removeFailedMessage,
  }
}