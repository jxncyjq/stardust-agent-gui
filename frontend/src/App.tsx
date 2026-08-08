import { useState } from 'react'
import { ThreePanelLayout } from './components/layout/ThreePanelLayout'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { StatusPanel } from './components/StatusPanel'
import { BrowserView } from './components/BrowserView'
import { ConnectionBadge } from './components/ConnectionBadge'
import { SettingsModal } from './components/settings/SettingsModal'
import { ConfirmDialog } from './components/ConfirmDialog'
import { useUIStore } from './stores/uiStore'
import { useThemeStore } from './stores/themeStore'
import { useBrowserSession } from './hooks/useBrowserSession'
import { cn } from './lib/utils'
import { SunIcon, MoonIcon } from './components/icons'

// ThemeToggle switches between light and dark mode. It is icon-only, so it
// carries an aria-label; the icon reflects the theme the click will switch TO.
function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme)
  const toggle = useThemeStore((s) => s.toggle)
  const nextIsDark = theme === 'light'
  return (
    <button
      type="button"
      className="interactive rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted"
      onClick={toggle}
      aria-label={nextIsDark ? '切换到深色模式' : '切换到浅色模式'}
      title={nextIsDark ? '深色模式' : '浅色模式'}
    >
      {nextIsDark ? <MoonIcon /> : <SunIcon />}
    </button>
  )
}

// RightPanel switches the third column between the status tabs and the
// read-only browser view. useBrowserSession (mounted at App level) discovers
// active browser sessions regardless of which view is selected here.
type RightView = 'status' | 'browser'

function RightPanel() {
  const [view, setView] = useState<RightView>('status')
  const views: { id: RightView; label: string }[] = [
    { id: 'status', label: '状态' },
    { id: 'browser', label: '浏览器' },
  ]
  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-border">
        {views.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={view === v.id}
            className={cn(
              'interactive flex-1 py-1.5 text-xs font-medium',
              view === v.id
                ? 'text-foreground border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {view === 'status' ? <StatusPanel /> : <BrowserView />}
      </div>
    </div>
  )
}

function App() {
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const closeSettings = useUIStore((s) => s.closeSettings)
  useBrowserSession()
  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center justify-end gap-1 border-b border-border px-2 py-0.5 bg-background">
        <ConnectionBadge />
        <ThemeToggle />
      </div>
      <div className="flex-1 min-h-0">
        <ThreePanelLayout
          sidebar={<Sidebar />}
          chat={<ChatPanel />}
          status={<RightPanel />}
        />
      </div>
      <SettingsModal open={settingsOpen} onClose={closeSettings} />
      <ConfirmDialog />
    </div>
  )
}

export default App
