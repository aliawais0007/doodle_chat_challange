import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from '@app/app'
import { renderWithProviders } from '@test/renderWithProviders'

describe('App', () => {
  it('renders the application heading', () => {
    const { container } = renderWithProviders(<App />)

    expect(screen.getByText('Doodle Chat')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Choose a display name' })).toBeInTheDocument()
    expect(container.querySelector('[aria-hidden="true"][inert]')).toBeTruthy()
    expect(screen.queryByRole('main')).not.toBeInTheDocument()
  })
})
