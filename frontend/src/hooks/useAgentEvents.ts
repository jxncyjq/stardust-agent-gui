import { useEffect } from 'react'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import { ServeStatus } from '../../wailsjs/go/main/App'
import { useChatStore } from '../stores/chatStore'
import { useServeStore } from '../stores/serveStore'
import { useApprovalStore } from '../stores/approvalStore'

export function useAgentEvents() {
  const appendToken = useChatStore((s) => s.appendToken)
  const setStatus = useServeStore((s) => s.setStatus)

  useEffect(() => {
    let currentStreamId = ''
    let cancelled = false

    const handleToken = (data: string) => {
      if (!currentStreamId) {
        currentStreamId = `stream-${Date.now()}`
        useChatStore.getState().addMessage({
          id: currentStreamId,
          role: 'assistant',
          content: '',
          streaming: true,
        })
      }
      appendToken(currentStreamId, data)
    }

    const handleEvent = (payload: { type: string }) => {
      if (payload.type === 'runtime.done' || payload.type === 'done') {
        if (currentStreamId) {
          useChatStore.getState().finalizeMessage(currentStreamId)
          currentStreamId = ''
        }
      }
    }

    const handleStatus = (status: { running: boolean; port: number }) => {
      setStatus(status.running, status.port)
    }

    // handleApproval routes the dedicated agent:approval channel (Task 2's
    // sse_bridge.go) to the approval store. The payload's `data` field is the
    // raw SSE data line as a JSON string (the Go side does not unmarshal it),
    // so it must be parsed here before use.
    const handleApproval = (payload: { type: string; data: string }) => {
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(payload.data)
      } catch (err) {
        console.error('agent:approval payload was not valid JSON:', payload, err)
        return
      }
      if (payload.type === 'approval_pending') {
        useApprovalStore.getState().onPending(parsed)
      } else if (payload.type === 'approval_resolved') {
        useApprovalStore.getState().onResolved(parsed)
      } else {
        console.error('agent:approval unexpected type:', payload.type)
      }
    }

    EventsOn('agent:token', handleToken)
    EventsOn('agent:event', handleEvent)
    EventsOn('serve:status', handleStatus)
    EventsOn('agent:approval', handleApproval)

    // The SSE stream is at-most-once and this hook may mount after the server
    // already emitted approval_pending, so pull the current pending tickets
    // as a reconciliation fallback (see approvalStore.load). A failure here
    // must not crash the panel, but must not be silent either.
    useApprovalStore
      .getState()
      .load()
      .catch((err) => {
        console.error('load pending approvals failed:', err)
      })

    // The startup serve:status event may fire before this hook mounts, and Wails
    // events are not buffered. Actively pull the current status (and retry a few
    // times while the embedded service is still starting) to fix the badge race.
    const pullStatus = async (attempt = 0) => {
      try {
        const status = await ServeStatus()
        const running = Boolean(status?.running)
        setStatus(running, Number(status?.port ?? 0))
        if (!running && attempt < 10 && !cancelled) {
          setTimeout(() => pullStatus(attempt + 1), 500)
        }
      } catch {
        if (attempt < 10 && !cancelled) {
          setTimeout(() => pullStatus(attempt + 1), 500)
        }
      }
    }
    pullStatus()

    return () => {
      cancelled = true
      EventsOff('agent:token')
      EventsOff('agent:event')
      EventsOff('serve:status')
      EventsOff('agent:approval')
    }
  }, [appendToken, setStatus])
}
