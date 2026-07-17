import { useEffect } from 'react'
import { useAgentStore, DEFAULT_AGENT } from '../stores/agentStore'
import { BotIcon } from './icons'

// AgentSelector lets the user pick which agent handles the conversation: the
// built-in default, or any configured sub-agent fetched from the backend. The
// choice is stored in the agent store and read by ChatPanel when submitting.
export function AgentSelector() {
  const agents = useAgentStore((s) => s.agents)
  const selected = useAgentStore((s) => s.selected)
  const select = useAgentStore((s) => s.select)
  const load = useAgentStore((s) => s.load)

  useEffect(() => {
    load()
  }, [load])

  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground" title="选择处理对话的 Agent">
      <BotIcon className="w-4 h-4" />
      <select
        className="rounded border border-input bg-background px-1.5 py-0.5 text-xs text-foreground"
        value={selected}
        onChange={(e) => select(e.target.value)}
        aria-label="选择 Agent"
      >
        <option value={DEFAULT_AGENT}>默认</option>
        {agents.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )
}
