import { create } from 'zustand'

// EditingAgent identifies the sub-agent whose config page is open inside the
// settings dialog: its name (the agent.json map key) and its config file path.
export interface EditingAgent {
  name: string
  path: string
}

// uiStore holds cross-panel UI flags. settingsOpen drives the settings modal,
// toggled from the sidebar gear and consumed by App. editingAgent drives the
// drill-in sub-agent page inside that modal; it lives here rather than in the
// modal so the agents editor — rendered deep inside the form — can open a page
// without threading a callback through every field renderer.
interface UIState {
  settingsOpen: boolean
  editingAgent: EditingAgent | null
  openSettings: () => void
  closeSettings: () => void
  openAgent: (agent: EditingAgent) => void
  closeAgent: () => void
}

export const useUIStore = create<UIState>((set) => ({
  settingsOpen: false,
  editingAgent: null,
  openSettings: () => set({ settingsOpen: true }),
  // Closing the dialog also leaves the sub-agent page, so reopening starts on
  // the main form rather than on whichever agent was last viewed.
  closeSettings: () => set({ settingsOpen: false, editingAgent: null }),
  openAgent: (agent) => set({ editingAgent: agent }),
  closeAgent: () => set({ editingAgent: null }),
}))
