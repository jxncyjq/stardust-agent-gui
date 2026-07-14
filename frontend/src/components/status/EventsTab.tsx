import { useEffect, useState } from 'react'
import { ListRuntimeEvents } from '../../../wailsjs/go/main/App'

interface RuntimeEvent {
  type: string
  taskId: string
  message: string
  createdAt: string
}

// mapEvent normalizes the loosely-typed Wails binding result (Record<string,
// any> from a Go domain.RuntimeEvent) into the shape this tab renders. Field
// access is defensive so a partial/unknown event still renders a row.
function mapEvent(raw: any): RuntimeEvent {
  return {
    type: String(raw?.type ?? ''),
    taskId: String(raw?.task_id ?? ''),
    message: String(raw?.message ?? ''),
    createdAt: String(raw?.created_at ?? ''),
  }
}

export function EventsTab() {
  const [events, setEvents] = useState<RuntimeEvent[]>([])

  useEffect(() => {
    async function refresh() {
      try {
        const result = await ListRuntimeEvents()
        // Newest first for display; the backend returns chronological order.
        setEvents((result || []).map(mapEvent).reverse())
      } catch (err) {
        // serve not ready yet; the next interval tick will retry.
        console.error('list runtime events failed:', err)
      }
    }
    refresh()
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="p-2 flex flex-col gap-1">
      {events.length === 0 && (
        <p className="text-xs text-muted-foreground">暂无事件</p>
      )}
      {events.map((e, i) => (
        <div key={`${e.type}-${e.taskId}-${i}`} className="text-xs border-b border-border py-1">
          <span className="text-muted-foreground font-mono">{e.type}</span>
          <p className="truncate text-foreground">{e.message || e.taskId || e.createdAt}</p>
        </div>
      ))}
    </div>
  )
}
