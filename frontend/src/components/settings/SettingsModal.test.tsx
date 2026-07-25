import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

// vi.mock() factories are hoisted above imports/top-level consts (see
// ModeSelector.test.tsx), so the mock objects must be built with vi.hoisted().
const mocks = vi.hoisted(() => ({
  ListTasks: vi.fn(),
}))
vi.mock('../../../wailsjs/go/main/App', () => mocks)

// SettingsModal reads draft/dirty/etc. directly off useConfigStore() (no
// selector), so the mock just returns a fixed state object. draft stays null
// so neither the Section list nor AgentConfigPage renders — this test only
// exercises the Esc/width behavior, not the form body.
const configState = vi.hoisted(() => ({
  path: '/config/agent.json',
  draft: null as any,
  dirty: false,
  saving: false,
  error: '',
  load: vi.fn(),
  save: vi.fn(),
}))
vi.mock('../../stores/configStore', () => ({
  useConfigStore: vi.fn(() => configState),
}))

// uiStore is consumed via selector (useUIStore((s) => s.editingAgent)), so the
// mock must accept and apply a selector function like zustand does.
const uiState = vi.hoisted(() => ({
  editingAgent: null as any,
  closeAgent: vi.fn(),
}))
vi.mock('../../stores/uiStore', () => ({
  useUIStore: vi.fn((selector: (s: typeof uiState) => unknown) => selector(uiState)),
}))

// AgentConfigPage is never rendered while editingAgent is null, but its import
// still executes at module load; stub it so its own transitive deps (config
// store selectors, agent field renderers) never come into play here.
vi.mock('./AgentConfigPage', () => ({
  AgentConfigPage: () => null,
}))

import { SettingsModal } from './SettingsModal'
import { useConfirmStore } from '../../stores/confirmStore'

beforeEach(() => {
  mocks.ListTasks.mockReset()
  mocks.ListTasks.mockResolvedValue([])
  useConfirmStore.setState({ request: null })
})

describe('SettingsModal Esc', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<SettingsModal open onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('does NOT close on Escape while a confirm dialog is open', () => {
    const onClose = vi.fn()
    render(<SettingsModal open onClose={onClose} />)
    useConfirmStore.setState({
      request: { title: 't', message: 'm', confirmLabel: '确认', cancelLabel: '取消', danger: false },
    })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('uses a responsive width (not a hard-coded 720px only)', () => {
    const onClose = vi.fn()
    const { container } = render(<SettingsModal open onClose={onClose} />)
    const card = container.querySelector('.max-w-\\[720px\\]')
    expect(card).not.toBeNull()
  })
})
