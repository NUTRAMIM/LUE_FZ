import { useRef, useState, useCallback } from 'react'
import { shouldTriggerReply } from './reply-helpers'

const MAX_DRAG_PX = 80

export function useSwipeToReply(onTrigger: () => void) {
  const [dx, setDx] = useState(0)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const activeRef = useRef(false)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return
    startRef.current = { x: e.clientX, y: e.clientY }
    activeRef.current = false
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const start = startRef.current
    if (!start) return
    const rawDx = e.clientX - start.x
    const rawDy = e.clientY - start.y
    if (!activeRef.current) {
      if (Math.abs(rawDx) <= Math.abs(rawDy) || rawDx <= 0) {
        if (Math.abs(rawDy) > 10) startRef.current = null
        return
      }
      activeRef.current = true
    }
    const clamped = Math.max(0, Math.min(rawDx, MAX_DRAG_PX))
    setDx(clamped)
  }, [])

  const finish = useCallback(() => {
    if (activeRef.current && shouldTriggerReply(dx)) {
      onTrigger()
    }
    startRef.current = null
    activeRef.current = false
    setDx(0)
  }, [dx, onTrigger])

  return {
    dx,
    swipeHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
  }
}
