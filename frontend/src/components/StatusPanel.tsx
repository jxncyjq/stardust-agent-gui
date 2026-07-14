import { cn } from '../lib/utils'
import { EventsTab } from './status/EventsTab'
import { TasksTab } from './status/TasksTab'
import { AuditTab } from './status/AuditTab'
import { InboxTab } from './status/InboxTab'
import { useStatusStore, type StatusTab } from '../stores/statusStore'

const tabs: { id: StatusTab; label: string }[] = [
  { id: 'events', label: '事件' },
  { id: 'tasks', label: '任务' },
  { id: 'audit', label: 'Audit' },
  { id: 'inbox', label: 'Inbox' },
]

export function StatusPanel() {
  const activeTab = useStatusStore((s) => s.activeTab)
  const setActiveTab = useStatusStore((s) => s.setActiveTab)

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={cn(
              'flex-1 py-2 text-xs font-medium',
              activeTab === tab.id
                ? 'text-foreground border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'events' && <EventsTab />}
        {activeTab === 'tasks' && <TasksTab />}
        {activeTab === 'audit' && <AuditTab />}
        {activeTab === 'inbox' && <InboxTab />}
      </div>
    </div>
  )
}
