import { create } from 'zustand'

// EditingAgent identifies the sub-agent whose config page is open inside the
// settings dialog: its name (the agent.json map key) and its config file path.
export interface EditingAgent {
  name: string
  path: string
}

// RightView selects which panel fills the right column: status tabs, the
// read-only agent browser view, the HTML preview, or the workspace file
// browser.
export type RightView = 'status' | 'preview' | 'files'

// uiStore holds cross-panel UI flags. settingsOpen drives the settings modal,
// toggled from the sidebar gear and consumed by App. editingAgent drives the
// drill-in sub-agent page inside that modal; it lives here rather than in the
// modal so the agents editor — rendered deep inside the form — can open a page
// without threading a callback through every field renderer. pluginsOpen is
// the same idea for the plugin consent panel (PluginsPage), which sits at the
// same level as editingAgent — a top-level view inside the modal, not a field
// inside the config draft — reachable from a tab in the modal's own header
// rather than from a field renderer.
interface UIState {
  settingsOpen: boolean
  editingAgent: EditingAgent | null
  pluginsOpen: boolean
  openSettings: () => void
  closeSettings: () => void
  openAgent: (agent: EditingAgent) => void
  closeAgent: () => void
  openPlugins: () => void
  closePlugins: () => void
  rightView: RightView
  setRightView: (v: RightView) => void
  // browserPanelOpen 决定那条浏览器栏在不在。
  //
  // 它是**用户的意愿**，与「有没有会话」是两回事：没有会话时栏本来就不存在；有会话
  // 而用户把它收起来了，就该一直收着，直到他自己打开——或者 Agent 开了一个**新的**
  // 会话（那时他多半想看，见 App 里的处理）。
  browserPanelOpen: boolean
  setBrowserPanelOpen: (open: boolean) => void
}

export const useUIStore = create<UIState>((set) => ({
  settingsOpen: false,
  editingAgent: null,
  pluginsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  // Closing the dialog also leaves the sub-agent page and the plugins page,
  // so reopening starts on the main form rather than on whichever view was
  // last shown.
  closeSettings: () => set({ settingsOpen: false, editingAgent: null, pluginsOpen: false }),
  openAgent: (agent) => set({ editingAgent: agent, pluginsOpen: false }),
  closeAgent: () => set({ editingAgent: null }),
  openPlugins: () => set({ pluginsOpen: true, editingAgent: null }),
  closePlugins: () => set({ pluginsOpen: false }),
  rightView: 'status',
  setRightView: (v) => set({ rightView: v }),
  browserPanelOpen: true,
  setBrowserPanelOpen: (open) => set({ browserPanelOpen: open }),
}))
