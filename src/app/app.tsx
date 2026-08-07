import { useRef } from 'react'

import { ChatErrorBoundary } from '@app/chat-error-boundary'
import { ChatScreenContent } from '@features/chat/chat-screen'
import { DisplayNameDialog } from '@features/identity'
import { useDisplayName } from '@features/identity/use-display-name'

export const App = () => {
  const editButtonRef = useRef<HTMLButtonElement | null>(null)
  const { isDialogOpen } = useDisplayName()

  return (
    <ChatErrorBoundary>
      <div aria-hidden={isDialogOpen} inert={isDialogOpen || undefined}>
        <ChatScreenContent editButtonRef={editButtonRef} />
      </div>
      <DisplayNameDialog getRestoreFocusTarget={() => editButtonRef.current} />
    </ChatErrorBoundary>
  )
}
