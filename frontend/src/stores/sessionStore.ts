import { create } from 'zustand'

// Session mirrors the backend domain.AgentSession fields the UI needs for the
// two-level (project -> agent) grouping in the sidebar.
export interface Session {
  id: string
  project: string
  title: string
  archived: boolean
  updatedAt: string
  // mode is the session's working mode (manual/plan/auto), per-session and
  // independent of the global agent selection. Optional because sessions
  // loaded before the backend reported this field, or in tests, may omit it;
  // consumers fall back to 'auto' (see ModeSelector).
  mode?: string
  // workingDir is the session's bound working directory, set at most once via
  // PickDirectory + SetSessionWorkingDir (the backend rejects changing an
  // already-bound value with 400). Optional/undefined means unbound — the
  // legitimate initial state, not a missing-data error.
  workingDir?: string
}

interface SessionState {
  currentSessionId: string
  sessions: Session[]
  setCurrentSession: (id: string) => void
  setSessions: (sessions: Session[]) => void
  // setSessionMode updates a single session's mode in place, after the
  // backend call (SetSessionMode) has already succeeded. Per-session, unlike
  // agentStore's global `selected`.
  setSessionMode: (id: string, mode: string) => void
  // setSessionWorkingDir updates a single session's workingDir in place, after
  // the backend call (SetSessionWorkingDir) has already succeeded.
  setSessionWorkingDir: (id: string, workingDir: string) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  currentSessionId: '',
  sessions: [],
  setCurrentSession: (id) => set({ currentSessionId: id }),
  setSessions: (sessions) => set({ sessions }),
  setSessionMode: (id, mode) =>
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === id ? { ...session, mode } : session
      ),
    })),
  setSessionWorkingDir: (id, workingDir) =>
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === id ? { ...session, workingDir } : session
      ),
    })),
}))
