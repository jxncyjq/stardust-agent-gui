import { create } from 'zustand'
import { GetConfig, GetConfigPath, SaveConfig } from '../../wailsjs/go/main/App'
import { setPath } from '../lib/objectPath'

// serialize renders the draft as pretty JSON — the exact form written to disk
// and compared against the baseline for the dirty flag.
function serialize(obj: any): string {
  return JSON.stringify(obj, null, 2)
}

interface ConfigState {
  path: string
  draft: any
  baseline: string // serialize() of the last loaded/saved draft
  loading: boolean
  saving: boolean
  error: string
  dirty: boolean
  load: () => Promise<void>
  update: (path: string, value: any) => void
  save: () => Promise<void>
  reset: () => void
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  path: '',
  draft: null,
  baseline: '',
  loading: false,
  saving: false,
  error: '',
  dirty: false,

  load: async () => {
    set({ loading: true, error: '' })
    try {
      const [raw, path] = await Promise.all([GetConfig(), GetConfigPath()])
      const draft = JSON.parse(raw)
      set({ path, draft, baseline: serialize(draft), dirty: false, loading: false })
    } catch (err: any) {
      // Fail loud: surface the reason instead of showing an empty form.
      set({ error: String(err?.message ?? err), loading: false })
    }
  },

  update: (path, value) => {
    const draft = setPath(get().draft, path, value)
    set({ draft, dirty: serialize(draft) !== get().baseline })
  },

  save: async () => {
    const { draft, baseline } = get()
    set({ saving: true, error: '' })
    try {
      const raw = serialize(draft)
      await SaveConfig(raw)
      set({ baseline: raw, dirty: false, saving: false })
    } catch (err: any) {
      set({ error: String(err?.message ?? err), saving: false })
      throw err // let the modal keep itself open and show the failure
    }
    void baseline
  },

  reset: () => {
    const { baseline } = get()
    if (!baseline) return
    set({ draft: JSON.parse(baseline), dirty: false })
  },
}))
