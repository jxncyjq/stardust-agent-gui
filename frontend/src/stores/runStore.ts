import { create } from 'zustand'

// SessionRun is the in-flight execution state for a single session: whether a
// task is running, when it started (for the elapsed clock), and the latest token
// count. Keyed per session so the execution indicator follows the active session
// — switching sessions shows that session's own progress, not a global one.
export interface SessionRun {
  running: boolean
  startedAt: number
  totalTokens: number
  // taskID is the backend task id for the in-flight run, set once SubmitTask
  // resolves. It is what the Stop button passes to InterruptTask, so it must
  // be readable independently of the SubmitTask call site (the button lives
  // elsewhere in the tree). Undefined before SubmitTask resolves or once the
  // run has finished.
  taskID?: string
}

interface RunStore {
  runs: Record<string, SessionRun>
  // now is a shared ticking clock; the indicator derives elapsed seconds from
  // (now - startedAt) so a re-render on every tick keeps all running sessions'
  // timers live without each owning its own interval.
  now: number
  startRun: (sessionId: string) => void
  updateRun: (sessionId: string, totalTokens: number) => void
  setRunTask: (sessionId: string, taskID: string) => void
  finishRun: (sessionId: string) => void
  tick: () => void
}

export const useRunStore = create<RunStore>((set) => ({
  runs: {},
  now: Date.now(),
  startRun: (sessionId) =>
    set((s) => ({
      runs: { ...s.runs, [sessionId]: { running: true, startedAt: Date.now(), totalTokens: 0 } },
    })),
  updateRun: (sessionId, totalTokens) =>
    set((s) => {
      const run = s.runs[sessionId]
      if (!run) return s
      return { runs: { ...s.runs, [sessionId]: { ...run, totalTokens } } }
    }),
  setRunTask: (sessionId, taskID) =>
    set((s) => {
      const run = s.runs[sessionId]
      if (!run) return s
      return { runs: { ...s.runs, [sessionId]: { ...run, taskID } } }
    }),
  finishRun: (sessionId) =>
    set((s) => {
      const run = s.runs[sessionId]
      if (!run) return s
      return { runs: { ...s.runs, [sessionId]: { ...run, running: false } } }
    }),
  tick: () => set({ now: Date.now() }),
}))
