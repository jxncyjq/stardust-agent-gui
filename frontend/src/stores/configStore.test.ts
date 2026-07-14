import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock() factories are hoisted above all imports (and above any top-level
// const in this file), so referencing a plain `const mocks = {...}` here
// throws "Cannot access 'mocks' before initialization". vi.hoisted() hoists
// the initializer itself alongside vi.mock, avoiding the TDZ error.
const mocks = vi.hoisted(() => ({
  GetConfig: vi.fn(),
  GetConfigPath: vi.fn(),
  SaveConfig: vi.fn(),
}))
vi.mock('../../wailsjs/go/main/App', () => mocks)

import { useConfigStore } from './configStore'

beforeEach(() => {
  mocks.GetConfig.mockReset()
  mocks.GetConfigPath.mockReset()
  mocks.SaveConfig.mockReset()
  useConfigStore.setState({ path: '', draft: null, baseline: '', loading: false, saving: false, error: '', dirty: false })
})

describe('configStore', () => {
  it('loads config into draft and is not dirty', async () => {
    mocks.GetConfig.mockResolvedValue('{"runtime":{"max_tool_rounds":4}}')
    mocks.GetConfigPath.mockResolvedValue('/x/agent.json')
    await useConfigStore.getState().load()
    const s = useConfigStore.getState()
    expect(s.path).toBe('/x/agent.json')
    expect(s.draft.runtime.max_tool_rounds).toBe(4)
    expect(s.dirty).toBe(false)
    expect(s.error).toBe('')
  })

  it('update marks dirty and mutates draft immutably', async () => {
    mocks.GetConfig.mockResolvedValue('{"runtime":{"max_tool_rounds":4}}')
    mocks.GetConfigPath.mockResolvedValue('/x/agent.json')
    await useConfigStore.getState().load()
    useConfigStore.getState().update('runtime.max_tool_rounds', 9)
    const s = useConfigStore.getState()
    expect(s.draft.runtime.max_tool_rounds).toBe(9)
    expect(s.dirty).toBe(true)
  })

  it('save sends serialized draft and clears dirty', async () => {
    mocks.GetConfig.mockResolvedValue('{"runtime":{"max_tool_rounds":4}}')
    mocks.GetConfigPath.mockResolvedValue('/x/agent.json')
    mocks.SaveConfig.mockResolvedValue(undefined)
    await useConfigStore.getState().load()
    useConfigStore.getState().update('runtime.max_tool_rounds', 9)
    await useConfigStore.getState().save()
    expect(mocks.SaveConfig).toHaveBeenCalledTimes(1)
    const sent = mocks.SaveConfig.mock.calls[0][0]
    expect(JSON.parse(sent).runtime.max_tool_rounds).toBe(9)
    expect(useConfigStore.getState().dirty).toBe(false)
  })

  it('records error when load fails', async () => {
    mocks.GetConfig.mockRejectedValue(new Error('read config: boom'))
    mocks.GetConfigPath.mockResolvedValue('/x/agent.json')
    await useConfigStore.getState().load()
    expect(useConfigStore.getState().error).toContain('boom')
  })
})
