import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type SyntheticEvent,
} from 'react'

import { useDisplayName } from '@features/identity/use-display-name'

type DisplayNameDialogProps = {
  getRestoreFocusTarget?: () => HTMLElement | null
}

type DialogContentProps = {
  displayName: string | null
  isRequired: boolean
  saveDisplayName: (
    value: string
  ) => { success: true; value: string } | { success: false; error: string }
  closeEditor: () => void
  getRestoreFocusTarget?: () => HTMLElement | null
}

const DisplayNameDialogContent = ({
  displayName,
  isRequired,
  saveDisplayName,
  closeEditor,
  getRestoreFocusTarget,
}: DialogContentProps) => {
  const [value, setValue] = useState(displayName ?? '')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  const errorId = useId()

  const getFocusableElements = () => {
    return Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    ).filter((element) => {
      return element.tabIndex >= 0
    })
  }

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') {
      return
    }

    const focusableElements = getFocusableElements()

    if (focusableElements.length === 0) {
      event.preventDefault()
      return
    }

    const activeElement = document.activeElement
    const currentIndex = focusableElements.findIndex((element) => element === activeElement)
    const firstElement = focusableElements[0]
    const lastElement = focusableElements.at(-1)

    if (event.shiftKey) {
      if (currentIndex <= 0) {
        event.preventDefault()
        lastElement?.focus()
      }

      return
    }

    if (currentIndex === -1 || currentIndex === focusableElements.length - 1) {
      event.preventDefault()
      firstElement?.focus()
    }
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      if (isRequired) {
        event.preventDefault()
        return
      }

      event.preventDefault()
      closeEditor()
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      const restoreTarget = getRestoreFocusTarget?.()

      if (restoreTarget) {
        requestAnimationFrame(() => {
          restoreTarget.focus()
        })
      }
    }
  }, [closeEditor, getRestoreFocusTarget, isRequired])

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()

    const result = saveDisplayName(value)

    if (!result.success) {
      setError(result.error)
      return
    }

    setError(null)
  }

  return (
    <div
      className="chat-dialog-overlay fixed inset-0 z-50 flex items-center justify-center px-4"
      role="presentation"
    >
      <div
        aria-describedby={error ? `${descriptionId} ${errorId}` : descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="chat-dialog-panel w-full max-w-md p-6 text-left"
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <h2 className="text-2xl font-semibold text-[var(--app-text)]" id={titleId}>
          {isRequired ? 'Choose a display name' : 'Edit display name'}
        </h2>
        <p className="chat-muted mt-3 text-sm leading-6" id={descriptionId}>
          This name is your local chat identity for future messages in this room. It is not a login
          or account.
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              className="mb-2 block text-sm font-medium text-[var(--app-text)]"
              htmlFor="display-name"
            >
              Display name
            </label>
            <input
              aria-describedby={error ? `${descriptionId} ${errorId}` : descriptionId}
              aria-invalid={error !== null}
              autoFocus
              autoComplete="nickname"
              dir="auto"
              className="chat-focus-ring w-full rounded-2xl border border-[var(--app-border-strong)] px-4 py-3 text-base text-[var(--app-text)] outline-none ring-0 transition placeholder:text-[var(--app-muted)]"
              id="display-name"
              maxLength={50}
              onChange={(event) => {
                setValue(event.target.value)
                if (error) {
                  setError(null)
                }
              }}
              ref={inputRef}
              value={value}
            />
            {error ? (
              <p className="mt-2 text-sm text-[var(--app-destructive)]" id={errorId} role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex justify-end gap-3">
            {!isRequired ? (
              <button
                className="chat-control-secondary chat-focus-ring rounded-full px-4 py-2 text-sm font-medium"
                onClick={closeEditor}
                type="button"
              >
                Cancel
              </button>
            ) : null}
            <button
              className="chat-control-primary chat-focus-ring rounded-full px-5 py-2 text-sm font-medium"
              type="submit"
            >
              Save name
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export const DisplayNameDialog = ({ getRestoreFocusTarget }: DisplayNameDialogProps) => {
  const { displayName, isDialogOpen, isRequired, saveDisplayName, closeEditor } = useDisplayName()

  if (!isDialogOpen) {
    return null
  }

  return (
    <DisplayNameDialogContent
      closeEditor={closeEditor}
      displayName={displayName}
      isRequired={isRequired}
      key={`${isRequired ? 'required' : 'optional'}-${displayName ?? 'none'}`}
      saveDisplayName={saveDisplayName}
      {...(getRestoreFocusTarget ? { getRestoreFocusTarget } : {})}
    />
  )
}
