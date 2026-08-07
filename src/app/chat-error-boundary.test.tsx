import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChatErrorBoundary } from '@app/chat-error-boundary'
import { renderWithProviders } from '@test/renderWithProviders'

const ThrowingChild = () => {
  throw new Error('render failure')
}

describe('ChatErrorBoundary', () => {
  it('shows a generic fallback for unexpected rendering errors', () => {
    renderWithProviders(
      <ChatErrorBoundary>
        <ThrowingChild />
      </ChatErrorBoundary>
    )

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'The chat interface could not render. Your messages and history were not lost.'
      )
    ).toBeInTheDocument()
  })
})
