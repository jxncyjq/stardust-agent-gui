import { create } from 'zustand'

// uiStore holds cross-panel UI flags. settingsOpen drives the settings modal,
// toggled from the sidebar gear and consumed by App.
interface UIState {
  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void
}

export const useUIStore = create<UIState>((set) => ({
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}))
