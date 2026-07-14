import { useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface Props {
  sidebar: ReactNode
  chat: ReactNode
  status: ReactNode
}

export function ThreePanelLayout({ sidebar, chat, status }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem('sidebarOpen') !== 'false'
  )
  const [statusOpen, setStatusOpen] = useState(
    () => localStorage.getItem('statusOpen') !== 'false'
  )

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

  // h-full (not h-screen): fill the parent flex cell so the layout scales with
  // the window and never overflows past the top bar.
  return (
    <div className="flex h-full bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside className={cn(
        'flex flex-col flex-shrink-0 border-r border-border transition-all duration-200',
        sidebarOpen ? 'w-56' : 'w-12'
      )}>
        <button
          className="flex-shrink-0 w-full p-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={toggleSidebar}
        >
          {sidebarOpen ? '◀' : '▶'}
        </button>
        {sidebarOpen && (
          <div className="flex-1 min-h-0 overflow-y-auto">{sidebar}</div>
        )}
      </aside>

      {/* Chat (flex-1) */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {chat}
      </main>

      {/* Status Panel */}
      <aside className={cn(
        'flex flex-col flex-shrink-0 border-l border-border transition-all duration-200',
        statusOpen ? 'w-72' : 'w-12'
      )}>
        <button
          className="flex-shrink-0 w-full p-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={toggleStatus}
        >
          {statusOpen ? '▶' : '◀'}
        </button>
        {statusOpen && (
          <div className="flex-1 min-h-0 overflow-hidden">{status}</div>
        )}
      </aside>
    </div>
  )
}
