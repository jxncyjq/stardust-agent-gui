import { useEffect, useRef } from 'react'

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

// ContextMenu renders a small floating menu at the given screen coordinates.
// It closes when the user presses Escape, clicks outside it, or scrolls, so a
// stray open menu never lingers. Selecting an item runs its handler and closes.
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

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
      style={{ left: x, top: y }}
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
