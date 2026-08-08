import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'

type SubmitMessagePayload = {
  message: string
}

type MessageComposerProps = {
  onSubmit: (payload: SubmitMessagePayload) => void | Promise<void>
  disabled?: boolean
  maxLength?: number
  label?: string
  description?: string
}

const DEFAULT_MAX_LENGTH = 500
const COUNTER_VISIBILITY_THRESHOLD = 450
const MIN_ROWS = 1
const MAX_ROWS = 5

const getLineHeight = (element: HTMLTextAreaElement) => {
  const computedStyle = window.getComputedStyle(element)
  const lineHeight = Number.parseFloat(computedStyle.lineHeight)

  return Number.isFinite(lineHeight) ? lineHeight : 24
}

export const MessageComposer = ({
  onSubmit,
  disabled = false,
  maxLength = DEFAULT_MAX_LENGTH,
  label = 'Message',
  description = 'Press Enter to send. Press Shift+Enter for a new line.',
}: MessageComposerProps) => {
  const [draftMessage, setDraftMessage] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isComposing, setIsComposing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const descriptionId = useId()
  const errorId = useId()
  const counterId = useId()

  useLayoutEffect(() => {
    const textarea = textareaRef.current

    if (!textarea) {
      return
    }

    textarea.style.height = '0px'

    const lineHeight = getLineHeight(textarea)
    const verticalPadding = textarea.offsetHeight - textarea.clientHeight
    const minHeight = lineHeight * MIN_ROWS + verticalPadding
    const maxHeight = lineHeight * MAX_ROWS + verticalPadding
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)

    textarea.style.height = `${String(nextHeight)}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [draftMessage])

  const trimmedValue = draftMessage.trim()
  const isNearLimit = draftMessage.length >= COUNTER_VISIBILITY_THRESHOLD
  const describedBy = [
    descriptionId,
    isNearLimit ? counterId : null,
    validationError ? errorId : null,
  ]
    .filter(Boolean)
    .join(' ')

  const validateDraft = () => {
    if (trimmedValue.length === 0) {
      return 'Message cannot be empty'
    }

    if (draftMessage.length > maxLength) {
      return `Message cannot exceed ${String(maxLength)} characters`
    }

    return null
  }

  const toSubmitErrorMessage = (error: unknown) => {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message
    }

    return 'Unable to send message. Please try again.'
  }

  const commitSubmission = async () => {
    const nextValidationError = validateDraft()

    if (nextValidationError) {
      setValidationError(nextValidationError)
      textareaRef.current?.focus()
      return
    }

    setValidationError(null)
    const submittedMessage = draftMessage

    try {
      await onSubmit({ message: submittedMessage })
      setDraftMessage('')
      textareaRef.current?.focus()
    } catch (error) {
      setValidationError(toSubmitErrorMessage(error))
      textareaRef.current?.focus()
    }
  }

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value.slice(0, maxLength)

    setDraftMessage(nextValue)

    if (validationError) {
      setValidationError(null)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || isComposing) {
      return
    }

    event.preventDefault()

    if (disabled) {
      return
    }

    void commitSubmission()
  }

  return (
    <div className="chat-composer">
      <div className="chat-composer-shell">
        <label className="sr-only" htmlFor="message-composer">
          {label}
        </label>
        <div className="chat-composer-panel p-0 transition-shadow motion-reduce:transition-none focus-within:ring-2 focus-within:ring-[var(--app-focus-ring)]">
          <div className="flex items-end gap-2">
            <textarea
              aria-describedby={describedBy}
              aria-invalid={validationError !== null}
              className="chat-input min-h-12 flex-1 resize-none px-4 py-[0.875rem] text-base leading-6 outline-none placeholder:text-[var(--app-muted)] chat-focus-ring"
              disabled={disabled}
              id="message-composer"
              maxLength={maxLength}
              onChange={handleChange}
              onCompositionEnd={() => {
                setIsComposing(false)
              }}
              onCompositionStart={() => {
                setIsComposing(true)
              }}
              onKeyDown={handleKeyDown}
              dir="auto"
              placeholder={disabled ? 'Choose a display name to send messages' : 'Type a message'}
              ref={textareaRef}
              rows={MIN_ROWS}
              value={draftMessage}
            />
            <button
              aria-label="Send message"
              className="chat-send-button chat-focus-ring flex h-[3.3rem] min-h-11 min-w-11 items-center justify-center disabled:cursor-not-allowed motion-reduce:transition-none"
              disabled={disabled}
              onClick={() => {
                void commitSubmission()
              }}
              type="button"
            >
              Send
            </button>
          </div>
          <div className="sr-only">
            <p id={descriptionId}>{description}</p>
            {isNearLimit ? (
              <p id={counterId}>{`${String(draftMessage.length)} / ${String(maxLength)}`}</p>
            ) : null}
          </div>
          {validationError ? (
            <p
              className="px-3 pb-1 text-sm text-[var(--app-destructive)]"
              id={errorId}
              role="alert"
            >
              {validationError}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export type { MessageComposerProps }
