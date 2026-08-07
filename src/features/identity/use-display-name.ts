import { useContext } from 'react'

import { DisplayNameContext } from '@features/identity/display-name-context-value'

export const useDisplayName = () => {
  const context = useContext(DisplayNameContext)

  if (!context) {
    throw new Error('useDisplayName must be used within a DisplayNameProvider')
  }

  return context
}