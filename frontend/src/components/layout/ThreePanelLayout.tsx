import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { ChevronLeftIcon, ChevronRightIcon } from '../icons'

interface Props {
  sidebar: ReactNode
  chat: ReactNode
  status: ReactNode
}

// Panel width bounds (px). Defaults match the previous fixed w-56 / w-72.
const SIDEBAR = { min: 160, max: 480, def: 224 }
const STATUS = { min: 200, max: 640, def: 288 }
const COLLAPSED = 48 // w-12

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

// readWidth restores a persisted panel width, clamped to the current bounds so a
// stale or out-of-range value can never wedge a panel off-screen.
function readWidth(key: string, b: { min: number; max: number; def: number }): number {
  const raw = Number(localStorage.getItem(key))
  return Number.isFinite(raw) && raw > 0 ? clamp(raw, b.min, b.max) : b.def
}

// ResizeHandle is a thin draggable gutter between two panels. It owns the drag
// lifecycle (window-level listeners so the pointer can leave the 1px strip) and
// reports the live pointer clientX; the parent turns that into a panel width.
function ResizeHandle({ onResize, ariaLabel }: { onResize: (clientX: number) => void; ariaLabel: string }) {
  const dragging = useRef(false)

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (dragging.current) onResize(e.clientX)
    }
    function onUp() {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [onResize])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      // 1px visible line inside a wider hit area (negative margins) so the strip
      // is easy to grab without widening the layout gutter.
      className="relative z-10 w-px shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-['']"
      onMouseDown={() => {
        dragging.current = true
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
      }}
    />
  )
}

// ThreePanelLayout arranges the sidebar, chat, and status panels. Each side
// panel can be collapsed to a rail and, when open, resized by dragging the gutter
// on its inner edge; the open/closed state and pixel widths persist across runs.
// The panels span the full window width, so the sidebar's right edge sits at the
// pointer's clientX and the status's left edge at (innerWidth - clientX).
export function ThreePanelLayout({ sidebar, chat, status }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem('sidebarOpen') !== 'false'
  )
  const [statusOpen, setStatusOpen] = useState(
    () => localStorage.getItem('statusOpen') !== 'false'
  )
  const [sidebarWidth, setSidebarWidth] = useState(() => readWidth('sidebarWidth', SIDEBAR))
  const [statusWidth, setStatusWidth] = useState(() => readWidth('statusWidth', STATUS))

  const toggleSidebar = () =>
    setSidebarOpen((o) => {
      const next = !o
      localStorage.setItem('sidebarOpen', String(next))
      return next
    })
  const toggleStatus = () =>
    setStatusOpen((o) => {
      const next = !o
      localStorage.setItem('statusOpen', String(next))
      return next
    })

  // Persist widths on change. Writes are cheap and only happen while dragging.
  useEffect(() => {
    localStorage.setItem('sidebarWidth', String(sidebarWidth))
  }, [sidebarWidth])
  useEffect(() => {
    localStorage.setItem('statusWidth', String(statusWidth))
  }, [statusWidth])

  const resizeSidebar = useCallback((clientX: number) => {
    setSidebarWidth(clamp(clientX, SIDEBAR.min, SIDEBAR.max))
  }, [])
  const resizeStatus = useCallback((clientX: number) => {
    setStatusWidth(clamp(window.innerWidth - clientX, STATUS.min, STATUS.max))
  }, [])

  return (
    <div className="flex h-full bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          'flex flex-col flex-shrink-0 border-r border-border',
          !sidebarOpen && 'transition-all duration-200'
        )}
        style={{ width: sidebarOpen ? sidebarWidth : COLLAPSED }}
      >
        <button
          className="interactive flex-shrink-0 w-full flex justify-center p-2 text-muted-foreground hover:text-foreground hover:bg-muted"
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? '折叠侧栏' : '展开侧栏'}
          aria-expanded={sidebarOpen}
          title={sidebarOpen ? '折叠侧栏' : '展开侧栏'}
        >
          {sidebarOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
        </button>
        {sidebarOpen && <div className="flex-1 min-h-0 overflow-y-auto">{sidebar}</div>}
      </aside>

      {sidebarOpen && <ResizeHandle onResize={resizeSidebar} ariaLabel="拖动调整侧栏宽度" />}

      {/* Chat (flex-1) */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">{chat}</main>

      {statusOpen && <ResizeHandle onResize={resizeStatus} ariaLabel="拖动调整状态面板宽度" />}

      {/* Status Panel */}
      <aside
        className={cn(
          'flex flex-col flex-shrink-0 border-l border-border',
          !statusOpen && 'transition-all duration-200'
        )}
        style={{ width: statusOpen ? statusWidth : COLLAPSED }}
      >
        <button
          className="interactive flex-shrink-0 w-full flex justify-center p-2 text-muted-foreground hover:text-foreground hover:bg-muted"
          onClick={toggleStatus}
          aria-label={statusOpen ? '折叠状态面板' : '展开状态面板'}
          aria-expanded={statusOpen}
          title={statusOpen ? '折叠状态面板' : '展开状态面板'}
        >
          {statusOpen ? <ChevronRightIcon /> : <ChevronLeftIcon />}
        </button>
        {statusOpen && <div className="flex-1 min-h-0 overflow-hidden">{status}</div>}
      </aside>
    </div>
  )
}
