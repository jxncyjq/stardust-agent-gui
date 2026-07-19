import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface ContextMenuItem {
  label: string
  onSelect: () => void
  // destructive items (e.g. delete) are rendered in a warning color.
  destructive?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

// MENU_VIEWPORT_MARGIN is the gap kept between a clamped menu and the window
// edge so it never sits flush against it.
const MENU_VIEWPORT_MARGIN = 8

// ContextMenu renders a small floating menu at the given screen coordinates.
// It closes when the user presses Escape, clicks outside it, or scrolls, so a
// stray open menu never lingers. Selecting an item runs its handler and closes.
//
// The requested coordinates are clamped to the viewport before paint. Callers
// pass a raw click point, and some triggers sit at the window edge — the "+"
// attach button lives in the bottom toolbar — where an unclamped menu renders
// past the edge and cannot be clicked at all.
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // useLayoutEffect, not useEffect: the correction must land before the browser
  // paints, otherwise the menu visibly jumps from the raw point to the clamped
  // one.
  useLayoutEffect(() => {
    const el = ref.current
    // Only null if the menu were unmounted; this narrows the ref type rather
    // than papering over a missing element.
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    // Math.min pulls the menu back inside the far edge; Math.max then keeps it
    // on screen even when the menu is larger than the window, in which case it
    // starts at the margin and overflows the far edge instead of the near one.
    setPos({
      left: Math.max(MENU_VIEWPORT_MARGIN, Math.min(x, window.innerWidth - width - MENU_VIEWPORT_MARGIN)),
      top: Math.max(MENU_VIEWPORT_MARGIN, Math.min(y, window.innerHeight - height - MENU_VIEWPORT_MARGIN)),
    })
  }, [x, y])

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[120px] rounded-md border border-border bg-background py-1 shadow-md"
      style={{ left: pos.left, top: pos.top }}
      // Stop a right-click on the menu itself from opening the browser menu.
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, idx) => (
        <button
          key={idx}
          className={
            'interactive block w-full px-3 py-1 text-left text-xs hover:bg-muted ' +
            (item.destructive ? 'text-destructive' : 'text-foreground')
          }
          onClick={() => {
            item.onSelect()
            onClose()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
