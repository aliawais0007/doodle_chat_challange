import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatScroll } from '@features/chat/useChatScroll'

const flushAnimationFrame = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

type ContainerSetup = {
  container: HTMLElement
  scrollToMock: ReturnType<typeof vi.fn>
  setMetrics: (metrics: { scrollTop: number; clientHeight: number; scrollHeight: number }) => void
}

const createContainer = (): ContainerSetup => {
  const container = document.createElement('section')

  let internalScrollTop = 0
  let internalClientHeight = 400
  let internalScrollHeight = 1200
  const scrollToMock = vi.fn(({ top }: { top: number }) => {
    internalScrollTop = top
  })

  Object.defineProperty(container, 'scrollTop', {
    configurable: true,
    get: () => internalScrollTop,
    set: (value: number) => {
      internalScrollTop = value
    },
  })

  Object.defineProperty(container, 'clientHeight', {
    configurable: true,
    get: () => internalClientHeight,
  })

  Object.defineProperty(container, 'scrollHeight', {
    configurable: true,
    get: () => internalScrollHeight,
  })

  container.scrollTo = scrollToMock as unknown as typeof container.scrollTo

  container.getBoundingClientRect = vi.fn(() => {
    return {
      x: 0,
      y: 100,
      width: 600,
      height: 400,
      top: 100,
      right: 600,
      bottom: 500,
      left: 0,
      toJSON: () => undefined,
    }
  })

  const setMetrics = (metrics: {
    scrollTop: number
    clientHeight: number
    scrollHeight: number
  }) => {
    internalScrollTop = metrics.scrollTop
    internalClientHeight = metrics.clientHeight
    internalScrollHeight = metrics.scrollHeight
  }

  return {
    container,
    scrollToMock,
    setMetrics,
  }
}

const createMessageElement = (id: string, top: number, bottom: number) => {
  const element = document.createElement('article')
  element.dataset.messageId = id
  element.getBoundingClientRect = vi.fn(() => {
    return {
      x: 0,
      y: top,
      width: 600,
      height: bottom - top,
      top,
      right: 600,
      bottom,
      left: 0,
      toJSON: () => undefined,
    }
  })

  return element
}

describe('useChatScroll', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation(() => {
        return {
          matches: false,
          media: '(prefers-reduced-motion: reduce)',
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }
      }),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('jumps to latest when initial history load finishes', async () => {
    const { result } = renderHook(() => useChatScroll())
    const { container, scrollToMock, setMetrics } = createContainer()

    setMetrics({ scrollTop: 100, clientHeight: 400, scrollHeight: 1200 })
    act(() => {
      result.current.containerRef(container)
    })

    act(() => {
      result.current.registerInitialLoad()
    })
    await flushAnimationFrame()

    expect(scrollToMock).toHaveBeenCalledWith({ top: 1200, behavior: 'auto' })
    expect(result.current.isNearBottom).toBe(true)
    expect(result.current.unreadCount).toBe(0)
  })

  it('moves to latest for own outgoing message', async () => {
    const { result } = renderHook(() => useChatScroll())
    const { container, scrollToMock, setMetrics } = createContainer()

    setMetrics({ scrollTop: 240, clientHeight: 400, scrollHeight: 1600 })
    act(() => {
      result.current.containerRef(container)
    })

    act(() => {
      result.current.registerOwnMessage()
    })
    await flushAnimationFrame()

    expect(scrollToMock).toHaveBeenCalledWith({ top: 1600, behavior: 'auto' })
  })

  it('follows remote messages near bottom and otherwise increments unread', async () => {
    const { result } = renderHook(() => useChatScroll())
    const { container, scrollToMock, setMetrics } = createContainer()

    setMetrics({ scrollTop: 730, clientHeight: 400, scrollHeight: 1200 })
    act(() => {
      result.current.containerRef(container)
    })

    act(() => {
      result.current.registerRemoteMessages(2)
    })
    await flushAnimationFrame()

    expect(scrollToMock).toHaveBeenCalledWith({ top: 1200, behavior: 'auto' })
    expect(result.current.unreadCount).toBe(0)

    setMetrics({ scrollTop: 200, clientHeight: 400, scrollHeight: 1200 })
    act(() => {
      container.dispatchEvent(new Event('scroll'))
    })

    act(() => {
      result.current.registerRemoteMessages(3)
    })
    await flushAnimationFrame()

    expect(result.current.isNearBottom).toBe(false)
    expect(result.current.unreadCount).toBe(3)
  })

  it('resets unread when user returns to bottom', () => {
    const { result } = renderHook(() => useChatScroll())
    const { container, setMetrics } = createContainer()

    act(() => {
      result.current.containerRef(container)
    })

    setMetrics({ scrollTop: 200, clientHeight: 400, scrollHeight: 1200 })
    act(() => {
      container.dispatchEvent(new Event('scroll'))
    })

    act(() => {
      result.current.registerRemoteMessages(2)
    })

    setMetrics({ scrollTop: 800, clientHeight: 400, scrollHeight: 1200 })
    act(() => {
      container.dispatchEvent(new Event('scroll'))
    })

    expect(result.current.isNearBottom).toBe(true)
    expect(result.current.unreadCount).toBe(0)
  })

  it('captures and restores prepend anchor position', async () => {
    const { result } = renderHook(() => useChatScroll())
    const { container, setMetrics } = createContainer()

    setMetrics({ scrollTop: 500, clientHeight: 400, scrollHeight: 1600 })
    act(() => {
      result.current.containerRef(container)
    })

    const anchorBefore = createMessageElement('msg-2', 180, 260)
    const neighbor = createMessageElement('msg-3', 270, 350)
    container.append(anchorBefore, neighbor)

    act(() => {
      result.current.capturePrependAnchor()
    })

    const anchorAfter = createMessageElement('msg-2', 230, 310)
    container.replaceChildren(anchorAfter, neighbor)

    act(() => {
      result.current.restorePrependAnchor()
    })
    await flushAnimationFrame()

    expect(container.scrollTop).toBe(550)
  })

  it('uses smooth explicit latest scroll unless reduced motion is enabled', async () => {
    const { result } = renderHook(() => useChatScroll())
    const { container, scrollToMock, setMetrics } = createContainer()

    setMetrics({ scrollTop: 500, clientHeight: 400, scrollHeight: 1300 })
    act(() => {
      result.current.containerRef(container)
    })

    act(() => {
      result.current.scrollToLatest()
    })
    await flushAnimationFrame()

    expect(scrollToMock).toHaveBeenCalledWith({ top: 1300, behavior: 'smooth' })

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation(() => {
        return {
          matches: true,
          media: '(prefers-reduced-motion: reduce)',
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }
      }),
    })

    act(() => {
      result.current.scrollToLatest()
    })
    await flushAnimationFrame()

    expect(scrollToMock).toHaveBeenLastCalledWith({ top: 1300, behavior: 'auto' })
  })
})
