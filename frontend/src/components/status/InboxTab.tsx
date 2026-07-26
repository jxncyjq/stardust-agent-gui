import { useEffect, useState } from 'react'
import { ListInbox } from '../../../wailsjs/go/main/App'

interface InboxItem {
  from: string
  to: string
  type: string
  summary: string
}

// mapInbox normalizes the loosely-typed Wails binding result (Record<string,
// any> from a Go domain.AgentMessage) into the shape this tab renders.
function mapInbox(raw: any): InboxItem {
  return {
    from: String(raw?.from_agent_id ?? ''),
    to: String(raw?.to_agent_id ?? ''),
    type: String(raw?.type ?? ''),
    summary: String(raw?.summary ?? ''),
  }
}

export function InboxTab() {
  const [items, setItems] = useState<InboxItem[]>([])

  useEffect(() => {
    async function refresh() {
      try {
        const result = await ListInbox()
        setItems((result || []).map(mapInbox).reverse())
      } catch (err) {
        // serve not ready yet; the next interval tick will retry.
        console.error('list inbox failed:', err)
      }
    }
    refresh()
    // Inbox stays on a plain 3s poll: agent messaging (SendAgentMessage/HandoffTask)
    // only writes to the DB and never publishes an event, and messages from OTHER
    // agents arrive with no local signal at all — so polling is the only channel.
    // ChatPanel triggers a one-off refresh for the user's own /send and /handoff by
    // switching to this tab; everything else must be polled.
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="p-2 flex flex-col gap-1">
      {items.length === 0 && (
        <p className="text-xs text-muted-foreground">收件箱为空</p>
      )}
      {items.map((m, i) => (
        <div key={`${m.from}-${m.to}-${i}`} className="text-xs border-b border-border py-1">
          <span className="font-mono text-muted-foreground">
            {m.from || '?'}→{m.to || '?'} {m.type}
          </span>
          <p className="truncate text-foreground">{m.summary}</p>
        </div>
      ))}
    </div>
  )
}
