import { create } from 'zustand'
import { ListAgents } from '../../wailsjs/go/main/App'

// DEFAULT_AGENT is the sentinel agentID for the built-in default agent. It is
// sent to SubmitTask as-is; the backend treats a non-registry id as the default
// runtime, so this keeps the pre-picker behaviour when no sub-agent is chosen.
export const DEFAULT_AGENT = 'default-agent'

interface AgentState {
  // agents is the list of configured sub-agent names (from the backend), not
  // including the default agent.
  agents: string[]
  // selected is the agentID for the next task: DEFAULT_AGENT or a sub-agent name.
  selected: string
  error: string
  load: () => Promise<void>
  select: (agentID: string) => void
}

// useAgentStore holds the chat's active agent selection and the list of
// available sub-agents fetched from the backend.
export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  selected: DEFAULT_AGENT,
  error: '',
  load: async () => {
    try {
      const agents = await ListAgents()
      set({ agents: agents ?? [], error: '' })
    } catch (err: any) {
      // A failed load leaves the picker with just the default agent; surface the
      // reason rather than hiding it.
      set({ error: String(err?.message ?? err) })
    }
  },
  select: (agentID) => set({ selected: agentID }),
}))
