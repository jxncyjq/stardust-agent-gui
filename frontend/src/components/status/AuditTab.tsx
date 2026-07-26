import { useEffect, useState } from 'react'
import { ListAuditEvents } from '../../../wailsjs/go/main/App'
import { EventsOn } from '../../../wailsjs/runtime/runtime'

interface AuditItem {
  action: string
  subjectId: string
  createdAt: string
}

// mapAudit normalizes the loosely-typed Wails binding result (Record<string,
// any> from a Go domain.AuditEvent) into the shape this tab renders.
function mapAudit(raw: any): AuditItem {
  return {
    action: String(raw?.action ?? ''),
    subjectId: String(raw?.subject_id ?? ''),
    createdAt: String(raw?.created_at ?? ''),
  }
}

export function AuditTab() {
  const [items, setItems] = useState<AuditItem[]>([])

  useEffect(() => {
    async function refresh() {
      try {
        const result = await ListAuditEvents()
        setItems((result || []).map(mapAudit).reverse())
      } catch (err) {
        // serve not ready yet; the next interval tick will retry.
        console.error('list audit events failed:', err)
      }
    }
    refresh()
    const cancel = EventsOn('agent:event', (p: { type?: string }) => {
      // Heuristic, NOT an event contract: audit records have no dedicated SSE event
      // (append is a DB write, no Publish). A task reaching a terminal state usually
      // produces an audit row alongside it, so use task_completed/task_failed as a
      // best-effort refresh trigger. The interval below still covers audit rows that
      // have no observable event (e.g. model-level audits).
      if (['task_completed', 'task_failed'].includes(String(p?.type ?? ''))) refresh()
    })
    const id = setInterval(refresh, 8000) // 降频兜底（原 3000）
    return () => { cancel(); clearInterval(id) }
  }, [])

  return (
    <div className="p-2 flex flex-col gap-1">
      {items.length === 0 && (
        <p className="text-xs text-muted-foreground">暂无审计</p>
      )}
      {items.map((a, i) => (
        <div key={`${a.action}-${a.subjectId}-${i}`} className="text-xs border-b border-border py-1">
          <span className="font-mono text-muted-foreground">{a.action}</span>
          <p className="truncate text-foreground">{a.subjectId}</p>
          {a.createdAt && <p className="truncate text-muted-foreground">{a.createdAt}</p>}
        </div>
      ))}
    </div>
  )
}
