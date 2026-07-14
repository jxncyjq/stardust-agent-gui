import { create } from 'zustand'

// StatusTab enumerates the four right-hand status panel tabs. It is the single
// source of truth shared between StatusPanel (which renders the tabs) and the
// chat slash commands (which switch the active tab via /event, /tasks, /audit,
// /inbox).
export type StatusTab = 'events' | 'tasks' | 'audit' | 'inbox'

interface StatusState {
  activeTab: StatusTab
  setActiveTab: (tab: StatusTab) => void
}

// useStatusStore lifts the previously-local StatusPanel tab selection into a
// shared store so the chat panel can drive it without prop drilling or context.
export const useStatusStore = create<StatusState>((set) => ({
  activeTab: 'events',
  setActiveTab: (tab) => set({ activeTab: tab }),
}))
