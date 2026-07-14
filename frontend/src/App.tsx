import { ThreePanelLayout } from './components/layout/ThreePanelLayout'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { StatusPanel } from './components/StatusPanel'
import { ConnectionBadge } from './components/ConnectionBadge'
import { SettingsModal } from './components/settings/SettingsModal'
import { useUIStore } from './stores/uiStore'

function App() {
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const closeSettings = useUIStore((s) => s.closeSettings)
  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center justify-end border-b border-border px-2 py-0.5 bg-background">
        <ConnectionBadge />
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
