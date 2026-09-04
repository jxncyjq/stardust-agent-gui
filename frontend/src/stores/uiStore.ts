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

// SettingsTab selects which top-level view fills the settings modal's body:
// the config form, the plugin consent panel, or the browser install page.
export type SettingsTab = 'config' | 'plugins' | 'browser'

// uiStore holds cross-panel UI flags. settingsOpen drives the settings modal,
// toggled from the sidebar gear and consumed by App. editingAgent drives the
// drill-in sub-agent page inside that modal; it lives here rather than in the
// modal so the agents editor — rendered deep inside the form — can open a page
// without threading a callback through every field renderer. settingsTab is
// the same idea for the modal's other top-level views (PluginsPage,
// BrowserPage), which sit at the same level as editingAgent — a top-level
// view inside the modal, not a field inside the config draft — reachable from
// a tab in the modal's own header rather than from a field renderer. It is a
// three-way enum rather than a pair of booleans because two tabs could get
// away with one boolean each, but a third tab would let two booleans be true
// at once — the enum keeps "which page is open" a single fact.
interface UIState {
  settingsOpen: boolean
  editingAgent: EditingAgent | null
  settingsTab: SettingsTab
  openSettings: () => void
  closeSettings: () => void
  openAgent: (agent: EditingAgent) => void
  closeAgent: () => void
  setSettingsTab: (tab: SettingsTab) => void
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
  settingsTab: 'config',
  openSettings: () => set({ settingsOpen: true }),
  // Closing the dialog also leaves the sub-agent page and resets the tab, so
  // reopening starts on the main form rather than on whichever view was last
  // shown.
  closeSettings: () => set({ settingsOpen: false, editingAgent: null, settingsTab: 'config' }),
  openAgent: (agent) => set({ editingAgent: agent, settingsTab: 'config' }),
  closeAgent: () => set({ editingAgent: null }),
  setSettingsTab: (tab) => set({ settingsTab: tab, editingAgent: null }),
  rightView: 'status',
  setRightView: (v) => set({ rightView: v }),
  browserPanelOpen: true,
  setBrowserPanelOpen: (open) => set({ browserPanelOpen: open }),
}))
