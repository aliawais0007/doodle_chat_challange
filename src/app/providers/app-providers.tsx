import { QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'

import { queryClient } from '@app/providers/query-client'
import { DisplayNameProvider } from '@features/identity'

export const AppProviders = ({ children }: PropsWithChildren) => {
  return (
    <QueryClientProvider client={queryClient}>
      <DisplayNameProvider>{children}</DisplayNameProvider>
    </QueryClientProvider>
  )
}
