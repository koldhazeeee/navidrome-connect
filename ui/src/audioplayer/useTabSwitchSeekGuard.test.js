import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react-hooks'
import { useTabSwitchSeekGuard } from './useTabSwitchSeekGuard'

describe('useTabSwitchSeekGuard', () => {
  let container

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    container.innerHTML = `
      <div class="react-jinke-music-player">
        <div class="rc-slider">
          <button class="rc-slider-handle" type="button"></button>
        </div>
      </div>
    `
    document.body.appendChild(container)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    document.body.removeChild(container)
  })

  it('restores playback position when the tab hides with a focused seek handle', () => {
    const audioInstance = { currentTime: 42.75 }
    const seekHandle = container.querySelector('.rc-slider-handle')
    seekHandle.focus()

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    })

    const { result } = renderHook(() => useTabSwitchSeekGuard(audioInstance))

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    audioInstance.currentTime = 38

    act(() => {
      result.current()
    })

    expect(audioInstance.currentTime).toBe(42.75)
    expect(seekHandle).not.toHaveFocus()
  })

  it('does not restore position while the seek bar is actively being dragged', () => {
    const audioInstance = { currentTime: 42.75 }
    const seekHandle = container.querySelector('.rc-slider-handle')
    seekHandle.focus()

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    })

    const { result } = renderHook(() => useTabSwitchSeekGuard(audioInstance))

    act(() => {
      seekHandle.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      )
      document.dispatchEvent(new Event('visibilitychange'))
    })

    audioInstance.currentTime = 38

    act(() => {
      result.current()
      seekHandle.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, cancelable: true }),
      )
    })

    expect(audioInstance.currentTime).toBe(38)
  })

  it('blurs the focused seek handle after pointer interaction ends', () => {
    const audioInstance = { currentTime: 42.75 }
    const seekHandle = container.querySelector('.rc-slider-handle')
    seekHandle.focus()

    renderHook(() => useTabSwitchSeekGuard(audioInstance))

    act(() => {
      seekHandle.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      )
      seekHandle.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, cancelable: true }),
      )
      vi.runAllTimers()
    })

    expect(seekHandle).not.toHaveFocus()
  })
})
