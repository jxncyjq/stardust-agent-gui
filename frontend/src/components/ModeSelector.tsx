import { useSessionStore } from '../stores/sessionStore'
import { useChatStore } from '../stores/chatStore'
import { SetSessionMode } from '../../wailsjs/go/main/App'
import { SparkleIcon } from './icons'

const MODE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'manual', label: 'Manual' },
  { value: 'plan', label: 'Plan' },
  { value: 'auto', label: 'Auto' },
]

// ModeSelector lets the user pick the current session's working mode
// (Manual/Plan/Auto). Unlike AgentSelector's global `selected` agent, the
// mode is per-session: it lives on Session.mode in sessionStore, so switching
// the visible session shows that session's own mode rather than one shared
// value. A failed backend call (e.g. a 400) is surfaced as a system chat
// message rather than swallowed, and the store is left untouched so the
// select reverts to the last known-good mode.
export function ModeSelector() {
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const currentSession = useSessionStore((s) =>
    s.sessions.find((session) => session.id === s.currentSessionId)
  )
  const setSessionMode = useSessionStore((s) => s.setSessionMode)
  const addMessage = useChatStore((s) => s.addMessage)

  const mode = currentSession?.mode ?? 'auto'

  async function handleChange(next: string) {
    if (!currentSessionId) return
    try {
      await SetSessionMode(currentSessionId, next)
      setSessionMode(currentSessionId, next)
    } catch (err) {
      addMessage({
        id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: 'system',
        content: `切换会话模式失败: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  return (
    <label
      className="flex items-center gap-1 text-xs text-muted-foreground"
      // Mode is per-session, so the select is disabled with no session selected.
      // Say why, otherwise the control just reads as broken.
      title={currentSessionId ? '选择会话模式' : '尚未选择会话，请先在左侧选择或新建会话'}
    >
      <SparkleIcon className="w-4 h-4" />
      <select
        className="rounded border border-input bg-background px-1.5 py-0.5 text-xs text-foreground"
        value={mode}
        onChange={(e) => handleChange(e.target.value)}
        disabled={!currentSessionId}
        aria-label="选择会话模式"
      >
        {MODE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}
