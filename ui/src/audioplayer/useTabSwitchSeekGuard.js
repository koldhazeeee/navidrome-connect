import { useCallback, useEffect, useRef } from 'react'

const SEEKBAR_SELECTOR =
  '.react-jinke-music-player .rc-slider, .react-jinke-music-player-mobile-progress .rc-slider'
const SEEK_GUARD_WINDOW_MS = 250

const isSeekbarElement = (element) => {
  return !!element?.closest?.(SEEKBAR_SELECTOR)
}

const getFocusedSeekElement = () => {
  const activeElement = document.activeElement
  if (!activeElement) {
    return null
  }

  if (
    activeElement.matches?.('.rc-slider-handle') ||
    isSeekbarElement(activeElement)
  ) {
    return activeElement
  }

  return null
}

export const useTabSwitchSeekGuard = (audioInstance) => {
  const isSeekInteractionRef = useRef(false)
  const restoreTimeRef = useRef(null)
  const guardUntilRef = useRef(0)

  useEffect(() => {
    const handleMouseDown = (event) => {
      if (isSeekbarElement(event.target)) {
        isSeekInteractionRef.current = true
      }
    }

    const handleMouseUp = () => {
      if (isSeekInteractionRef.current) {
        window.setTimeout(() => {
          getFocusedSeekElement()?.blur()
        }, 0)
      }
      isSeekInteractionRef.current = false
    }

    document.addEventListener('mousedown', handleMouseDown, true)
    document.addEventListener('mouseup', handleMouseUp, true)
    document.addEventListener('touchstart', handleMouseDown, true)
    document.addEventListener('touchend', handleMouseUp, true)
    document.addEventListener('touchcancel', handleMouseUp, true)

    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true)
      document.removeEventListener('mouseup', handleMouseUp, true)
      document.removeEventListener('touchstart', handleMouseDown, true)
      document.removeEventListener('touchend', handleMouseUp, true)
      document.removeEventListener('touchcancel', handleMouseUp, true)
    }
  }, [])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden || !audioInstance || isSeekInteractionRef.current) {
        return
      }

      const focusedSeekElement = getFocusedSeekElement()
      if (!focusedSeekElement) {
        return
      }

      restoreTimeRef.current = audioInstance.currentTime
      guardUntilRef.current = Date.now() + SEEK_GUARD_WINDOW_MS
      focusedSeekElement.blur()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [audioInstance])

  return useCallback(() => {
    if (
      !audioInstance ||
      isSeekInteractionRef.current ||
      Date.now() > guardUntilRef.current ||
      restoreTimeRef.current == null
    ) {
      return
    }

    audioInstance.currentTime = restoreTimeRef.current
    guardUntilRef.current = 0
  }, [audioInstance])
}
