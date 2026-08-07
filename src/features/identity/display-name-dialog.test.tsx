import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { App } from '@app/app'
import { renderWithProviders } from '@test/renderWithProviders'

describe('DisplayNameDialog', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('focuses the input when the required dialog opens', () => {
    renderWithProviders(<App />)

    expect(screen.getByLabelText('Display name')).toHaveFocus()
  })

  it('keeps keyboard focus trapped inside the dialog', async () => {
    const user = userEvent.setup()

    renderWithProviders(<App />)

    const input = screen.getByLabelText('Display name')
    const saveButton = screen.getByRole('button', { name: 'Save name' })

    expect(input).toHaveFocus()

    saveButton.focus()
    expect(saveButton).toHaveFocus()

    await user.tab()
    expect(input).toHaveFocus()

    input.focus()
    await user.tab({ shift: true })
    expect(saveButton).toHaveFocus()
  })

  it('prevents escape from closing the initial required dialog', async () => {
    const user = userEvent.setup()

    renderWithProviders(<App />)

    await user.keyboard('{Escape}')

    expect(screen.getByRole('dialog', { name: 'Choose a display name' })).toBeInTheDocument()
  })

  it('explains that the display name is chat identity, not login', () => {
    renderWithProviders(<App />)

    expect(
      screen.getByText(/This name is your local chat identity for future messages in this room/i)
    ).toBeInTheDocument()
  })

  it('allows saving a name and editing later', async () => {
    const user = userEvent.setup()

    renderWithProviders(<App />)

    await user.type(screen.getByLabelText('Display name'), 'Awais')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    expect(screen.getByRole('button', { name: 'Edit name' })).toBeInTheDocument()
    expect(screen.getByText(/Changes affect future messages only/i)).toBeInTheDocument()
  })

  it('restores focus to the edit trigger when closing existing identity editing with escape', async () => {
    const user = userEvent.setup()

    renderWithProviders(<App />)

    await user.type(screen.getByLabelText('Display name'), 'Awais')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    const editButton = screen.getByRole('button', { name: 'Edit name' })
    await user.click(editButton)

    expect(screen.getByRole('dialog', { name: 'Edit display name' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Edit display name' })).not.toBeInTheDocument()

    await waitFor(() => {
      expect(editButton).toHaveFocus()
    })
  })

  it('uses RTL-aware input direction for the display name field', () => {
    renderWithProviders(<App />)

    expect(screen.getByLabelText('Display name')).toHaveAttribute('dir', 'auto')
  })

  it('is keyboard accessible for editing existing identity', async () => {
    const user = userEvent.setup()

    renderWithProviders(<App />)

    await user.type(screen.getByLabelText('Display name'), 'Awais')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    await user.click(screen.getByRole('button', { name: 'Edit name' }))
    await user.clear(screen.getByLabelText('Display name'))
    await user.type(screen.getByLabelText('Display name'), 'Awais Khan')
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('dialog', { name: 'Edit display name' })).not.toBeInTheDocument()
    expect(screen.getByText(/Chatting as Awais Khan/i)).toBeInTheDocument()
  })
})
