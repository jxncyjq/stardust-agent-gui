import { create } from 'zustand'

// Session mirrors the backend domain.AgentSession fields the UI needs for the
// two-level (project -> agent) grouping in the sidebar.
export interface Session {
  id: string
  project: string
  agent: string
  title: string
  archived: boolean
  updatedAt: string
}

interface SessionState {
  currentSessionId: string
  sessions: Session[]
  setCurrentSession: (id: string) => void
  setSessions: (sessions: Session[]) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  currentSessionId: '',
  sessions: [],
  setCurrentSession: (id) => set({ currentSessionId: id }),
  setSessions: (sessions) => set({ sessions }),
}))
