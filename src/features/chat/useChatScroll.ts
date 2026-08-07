import { useCallback, useEffect, useRef, useState } from 'react'

const NEAR_BOTTOM_THRESHOLD_PX = 72

type AnchorSnapshot = {
  messageId: string
  offsetTop: number
}

const canUseDom = () => {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

const prefersReducedMotion = (): boolean => {
  if (!canUseDom() || typeof window.matchMedia !== 'function') {
    return false
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const readDistanceToBottom = (container: HTMLElement): number => {
  return container.scrollHeight - (container.scrollTop + container.clientHeight)
}

const readIsNearBottom = (container: HTMLElement): boolean => {
  return readDistanceToBottom(container) <= NEAR_BOTTOM_THRESHOLD_PX
}

const runInNextFrame = (callback: () => void) => {
  if (canUseDom() && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      callback()
    })
    return
  }

  callback()
}

export const useChatScroll = () => {
  const [containerNode, setContainerNode] = useState<HTMLElement | null>(null)
  const containerNodeRef = useRef<HTMLElement | null>(null)
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)

  const isNearBottomRef = useRef(true)
  const anchorRef = useRef<AnchorSnapshot | null>(null)

  const containerRef = useCallback((node: HTMLElement | null) => {
    containerNodeRef.current = node
    setContainerNode(node)
  }, [])

  const syncBottomState = () => {
    const container = containerNodeRef.current

    if (!container) {
      return
    }

    const nextNearBottom = readIsNearBottom(container)
    isNearBottomRef.current = nextNearBottom
    setIsNearBottom(nextNearBottom)

    if (nextNearBottom) {
      setUnreadCount(0)
    }
  }

  const jumpToLatest = (behavior: ScrollBehavior) => {
    const container = containerNodeRef.current

    if (!container) {
      return
    }

    const nextBehavior = prefersReducedMotion() ? 'auto' : behavior
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: container.scrollHeight, behavior: nextBehavior })
    } else {
      container.scrollTop = container.scrollHeight
    }

    isNearBottomRef.current = true
    setIsNearBottom(true)
    setUnreadCount(0)
  }

  const registerInitialLoad = () => {
    runInNextFrame(() => {
      jumpToLatest('auto')
    })
  }

  const registerOwnMessage = () => {
    runInNextFrame(() => {
      jumpToLatest('auto')
    })
  }

  const registerRemoteMessages = (count: number) => {
    if (count <= 0) {
      return
    }

    runInNextFrame(() => {
      if (isNearBottomRef.current) {
        jumpToLatest('auto')
        return
      }

      setUnreadCount((current) => current + count)
    })
  }

  const scrollToLatest = () => {
    runInNextFrame(() => {
      jumpToLatest('smooth')
    })
  }

  const capturePrependAnchor = () => {
    const container = containerNodeRef.current

    if (!container) {
      anchorRef.current = null
      return
    }

    const containerRect = container.getBoundingClientRect()
    const candidates = [...container.querySelectorAll<HTMLElement>('[data-message-id]')]

    const anchor = candidates.find((element) => {
      const rect = element.getBoundingClientRect()
      return rect.bottom >= containerRect.top
    })

    if (!anchor) {
      anchorRef.current = null
      return
    }

    anchorRef.current = {
      messageId: anchor.dataset.messageId ?? '',
      offsetTop: anchor.getBoundingClientRect().top - containerRect.top,
    }
  }

  const restorePrependAnchor = () => {
    const container = containerNodeRef.current
    const snapshot = anchorRef.current

    if (!container || !snapshot || snapshot.messageId.length === 0) {
      return
    }

    runInNextFrame(() => {
      const anchor = container.querySelector<HTMLElement>(`[data-message-id="${snapshot.messageId}"]`)

      if (!anchor) {
        anchorRef.current = null
        return
      }

      const containerRect = container.getBoundingClientRect()
      const nextOffsetTop = anchor.getBoundingClientRect().top - containerRect.top
      const delta = nextOffsetTop - snapshot.offsetTop

      container.scrollTop += delta
      anchorRef.current = null
      syncBottomState()
    })
  }

  useEffect(() => {
    const container = containerNode

    if (!container) {
      return
    }

    const handleScroll = () => {
      syncBottomState()
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    syncBottomState()

    return () => {
      container.removeEventListener('scroll', handleScroll)
    }
  }, [containerNode])

  return {
    containerRef,
    isNearBottom,
    unreadCount,
    scrollToLatest,
    registerInitialLoad,
    registerOwnMessage,
    registerRemoteMessages,
    capturePrependAnchor,
    restorePrependAnchor,
  }
}

export type UseChatScrollResult = ReturnType<typeof useChatScroll>