import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, renderHook } from '@testing-library/react'
import type { PropsWithChildren, ReactElement } from 'react'

import { DisplayNameProvider } from '@features/identity'

export const createTestQueryClient = () => {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

const createWrapper = (queryClient: QueryClient) => {
  const Wrapper = ({ children }: PropsWithChildren) => {
    return (
      <QueryClientProvider client={queryClient}>
        <DisplayNameProvider>{children}</DisplayNameProvider>
      </QueryClientProvider>
    )
  }

  return Wrapper
}

export const renderWithProviders = (ui: ReactElement) => {
  const queryClient = createTestQueryClient()

  const result = render(ui, {
    wrapper: createWrapper(queryClient),
  })

  return {
    ...result,
    queryClient,
  }
}

export const renderHookWithProviders = <TResult,>(callback: () => TResult) => {
  const queryClient = createTestQueryClient()

  const result = renderHook(callback, {
    wrapper: createWrapper(queryClient),
  })

  return {
    ...result,
    queryClient,
  }
}
