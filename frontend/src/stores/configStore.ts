import { create } from 'zustand'
import { GetConfig, GetConfigPath, GetAgentConfig, SaveAll } from '../../wailsjs/go/main/App'
import { setPath } from '../lib/objectPath'
import { agentTemplate } from '../types/agentConfig'

// serialize renders a draft as pretty JSON — the exact form written to disk and
// compared against the baseline for the dirty flag.
function serialize(obj: any): string {
  return JSON.stringify(obj, null, 2)
}

// changedAgents returns the sub-agent files whose draft differs from what is on
// disk, keyed by their path as written in agent.json. A baseline of '' means the
// file does not exist yet (a newly added agent), so its seeded template always
// counts as a change and the file gets created on save.
function changedAgents(
  drafts: Record<string, any>,
  baselines: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [rel, draft] of Object.entries(drafts)) {
    const raw = serialize(draft)
    if (raw !== (baselines[rel] ?? '')) out[rel] = raw
  }
  return out
}

// isDirty reports whether the main config or any sub-agent file has unsaved
// edits — the save button gates on this.
function isDirty(
  draft: any,
  baseline: string,
  drafts: Record<string, any>,
  baselines: Record<string, string>
): boolean {
  if (serialize(draft) !== baseline) return true
  return Object.keys(changedAgents(drafts, baselines)).length > 0
}

interface ConfigState {
  path: string
  draft: any
  baseline: string // serialize() of the last loaded/saved main draft
  // agentDrafts/agentBaselines are keyed by the sub-agent config path exactly as
  // written in agent.json (e.g. "configs/agents/researcher.json").
  agentDrafts: Record<string, any>
  agentBaselines: Record<string, string>
  loading: boolean
  saving: boolean
  error: string
  dirty: boolean
  load: () => Promise<void>
  update: (path: string, value: any) => void
  loadAgent: (relPath: string, name: string) => Promise<void>
  updateAgent: (relPath: string, path: string, value: any) => void
  save: () => Promise<void>
  reset: () => void
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  path: '',
  draft: null,
  baseline: '',
  agentDrafts: {},
  agentBaselines: {},
  loading: false,
  saving: false,
  error: '',
  dirty: false,

  load: async () => {
    set({ loading: true, error: '' })
    try {
      const [raw, path] = await Promise.all([GetConfig(), GetConfigPath()])
      const draft = JSON.parse(raw)
      // A fresh open starts from disk: drop any sub-agent drafts from a previous
      // session of the dialog so nothing stale is carried into the next save.
      set({
        path,
        draft,
        baseline: serialize(draft),
        agentDrafts: {},
        agentBaselines: {},
        dirty: false,
        loading: false,
      })
    } catch (err: any) {
      // Fail loud: surface the reason instead of showing an empty form.
      set({ error: String(err?.message ?? err), loading: false })
    }
  },

  update: (path, value) => {
    const draft = setPath(get().draft, path, value)
    set((s) => ({
      draft,
      dirty: isDirty(draft, s.baseline, s.agentDrafts, s.agentBaselines),
    }))
  },

  // loadAgent fetches one sub-agent config file into a draft. A file that does
  // not exist yet is seeded from the template (baseline '' marks it as new), so
  // a just-added agent opens on a runnable form and its file is created on save.
  // An already-loaded draft is kept as-is so unsaved edits survive navigation.
  loadAgent: async (relPath, name) => {
    if (get().agentDrafts[relPath] !== undefined) return
    set({ error: '' })
    try {
      const res = await GetAgentConfig(relPath)
      const draft = res.exists
        ? JSON.parse(res.content)
        : agentTemplate(name, String(get().draft?.maas?.default_profile ?? ''))
      const baseline = res.exists ? serialize(draft) : ''
      set((s) => {
        const agentDrafts = { ...s.agentDrafts, [relPath]: draft }
        const agentBaselines = { ...s.agentBaselines, [relPath]: baseline }
        return {
          agentDrafts,
          agentBaselines,
          dirty: isDirty(s.draft, s.baseline, agentDrafts, agentBaselines),
        }
      })
    } catch (err: any) {
      set({ error: String(err?.message ?? err) })
    }
  },

  updateAgent: (relPath, path, value) => {
    set((s) => {
      const agentDrafts = {
        ...s.agentDrafts,
        [relPath]: setPath(s.agentDrafts[relPath] ?? {}, path, value),
      }
      return {
        agentDrafts,
        dirty: isDirty(s.draft, s.baseline, agentDrafts, s.agentBaselines),
      }
    })
  },

  // save commits the main config and every changed sub-agent file as one unit:
  // the backend validates them all and writes nothing unless they all pass, then
  // restarts the service once.
  save: async () => {
    const { draft, agentDrafts, agentBaselines } = get()
    set({ saving: true, error: '' })
    const raw = serialize(draft)
    const files = changedAgents(agentDrafts, agentBaselines)
    try {
      await SaveAll(raw, files)
    } catch (err: any) {
      set({ error: String(err?.message ?? err), saving: false })
      throw err // let the modal keep itself open and show the failure
    }
    set((s) => ({
      baseline: raw,
      agentBaselines: { ...s.agentBaselines, ...files },
      dirty: false,
      saving: false,
    }))
  },

  reset: () => {
    const { baseline, agentBaselines } = get()
    if (!baseline) return
    // Drop edits: restore every agent draft that exists on disk and forget the
    // seeded drafts of agents whose file was never created.
    const agentDrafts: Record<string, any> = {}
    for (const [rel, raw] of Object.entries(agentBaselines)) {
      if (raw !== '') agentDrafts[rel] = JSON.parse(raw)
    }
    set({ draft: JSON.parse(baseline), agentDrafts, dirty: false })
  },
}))
