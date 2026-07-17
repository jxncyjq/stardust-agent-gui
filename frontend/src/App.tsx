import { ThreePanelLayout } from './components/layout/ThreePanelLayout'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { StatusPanel } from './components/StatusPanel'
import { ConnectionBadge } from './components/ConnectionBadge'
import { SettingsModal } from './components/settings/SettingsModal'
import { useUIStore } from './stores/uiStore'
import { useThemeStore } from './stores/themeStore'
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

function App() {
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const closeSettings = useUIStore((s) => s.closeSettings)
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
          status={<StatusPanel />}
        />
      </div>
      <SettingsModal open={settingsOpen} onClose={closeSettings} />
    </div>
  )
}

export default App
