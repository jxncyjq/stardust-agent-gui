import { useEffect } from 'react'
import { ThreePanelLayout } from './components/layout/ThreePanelLayout'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { StatusPanel } from './components/StatusPanel'
import { BrowserView } from './components/BrowserView'
import { WebPreviewPanel } from './components/WebPreviewPanel'
import { ConnectionBadge } from './components/ConnectionBadge'
import { SettingsModal } from './components/settings/SettingsModal'
import { ConfirmDialog } from './components/ConfirmDialog'
import { useUIStore } from './stores/uiStore'
import type { RightView } from './stores/uiStore'
import { useThemeStore } from './stores/themeStore'
import { usePreviewStore } from './stores/previewStore'
import { useBrowserSession } from './hooks/useBrowserSession'
import { useHtmlPreviewEvents } from './hooks/useHtmlPreviewEvents'
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

// RightPanel switches the third column between the status tabs, the
// read-only browser view, and the HTML preview. useBrowserSession (mounted
// at App level) discovers active browser sessions regardless of which view
// is selected here. The active tab lives in uiStore (not local state) so a
// backend-pushed or button-triggered preview can pull the column onto its
// own tab from outside this component.
function RightPanel() {
  const view = useUIStore((s) => s.rightView)
  const setView = useUIStore((s) => s.setRightView)
  const source = usePreviewStore((s) => s.source)
  const closePreview = usePreviewStore((s) => s.close)

  // A newly-opened preview pulls the right column to its tab so backend-pushed
  // or button-triggered previews surface without a manual click.
  useEffect(() => {
    if (source) setView('preview')
  }, [source, setView])

  const views: { id: RightView; label: string }[] = [
    { id: 'status', label: '状态' },
    { id: 'browser', label: '浏览器' },
    { id: 'preview', label: '预览' },
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
        {view === 'status' && <StatusPanel />}
        {view === 'browser' && <BrowserView />}
        {view === 'preview' && (
          <WebPreviewPanel
            source={source}
            onClose={() => {
              closePreview()
              setView('status')
            }}
          />
        )}
      </div>
    </div>
  )
}

function App() {
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const closeSettings = useUIStore((s) => s.closeSettings)
  useBrowserSession()
  useHtmlPreviewEvents()
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
