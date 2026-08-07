import { Component, type ReactNode } from 'react'

type ChatErrorBoundaryProps = {
  children: ReactNode
}

type ChatErrorBoundaryState = {
  hasError: boolean
}

const FallbackView = ({ onRetry }: { onRetry: () => void }) => {
  return (
    <main className="chat-page flex min-h-dvh items-center justify-center px-6 py-10 text-center">
      <div className="chat-dialog-panel w-full max-w-md px-6 py-8">
        <h1 className="text-xl font-semibold text-[var(--app-text)]">Something went wrong</h1>
        <p className="chat-muted mt-2 text-sm">
          The chat interface could not render. Your messages and history were not lost.
        </p>
        <button
          className="chat-control-primary chat-focus-ring mt-5 min-h-11 rounded-full px-5 py-2 text-sm font-medium"
          onClick={onRetry}
          type="button"
        >
          Retry
        </button>
      </div>
    </main>
  )
}

export class ChatErrorBoundary extends Component<ChatErrorBoundaryProps, ChatErrorBoundaryState> {
  public state: ChatErrorBoundaryState = {
    hasError: false,
  }

  public static getDerivedStateFromError(): ChatErrorBoundaryState {
    return {
      hasError: true,
    }
  }

  public componentDidCatch() {}

  public render() {
    if (this.state.hasError) {
      return (
        <FallbackView
          onRetry={() => {
            this.setState({ hasError: false })
          }}
        />
      )
    }

    return this.props.children
  }
}
