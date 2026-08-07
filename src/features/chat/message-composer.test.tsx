import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MessageComposer } from '@features/chat/message-composer'

const setup = (props?: Partial<React.ComponentProps<typeof MessageComposer>>) => {
  const onSubmit = vi.fn()

  render(<MessageComposer onSubmit={onSubmit} {...props} />)

  return {
    onSubmit,
    textarea: screen.getByLabelText('Message'),
    sendButton: screen.getByRole('button', { name: 'Send message' }),
  }
}

describe('MessageComposer', () => {
  it('submits on Enter', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    render(<MessageComposer onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Message'), 'Hello')
    await user.keyboard('{Enter}')

    expect(onSubmit).toHaveBeenCalledWith({ message: 'Hello' })
  })

  it('preserves Shift+Enter as newline without submitting', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    render(<MessageComposer onSubmit={onSubmit} />)

    const textarea = screen.getByLabelText('Message')
    await user.type(textarea, 'Hello')
    await user.keyboard('{Shift>}{Enter}{/Shift}')

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not submit while IME composing', () => {
    const onSubmit = vi.fn()
    render(<MessageComposer onSubmit={onSubmit} />)

    const textarea = screen.getByLabelText('Message')
    fireEvent.change(textarea, { target: { value: 'Hello' } })
    fireEvent.compositionStart(textarea)
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('validates trimmed empty messages and preserves text until submission succeeds', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    render(<MessageComposer onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Message'), '   ')

    await user.click(screen.getByRole('button', { name: 'Send message' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Message cannot be empty')
    expect(screen.getByLabelText<HTMLTextAreaElement>('Message').value).toBe('   ')
  })

  it('keeps the draft and reports an error when submit fails', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('Unable to send right now'))

    render(<MessageComposer onSubmit={onSubmit} />)

    const textarea = screen.getByLabelText<HTMLTextAreaElement>('Message')
    await user.type(textarea, 'Hello again')
    await user.click(screen.getByRole('button', { name: 'Send message' }))

    expect(onSubmit).toHaveBeenCalledWith({ message: 'Hello again' })
    expect(textarea.value).toBe('Hello again')
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to send right now')
  })

  it('shows a character counter near the limit', () => {
    const { textarea } = setup()

    fireEvent.change(textarea, { target: { value: 'a'.repeat(451) } })

    expect(screen.getByText('451 / 500')).toBeInTheDocument()
  })

  it('enforces a 500 character maximum during input', () => {
    const { textarea } = setup()

    fireEvent.change(textarea, {
      target: { value: 'a'.repeat(510) },
    })

    expect(textarea).toHaveValue('a'.repeat(500))
  })

  it('has an accessible description and visible send target', () => {
    const { textarea, sendButton } = setup()

    expect(textarea).toHaveAttribute('aria-describedby')
    expect(sendButton).toHaveClass('min-h-11', 'min-w-11')
  })

  it('does not rerender a parent shell while typing', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    let parentRenderCount = 0

    const Parent = () => {
      parentRenderCount += 1

      return <MessageComposer onSubmit={onSubmit} />
    }

    render(<Parent />)

    expect(parentRenderCount).toBe(1)

    await user.type(screen.getByLabelText('Message'), 'Hello world')

    expect(parentRenderCount).toBe(1)
  })
})
