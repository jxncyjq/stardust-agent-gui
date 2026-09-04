import { useEffect } from 'react'
import { ThreePanelLayout } from './components/layout/ThreePanelLayout'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { StatusPanel } from './components/StatusPanel'
import { BrowserView } from './components/BrowserView'
import { WebPreviewPanel } from './components/WebPreviewPanel'
import { WorkspaceFilePanel } from './components/workspace/WorkspaceFilePanel'
import { ConnectionBadge } from './components/ConnectionBadge'
import { SettingsModal } from './components/settings/SettingsModal'
import { ConfirmDialog } from './components/ConfirmDialog'
import { useUIStore } from './stores/uiStore'
import type { RightView } from './stores/uiStore'
import { useThemeStore } from './stores/themeStore'
import { usePreviewStore } from './stores/previewStore'
import { useBrowserStore } from './stores/browserStore'
import { useBrowserSession } from './hooks/useBrowserSession'
import { useHtmlPreviewEvents } from './hooks/useHtmlPreviewEvents'
import { useChromiumInstall } from './hooks/useChromiumInstall'
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

// RightPanel switches the third column between the status tabs, the HTML
// preview and the file list.
//
// 浏览器视图**不再**是这里的一个 tab：它有了自己的一栏（见 App）。原因是那个 tab
// 让「看事件」与「看 Agent 在浏览」变成二选一，而同时看这两样正是这个视图存在的
// 理由。
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
    { id: 'preview', label: '预览' },
    { id: 'files', label: '文件' },
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
        {view === 'preview' && (
          <WebPreviewPanel
            source={source}
            onClose={() => {
              closePreview()
              setView('status')
            }}
          />
        )}
        {view === 'files' && <WorkspaceFilePanel />}
      </div>
    </div>
  )
}

function App() {
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const browserPanelOpen = useUIStore((s) => s.browserPanelOpen)
  const setBrowserPanelOpen = useUIStore((s) => s.setBrowserPanelOpen)
  const browserSessionId = useBrowserStore((s) => s.sessionId)
  useBrowserSession()
  useHtmlPreviewEvents()
  useChromiumInstall()

  // Agent 开了一个**新的**浏览器会话时，把收起来的栏重新打开：那一刻用户多半想看
  // 一眼。同一个会话里反复的事件不会重新打开它——那会变成一个赶不走的面板。
  useEffect(() => {
    if (browserSessionId !== null) setBrowserPanelOpen(true)
  }, [browserSessionId, setBrowserPanelOpen])

  const browsing = browserSessionId !== null
  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center justify-end gap-1 border-b border-border px-2 py-0.5 bg-background">
        {/* 收起来之后还得有路回去：只在真的有会话、且面板收着时出现。 */}
        {browsing && !browserPanelOpen && (
          <button
            type="button"
            className="interactive rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={() => setBrowserPanelOpen(true)}
          >
            显示浏览器
          </button>
        )}
        <ConnectionBadge />
        <ThemeToggle />
      </div>
      <div className="flex-1 min-h-0">
        <ThreePanelLayout
          sidebar={<Sidebar />}
          chat={<ChatPanel />}
          status={<RightPanel />}
          browser={
            browsing && browserPanelOpen ? (
              <BrowserView onClose={() => setBrowserPanelOpen(false)} />
            ) : undefined
          }
        />
      </div>
      <SettingsModal open={settingsOpen} onClose={closeSettings} />
      <ConfirmDialog />
    </div>
  )
}

export default App
