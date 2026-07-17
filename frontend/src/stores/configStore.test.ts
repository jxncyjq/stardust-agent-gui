import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock() factories are hoisted above all imports (and above any top-level
// const in this file), so referencing a plain `const mocks = {...}` here
// throws "Cannot access 'mocks' before initialization". vi.hoisted() hoists
// the initializer itself alongside vi.mock, avoiding the TDZ error.
const mocks = vi.hoisted(() => ({
  GetConfig: vi.fn(),
  GetConfigPath: vi.fn(),
  GetAgentConfig: vi.fn(),
  SaveAll: vi.fn(),
}))
vi.mock('../../wailsjs/go/main/App', () => mocks)

import { useConfigStore } from './configStore'

const MAIN = '{"maas":{"default_profile":"dev"},"runtime":{"max_tool_rounds":4}}'

// loadMain puts the store in the state it has right after the dialog opens.
async function loadMain() {
  mocks.GetConfig.mockResolvedValue(MAIN)
  mocks.GetConfigPath.mockResolvedValue('/x/agent.json')
  await useConfigStore.getState().load()
}

beforeEach(() => {
  mocks.GetConfig.mockReset()
  mocks.GetConfigPath.mockReset()
  mocks.GetAgentConfig.mockReset()
  mocks.SaveAll.mockReset()
  useConfigStore.setState({
    path: '',
    draft: null,
    baseline: '',
    agentDrafts: {},
    agentBaselines: {},
    loading: false,
    saving: false,
    error: '',
    dirty: false,
  })
})

describe('configStore', () => {
  it('loads config into draft and is not dirty', async () => {
    await loadMain()
    const s = useConfigStore.getState()
    expect(s.path).toBe('/x/agent.json')
    expect(s.draft.runtime.max_tool_rounds).toBe(4)
    expect(s.dirty).toBe(false)
    expect(s.error).toBe('')
  })

  it('update marks dirty and mutates draft immutably', async () => {
    await loadMain()
    useConfigStore.getState().update('runtime.max_tool_rounds', 9)
    const s = useConfigStore.getState()
    expect(s.draft.runtime.max_tool_rounds).toBe(9)
    expect(s.dirty).toBe(true)
  })

  it('save sends the serialized draft with no agent files and clears dirty', async () => {
    await loadMain()
    mocks.SaveAll.mockResolvedValue(undefined)
    useConfigStore.getState().update('runtime.max_tool_rounds', 9)
    await useConfigStore.getState().save()
    expect(mocks.SaveAll).toHaveBeenCalledTimes(1)
    const [sent, files] = mocks.SaveAll.mock.calls[0]
    expect(JSON.parse(sent).runtime.max_tool_rounds).toBe(9)
    expect(files).toEqual({})
    expect(useConfigStore.getState().dirty).toBe(false)
  })

  it('records error when load fails', async () => {
    mocks.GetConfig.mockRejectedValue(new Error('read config: boom'))
    mocks.GetConfigPath.mockResolvedValue('/x/agent.json')
    await useConfigStore.getState().load()
    expect(useConfigStore.getState().error).toContain('boom')
  })

  it('loadAgent reads an existing sub-agent file without marking dirty', async () => {
    await loadMain()
    mocks.GetAgentConfig.mockResolvedValue({
      exists: true,
      content: '{"id":"researcher","role":"researcher","maas_profile":"review"}',
    })
    await useConfigStore.getState().loadAgent('agents/researcher.json', 'researcher')
    const s = useConfigStore.getState()
    expect(s.agentDrafts['agents/researcher.json'].maas_profile).toBe('review')
    expect(s.dirty).toBe(false)
  })

  it('loadAgent seeds a template for a missing file and marks dirty', async () => {
    await loadMain()
    mocks.GetAgentConfig.mockResolvedValue({ exists: false, content: '' })
    await useConfigStore.getState().loadAgent('agents/new-agent.json', 'new-agent')
    const s = useConfigStore.getState()
    const seeded = s.agentDrafts['agents/new-agent.json']
    expect(seeded.id).toBe('new-agent')
    // The template picks up the main config's default profile so the new agent
    // is runnable as soon as it is saved.
    expect(seeded.maas_profile).toBe('dev')
    // A file that does not exist yet must count as a pending change.
    expect(s.agentBaselines['agents/new-agent.json']).toBe('')
    expect(s.dirty).toBe(true)
  })

  it('save sends only the changed sub-agent files alongside the main config', async () => {
    await loadMain()
    mocks.SaveAll.mockResolvedValue(undefined)
    mocks.GetAgentConfig
      .mockResolvedValueOnce({ exists: true, content: '{"id":"a","maas_profile":"dev"}' })
      .mockResolvedValueOnce({ exists: true, content: '{"id":"b","maas_profile":"dev"}' })
    await useConfigStore.getState().loadAgent('agents/a.json', 'a')
    await useConfigStore.getState().loadAgent('agents/b.json', 'b')
    // Edit only agent a; b was merely opened and must not be rewritten.
    useConfigStore.getState().updateAgent('agents/a.json', 'role', 'analyst')
    expect(useConfigStore.getState().dirty).toBe(true)

    await useConfigStore.getState().save()
    const [, files] = mocks.SaveAll.mock.calls[0]
    expect(Object.keys(files)).toEqual(['agents/a.json'])
    expect(JSON.parse(files['agents/a.json']).role).toBe('analyst')
    expect(useConfigStore.getState().dirty).toBe(false)
  })

  it('save re-throws and keeps dirty when the backend rejects', async () => {
    await loadMain()
    mocks.SaveAll.mockRejectedValue(new Error('validate new content: boom'))
    useConfigStore.getState().update('runtime.max_tool_rounds', 9)
    await expect(useConfigStore.getState().save()).rejects.toThrow('boom')
    const s = useConfigStore.getState()
    expect(s.error).toContain('boom')
    expect(s.dirty).toBe(true)
    expect(s.saving).toBe(false)
  })
})
