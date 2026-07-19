import { useState } from 'react'
import { useApprovalStore, type ApprovalTicket } from '../stores/approvalStore'
import { DecideApproval } from '../../wailsjs/go/main/App'

// errText renders an unknown error value as a string for the inline error
// notice below a ticket.
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// formatArgValue renders an argument value for display, tolerating values the
// server may have truncated (still just a string) and non-string types
// (numbers, booleans, nested objects) by falling back to JSON.stringify.
function formatArgValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return '(空)'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// ApprovalPrompt renders every pending Manual-mode approval ticket
// (approvalStore.pending) as a card with the tool name, its arguments, and
// Approve/Deny buttons. DecideApproval takes the verb form ("approve"/"deny"),
// distinct from the past-tense "approved"/"denied" the approval_resolved SSE
// event carries. A 404 (ticket gone) or 409 (already decided) response — or
// any other failure — is shown inline rather than swallowed; the ticket stays
// in the list so the user can see the decision did not go through.
export function ApprovalPrompt() {
  const pending = useApprovalStore((s) => s.pending)
  const onResolved = useApprovalStore((s) => s.onResolved)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [deciding, setDeciding] = useState<Record<string, boolean>>({})

  if (pending.length === 0) return null

  async function decide(ticket: ApprovalTicket, decision: 'approve' | 'deny') {
    setDeciding((d) => ({ ...d, [ticket.ticket_id]: true }))
    setErrors((e) => ({ ...e, [ticket.ticket_id]: '' }))
    try {
      await DecideApproval(ticket.task_id, ticket.ticket_id, decision)
      // Resolve locally right away rather than waiting for the SSE
      // approval_resolved echo — onResolved is idempotent (filters by
      // ticket_id), so the later SSE event for the same ticket is a
      // harmless no-op.
      onResolved({ ticket_id: ticket.ticket_id })
    } catch (err) {
      setErrors((e) => ({ ...e, [ticket.ticket_id]: errText(err) }))
      setDeciding((d) => ({ ...d, [ticket.ticket_id]: false }))
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border bg-muted/30 p-3">
      {pending.map((ticket) => (
        <div
          key={ticket.ticket_id}
          className="rounded-md border border-border bg-background p-3 text-sm"
          role="group"
          aria-label={`审批请求: ${ticket.tool || ticket.ticket_id}`}
        >
          <div className="font-medium text-foreground">
            待批准工具调用: <span className="font-mono">{ticket.tool || '(未知工具)'}</span>
          </div>
          {Object.keys(ticket.arguments).length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {Object.entries(ticket.arguments).map(([key, value]) => (
                <li key={key} className="truncate">
                  <span className="font-mono">{key}</span>: {formatArgValue(value)}
                </li>
              ))}
            </ul>
          )}
          {errors[ticket.ticket_id] && (
            <div className="mt-1 text-xs text-destructive">{errors[ticket.ticket_id]}</div>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="interactive rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
              onClick={() => decide(ticket, 'approve')}
              disabled={deciding[ticket.ticket_id]}
            >
              批准
            </button>
            <button
              type="button"
              className="interactive rounded-md border border-input px-3 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50"
              onClick={() => decide(ticket, 'deny')}
              disabled={deciding[ticket.ticket_id]}
            >
              拒绝
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
