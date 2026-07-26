import { useEffect, useState } from 'react'
import { ListTasks } from '../../../wailsjs/go/main/App'
import { EventsOn } from '../../../wailsjs/runtime/runtime'

interface TaskItem {
  id: string
  status: string
  input: string
}

// mapTask normalizes the loosely-typed Wails binding result (Record<string,
// any> from a Go domain.Task) into the shape this tab renders.
function mapTask(raw: any): TaskItem {
  return {
    id: String(raw?.id ?? ''),
    status: String(raw?.status ?? ''),
    input: String(raw?.input ?? ''),
  }
}

export function TasksTab() {
  const [tasks, setTasks] = useState<TaskItem[]>([])

  useEffect(() => {
    async function refresh() {
      try {
        const result = await ListTasks()
        setTasks((result || []).map(mapTask).reverse())
      } catch (err) {
        // serve not ready yet; the next interval tick will retry.
        console.error('list tasks failed:', err)
      }
    }
    refresh()
    // Event-driven: only task_* events change what this tab renders, so filter
    // on type before refreshing. The interval drops to a low-frequency fallback
    // for the rare missed event (SSE is at-most-once).
    const cancel = EventsOn('agent:event', (p: { type?: string }) => {
      if (['task_started', 'task_completed', 'task_failed'].includes(String(p?.type ?? ''))) refresh()
    })
    const id = setInterval(refresh, 15000)
    return () => { cancel(); clearInterval(id) }
  }, [])

  return (
    <div className="p-2 flex flex-col gap-1">
      {tasks.length === 0 && (
        <p className="text-xs text-muted-foreground">无任务</p>
      )}
      {tasks.map((t, i) => (
        <div key={`${t.id}-${i}`} className="text-xs border-b border-border py-1">
          <span className="font-mono text-muted-foreground">{t.status}</span>
          <p className="truncate text-foreground">{t.id}</p>
          {t.input && <p className="truncate text-muted-foreground">{t.input.slice(0, 80)}</p>}
        </div>
      ))}
    </div>
  )
}
