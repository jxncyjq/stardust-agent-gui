import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, screen, waitFor, within } from '@testing-library/react'

// vi.mock() factories are hoisted above imports/top-level consts (see
// ModeSelector.test.tsx), so the mock objects must be built with vi.hoisted().
// ListPlugins/GrantPlugin/DenyPlugin are here (not stubbed away) because the
// plugin-tab tests below render the real PluginsPage/PluginConsentDialog
// underneath SettingsModal rather than mocking them out — the whole point of
// those tests is to exercise that mount path, not stand in for it.
const mocks = vi.hoisted(() => ({
  ListTasks: vi.fn(),
  ListPlugins: vi.fn(),
  GrantPlugin: vi.fn(),
  DenyPlugin: vi.fn(),
}))
vi.mock('../../../wailsjs/go/main/App', () => mocks)

// PluginsPage subscribes to the Wails runtime's plugin event channel, and this
// suite renders it for real (inside SettingsModal) rather than stubbing it —
// which is the whole point of these tests. The runtime module talks to
// window.runtime, which jsdom does not have, so it is mocked here. The
// canceller is recorded so an unmount that forgets to call it is visible.
const runtimeMocks = vi.hoisted(() => {
  const cancels: Array<() => void> = []
  return {
    cancels,
    EventsOn: vi.fn(() => {
      const cancel = vi.fn()
      cancels.push(cancel)
      return cancel
    }),
  }
})
vi.mock('../../../wailsjs/runtime/runtime', () => ({ EventsOn: runtimeMocks.EventsOn }))

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
// pluginsOpen/openPlugins/closePlugins were added to the real store
// alongside the plugin tab (see uiStore.ts) — this mock must carry them too,
// or every field SettingsModal reads off it resolves to undefined.
const uiState = vi.hoisted(() => ({
  editingAgent: null as any,
  closeAgent: vi.fn(),
  pluginsOpen: false,
  openPlugins: vi.fn(),
  closePlugins: vi.fn(),
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
import { usePluginConsentStore } from '../../stores/pluginConsentStore'
import { main } from '../../../wailsjs/go/models'

function makePlugin(overrides: Partial<main.PluginDTO> = {}): main.PluginDTO {
  return main.PluginDTO.createFrom({
    name: 'sample-plugin',
    version: '1.0.0',
    state: 'unauthorized',
    detail: '',
    tools: [],
    declared_capabilities: [],
    declared_allowed_hosts: [],
    declared_allowed_paths: [],
    declared_unresolved: false,
    granted_capabilities: [],
    granted_allowed_hosts: [],
    granted_allowed_paths: [],
    ...overrides,
  })
}

beforeEach(() => {
  mocks.ListTasks.mockReset()
  mocks.ListTasks.mockResolvedValue([])
  mocks.ListPlugins.mockReset()
  mocks.GrantPlugin.mockReset()
  mocks.DenyPlugin.mockReset()
  useConfirmStore.setState({ request: null })
  usePluginConsentStore.setState({ inFlight: 0 })
  uiState.editingAgent = null
  uiState.pluginsOpen = false
  uiState.openPlugins.mockReset()
  uiState.closePlugins.mockReset()
  uiState.closeAgent.mockReset()
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

  // Integration test for the bug the review flagged: PluginConsentDialog.test.tsx
  // and PluginsPage.test.tsx both render those components standalone, so
  // neither exercises SettingsModal's own Escape handler at all. This test
  // renders SettingsModal -> PluginsPage -> PluginConsentDialog for real (only
  // the Wails bindings are mocked) and drives an actual grant submission into
  // its in-flight state, the exact window Rule 3 says must offer no way to
  // back out — Escape included.
  it('does NOT close on Escape while a plugin consent request is converging (SettingsModal -> PluginsPage -> PluginConsentDialog)', async () => {
    uiState.pluginsOpen = true
    mocks.ListPlugins.mockResolvedValue([makePlugin({ name: 'sample-plugin', state: 'unauthorized' })])
    mocks.GrantPlugin.mockReturnValue(new Promise(() => {})) // never resolves — the convergence wait

    const onClose = vi.fn()
    render(<SettingsModal open onClose={onClose} />)

    const row = await screen.findByRole('group', { name: '插件 sample-plugin' })
    fireEvent.click(within(row).getByRole('button', { name: '授权' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认并授权' }))

    // Rule 3's spinner is up: the request is genuinely in flight, with zero
    // buttons rendered anywhere in the dialog.
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  // Important-1 from the whole-branch final review: the same onClose is also
  // reachable via the backdrop click and the header X button, neither of
  // which consulted inFlight before this fix — and unlike
  // PluginConsentDialog's submitting phase, a row-level retryConvergence has
  // no overlay of its own to swallow those clicks. This drives the row-retry
  // path (not the dialog submit path the test above uses) so the spinner has
  // no buttons and no overlay, then tries every other door.
  it('does NOT close via the backdrop click or the header X while a row-level convergence retry is in flight, and the X is disabled', async () => {
    uiState.pluginsOpen = true
    mocks.ListPlugins.mockResolvedValue([makePlugin({ name: 'sample-plugin', state: 'unauthorized' })])
    mocks.GrantPlugin.mockResolvedValueOnce(
      main.ConsentResultDTO.createFrom({
        name: 'sample-plugin',
        pending_convergence: true,
        convergence_detail: 'apply deferred: 1 task still running',
        granted_capabilities: [],
        granted_allowed_hosts: [],
        granted_allowed_paths: [],
      }),
    )

    const onClose = vi.fn()
    const { container } = render(<SettingsModal open onClose={onClose} />)

    const row = await screen.findByRole('group', { name: '插件 sample-plugin' })
    fireEvent.click(within(row).getByRole('button', { name: '授权' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认并授权' }))
    await screen.findByText('已授权，等待收敛生效')
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    // Now retry from the row, and never let the retry call resolve — the
    // exact "row shows a spinner with no buttons" state Important-1 flags.
    mocks.GrantPlugin.mockReturnValue(new Promise(() => {}))
    const pendingRow = await screen.findByRole('group', { name: '插件 sample-plugin' })
    fireEvent.click(within(pendingRow).getByRole('button', { name: '重试收敛' }))
    await waitFor(() => {
      const liveRow = screen.getByRole('group', { name: '插件 sample-plugin' })
      expect(within(liveRow).queryAllByRole('button')).toHaveLength(0)
    })

    // Door 1: the header X button must be disabled, not just a dead click.
    const closeButton = screen.getByRole('button', { name: '关闭设置' })
    expect(closeButton).toBeDisabled()
    fireEvent.click(closeButton)
    expect(onClose).not.toHaveBeenCalled()

    // Door 2: the backdrop itself (the modal's outermost fixed overlay).
    const backdrop = container.firstElementChild as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('SettingsModal — plugin tab wiring', () => {
  it('shows the plugin panel and hides the config footer when pluginsOpen is true', async () => {
    uiState.pluginsOpen = true
    mocks.ListPlugins.mockResolvedValue([])
    render(<SettingsModal open onClose={vi.fn()} />)

    expect(await screen.findByText('插件授权')).toBeInTheDocument()
    // The plugin panel acts immediately through its own grant/deny calls,
    // independent of the draft save/restart flow — that footer must not
    // show while it is the active tab.
    expect(screen.queryByRole('button', { name: '保存并重启' })).not.toBeInTheDocument()
  })

  it('shows the config sections (not the plugin panel) when pluginsOpen is false', () => {
    uiState.pluginsOpen = false
    render(<SettingsModal open onClose={vi.fn()} />)
    expect(screen.queryByText('插件授权')).not.toBeInTheDocument()
  })

  it('clicking "插件" calls openPlugins, clicking "配置" calls closePlugins', () => {
    render(<SettingsModal open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '插件' }))
    expect(uiState.openPlugins).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '配置' }))
    expect(uiState.closePlugins).toHaveBeenCalledTimes(1)
  })
})
