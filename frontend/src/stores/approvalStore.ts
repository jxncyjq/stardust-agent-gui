import { create } from 'zustand'
import { ListPendingApprovals } from '../../wailsjs/go/main/App'

// ApprovalTicket is the normalized shape the UI renders, regardless of which
// source it came from (SSE approval_pending event vs. GET /v1/approvals).
export interface ApprovalTicket {
  ticket_id: string
  task_id: string
  tool: string
  arguments: Record<string, unknown>
}

// ApprovalPendingEvent is the parsed payload of an SSE approval_pending
// event. Its tool name key is "tool" (see sse_bridge.go), distinct from the
// "tool_name" key GET /v1/approvals returns for the same concept.
interface ApprovalPendingEvent {
  ticket_id?: unknown
  task_id?: unknown
  tool?: unknown
  arguments?: unknown
}

// ApprovalResolvedEvent is the parsed payload of an SSE approval_resolved
// event. decision here is the past-tense form ("approved"/"denied"); the
// store only needs ticket_id to drop the ticket from the pending list.
interface ApprovalResolvedEvent {
  ticket_id?: unknown
}

interface ApprovalState {
  pending: ApprovalTicket[]
  // onPending adds a ticket from an SSE approval_pending event, de-duplicated
  // by ticket_id so a re-delivered event (or one that arrived after load()
  // already picked it up) does not produce a second prompt.
  onPending: (data: ApprovalPendingEvent) => void
  // onResolved removes a ticket by ticket_id, called from an SSE
  // approval_resolved event or optimistically right after a local
  // DecideApproval call succeeds.
  onResolved: (data: ApprovalResolvedEvent) => void
  // load reconciles against GET /v1/approvals?status=pending: the SSE stream
  // is at-most-once and can lose events, and the frontend may subscribe after
  // the server already emitted approval_pending, so this is the fallback that
  // fills in whatever the UI missed. Merges with (does not replace) whatever
  // is already pending, de-duplicated by ticket_id.
  load: () => Promise<void>
}

// normalizeTicket adapts a loosely-typed ticket object — from either the SSE
// approval_pending payload ("tool") or the GET /v1/approvals endpoint
// ("tool_name") — into the store's ApprovalTicket shape. Values are coerced
// defensively since both sources are untrusted JSON crossing the Wails/HTTP
// boundary.
function normalizeTicket(raw: Record<string, unknown>): ApprovalTicket {
  const tool = raw.tool ?? raw.tool_name
  const args = raw.arguments
  return {
    ticket_id: typeof raw.ticket_id === 'string' ? raw.ticket_id : String(raw.ticket_id ?? ''),
    task_id: typeof raw.task_id === 'string' ? raw.task_id : String(raw.task_id ?? ''),
    tool: typeof tool === 'string' ? tool : String(tool ?? ''),
    arguments: args && typeof args === 'object' ? (args as Record<string, unknown>) : {},
  }
}

export const useApprovalStore = create<ApprovalState>((set, get) => ({
  pending: [],
  onPending: (data) => {
    const ticket = normalizeTicket(data as Record<string, unknown>)
    if (!ticket.ticket_id) return
    if (get().pending.some((t) => t.ticket_id === ticket.ticket_id)) return
    set((s) => ({ pending: [...s.pending, ticket] }))
  },
  onResolved: (data) => {
    const ticketId = typeof data?.ticket_id === 'string' ? data.ticket_id : String(data?.ticket_id ?? '')
    if (!ticketId) return
    set((s) => ({ pending: s.pending.filter((t) => t.ticket_id !== ticketId) }))
  },
  load: async () => {
    const list = await ListPendingApprovals()
    const tickets = (list || [])
      .map((raw) => normalizeTicket(raw as Record<string, unknown>))
      .filter((t) => t.ticket_id)
    set((s) => {
      const known = new Set(s.pending.map((t) => t.ticket_id))
      const merged = [...s.pending]
      for (const ticket of tickets) {
        if (!known.has(ticket.ticket_id)) {
          merged.push(ticket)
          known.add(ticket.ticket_id)
        }
      }
      return { pending: merged }
    })
  },
}))
