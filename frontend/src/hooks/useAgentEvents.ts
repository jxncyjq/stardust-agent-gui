import { useEffect } from 'react'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import { ServeStatus } from '../../wailsjs/go/main/App'
import { useChatStore } from '../stores/chatStore'
import { useServeStore } from '../stores/serveStore'

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

    EventsOn('agent:token', handleToken)
    EventsOn('agent:event', handleEvent)
    EventsOn('serve:status', handleStatus)

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
    }
  }, [appendToken, setStatus])
}
