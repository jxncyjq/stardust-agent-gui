import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// vi.mock() factories are hoisted above imports/top-level consts (see
// SettingsModal.test.tsx / PluginConsentDialog.test.tsx), so the mock
// functions must be built with vi.hoisted().
const mocks = vi.hoisted(() => ({
  ListPlugins: vi.fn(),
  GrantPlugin: vi.fn(),
  DenyPlugin: vi.fn(),
  ResolvePlugin: vi.fn(),
}))
vi.mock('../../../wailsjs/go/main/App', () => mocks)

import { PluginsPage } from './PluginsPage'
import { main } from '../../../wailsjs/go/models'
import { usePluginConsentStore } from '../../stores/pluginConsentStore'

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
  mocks.ListPlugins.mockReset()
  mocks.GrantPlugin.mockReset()
  mocks.DenyPlugin.mockReset()
  mocks.ResolvePlugin.mockReset()
  usePluginConsentStore.setState({ inFlight: 0 })
})

describe('PluginsPage — the three states render distinctly', () => {
  it('gives unauthorized a badge and an "授权" call to action', async () => {
    mocks.ListPlugins.mockResolvedValue([makePlugin({ name: 'plugin-u', state: 'unauthorized' })])
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-u' })
    expect(within(row).getByText('未授权')).toBeInTheDocument()
    expect(within(row).getByText('尚无授权决定。')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: '授权' })).toBeInTheDocument()
  })

  it('gives disabled a distinct badge/text and does not push a primary "授权" action', async () => {
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({ name: 'plugin-d', state: 'disabled', detail: 'the manifest entry sets "enabled": false' }),
    ])
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-d' })
    expect(within(row).getByText('已禁用')).toBeInTheDocument()
    expect(within(row).getByText('该插件的授权已被拒绝。')).toBeInTheDocument()
    // disabled must not read as "nobody decided yet" — no "授权" CTA, only
    // the muted "重新授权" affordance.
    expect(within(row).queryByRole('button', { name: '授权' })).not.toBeInTheDocument()
    expect(within(row).getByRole('button', { name: '重新授权' })).toBeInTheDocument()
  })

  it('shows the detail reason for a failed plugin', async () => {
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({ name: 'plugin-f', state: 'failed', detail: 'tool name conflict: fetch' }),
    ])
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-f' })
    expect(within(row).getByText('失败')).toBeInTheDocument()
    expect(within(row).getByText(/tool name conflict: fetch/)).toBeInTheDocument()
  })
})

describe('PluginsPage — declared_unresolved is not "requests nothing"', () => {
  it('shows a distinct unresolved note instead of an empty-declaration message', async () => {
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({ name: 'remote-x', state: 'unauthorized', declared_capabilities: [], declared_unresolved: true }),
    ])
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 remote-x' })
    expect(within(row).queryByText(/未声明任何能力|不请求任何权限|请求任何/)).not.toBeInTheDocument()
    expect(within(row).getByText(/尚未在本地解析/)).toBeInTheDocument()
  })
})

describe('PluginsPage — declared_error surfaces which package broke without hiding the rest', () => {
  it('renders the declared_error reason on the broken row and still offers its deny button, while the other row in the same payload renders normally', async () => {
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({
        name: 'broken-plugin',
        state: 'failed',
        detail: 'tool name conflict: fetch',
        declared_unresolved: true,
        declared_error: 'plugin.json: unexpected end of JSON input',
      }),
      makePlugin({ name: 'healthy-plugin', state: 'unauthorized' }),
    ])
    render(<PluginsPage />)

    // The broken row shows the declared_error reason, distinct from the
    // loader's own `detail` line, and its deny button ("撤销授权") is still
    // reachable — the whole point of the server fix this wires up.
    const brokenRow = await screen.findByRole('group', { name: '插件 broken-plugin' })
    expect(within(brokenRow).getByText(/plugin.json: unexpected end of JSON input/)).toBeInTheDocument()
    expect(within(brokenRow).getByText(/tool name conflict: fetch/)).toBeInTheDocument()
    expect(within(brokenRow).getByRole('button', { name: '撤销授权' })).toBeInTheDocument()

    // One broken package must not hide any other row in the same payload —
    // this is the regression the 500 caused (zero rows rendered at all).
    const healthyRow = await screen.findByRole('group', { name: '插件 healthy-plugin' })
    expect(within(healthyRow).getByRole('button', { name: '授权' })).toBeInTheDocument()
    expect(within(healthyRow).queryByText(/JSON input/)).not.toBeInTheDocument()
  })
})

describe('PluginsPage — pending_convergence and the no-cancel rule', () => {
  it('renders "已授权，等待收敛" with convergence_detail and a retry affordance once a grant reports pending_convergence', async () => {
    mocks.ListPlugins.mockResolvedValue([makePlugin({ name: 'plugin-p', state: 'unauthorized' })])
    mocks.GrantPlugin.mockResolvedValue(
      main.ConsentResultDTO.createFrom({
        name: 'plugin-p',
        pending_convergence: true,
        convergence_detail: 'apply deferred: 2 tasks still running',
        granted_capabilities: [],
        granted_allowed_hosts: [],
        granted_allowed_paths: [],
      }),
    )
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-p' })
    fireEvent.click(within(row).getByRole('button', { name: '授权' }))

    fireEvent.click(await screen.findByRole('button', { name: '确认并授权' }))

    await screen.findByText('已授权，等待收敛生效')
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    const updatedRow = await screen.findByRole('group', { name: '插件 plugin-p' })
    expect(within(updatedRow).getByText('待收敛')).toBeInTheDocument()
    expect(within(updatedRow).getByText('已授权，等待收敛生效。')).toBeInTheDocument()
    expect(within(updatedRow).getByText(/2 tasks still running/)).toBeInTheDocument()
    expect(within(updatedRow).getByRole('button', { name: '重试收敛' })).toBeInTheDocument()
  })

  it('drops the pre-grant explanation once the grant succeeds, even though the result omits detail', async () => {
    // Caught on a real machine, not by any test: the row showed the new state
    // ("运行中") above the OLD pre-grant line telling the operator the plugin had
    // never been authorized and to go run `agent plugins grant`. Server-side
    // `detail` is `json:"detail,omitempty"`, so a successful grant -- which has
    // nothing to report -- omits the field entirely and it arrives undefined.
    // Resolving it with `?? plugin.detail` then backfilled the stale text, while
    // `state` (no omitempty) updated correctly. Hence one row, two fields,
    // contradicting each other. This fixture reproduces the real payload by
    // NOT setting detail at all.
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({
        name: 'plugin-s',
        state: 'unauthorized',
        detail: 'reason=plugins.json records no grant block for this entry, so it has never been authorized here',
      }),
    ])
    mocks.GrantPlugin.mockResolvedValue(
      main.ConsentResultDTO.createFrom({
        name: 'plugin-s',
        state: 'loaded',
        pending_convergence: false,
        granted_capabilities: ['log'],
        granted_allowed_hosts: [],
        granted_allowed_paths: [],
        tools: ['echo_tool'],
      }),
    )
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-s' })
    fireEvent.click(within(row).getByRole('button', { name: '授权' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认并授权' }))
    await screen.findByText('已生效')
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    const updatedRow = await screen.findByRole('group', { name: '插件 plugin-s' })
    expect(within(updatedRow).queryByText(/never been authorized here/)).not.toBeInTheDocument()
    expect(within(updatedRow).queryByText(/agent plugins grant/)).not.toBeInTheDocument()
  })

  it('never renders a cancel button anywhere while a grant request is converging', async () => {
    mocks.ListPlugins.mockResolvedValue([makePlugin({ name: 'plugin-w', state: 'unauthorized' })])
    mocks.GrantPlugin.mockReturnValue(new Promise(() => {})) // never resolves — simulates the apply_wait_ms wait
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-w' })
    fireEvent.click(within(row).getByRole('button', { name: '授权' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认并授权' }))

    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).queryAllByRole('button')).toHaveLength(0))
    expect(screen.queryByText('取消')).not.toBeInTheDocument()
  })

  it('never renders a cancel button while a row-level convergence retry is in flight', async () => {
    mocks.ListPlugins.mockResolvedValue([makePlugin({ name: 'plugin-r', state: 'unauthorized' })])
    mocks.GrantPlugin.mockResolvedValueOnce(
      main.ConsentResultDTO.createFrom({
        name: 'plugin-r',
        pending_convergence: true,
        convergence_detail: 'apply deferred: 1 task still running',
        granted_capabilities: [],
        granted_allowed_hosts: [],
        granted_allowed_paths: [],
      }),
    )
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-r' })
    fireEvent.click(within(row).getByRole('button', { name: '授权' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认并授权' }))
    await screen.findByText('已授权，等待收敛生效')
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    // Now retry from the row, and never let the retry call resolve.
    mocks.GrantPlugin.mockReturnValue(new Promise(() => {}))
    const pendingRow = await screen.findByRole('group', { name: '插件 plugin-r' })
    fireEvent.click(within(pendingRow).getByRole('button', { name: '重试收敛' }))

    await waitFor(() => {
      const liveRow = screen.getByRole('group', { name: '插件 plugin-r' })
      expect(within(liveRow).queryAllByRole('button')).toHaveLength(0)
    })
  })
})

describe('PluginsPage — convergence_detail on the converged branch is not dropped', () => {
  it('renders convergence_detail as a warning even though this entry itself converged (pending_convergence false)', async () => {
    mocks.ListPlugins.mockResolvedValue([makePlugin({ name: 'plugin-a', state: 'unauthorized' })])
    mocks.GrantPlugin.mockResolvedValue(
      main.ConsentResultDTO.createFrom({
        name: 'plugin-a',
        pending_convergence: false,
        state: 'loaded',
        detail: '',
        convergence_detail: 'plugin-b failed to activate: tool name conflict',
        granted_capabilities: [],
        granted_allowed_hosts: [],
        granted_allowed_paths: [],
      }),
    )
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-a' })
    fireEvent.click(within(row).getByRole('button', { name: '授权' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认并授权' }))
    await screen.findByText('已生效')
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    // This entry converged clean (state loaded, not pending) — but an
    // UNRELATED entry's convergence failure must still be visible here, not
    // dropped just because plugin-a itself came up fine.
    const updatedRow = await screen.findByRole('group', { name: '插件 plugin-a' })
    expect(within(updatedRow).getByText(/plugin-b failed to activate/)).toBeInTheDocument()
  })
})

describe('PluginsPage — load failure is surfaced, not swallowed', () => {
  it('shows the error instead of rendering an empty list', async () => {
    mocks.ListPlugins.mockRejectedValue(new Error('plugin access denied'))
    render(<PluginsPage />)
    await screen.findByText(/加载插件列表失败/)
    expect(screen.getByText(/plugin access denied/)).toBeInTheDocument()
    expect(screen.queryByText('此部署未配置任何插件。')).not.toBeInTheDocument()
  })
})

// Task 5: the panel button that lets an operator fetch an uncached remote
// plugin's declaration (Task 4's ResolvePlugin) without authorizing
// anything. Four rules, one test each (plus the in-flight registration):
//  1. An unresolved row offers "取回声明" in secondary styling; "授权" stays
//     disabled — fetching is not the goal, authorizing is.
//  2. The fetch registers via beginPluginConsent/endPluginConsent so
//     SettingsModal's close guards can see it — it really downloads.
//  3. Success replaces the row's declaration in place and leaves a
//     PERSISTENT cache note (not a toast: the package stays cached either
//     way, so the fact stays true).
//  4. Two failure shapes: untrusted (errPluginUntrusted) gets no retry
//     button; every other failure gets a plain retry.
describe('PluginsPage — fetching a declaration before deciding (Task 5)', () => {
  it('offers 取回声明 for an unresolved row and keeps 授权 disabled', async () => {
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({ name: 'plugin-u', state: 'unauthorized', declared_unresolved: true }),
    ])
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-u' })
    expect(within(row).getByRole('button', { name: '取回声明' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: '授权' })).toBeDisabled()
  })

  it('registers the fetch as in-flight so the modal close guards can see it', async () => {
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({ name: 'plugin-i', state: 'unauthorized', declared_unresolved: true }),
    ])
    mocks.ResolvePlugin.mockReturnValue(new Promise(() => {})) // never resolves
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-i' })
    fireEvent.click(within(row).getByRole('button', { name: '取回声明' }))

    await waitFor(() => {
      expect(usePluginConsentStore.getState().inFlight).toBeGreaterThan(0)
    })
  })

  it('shows the declaration and a persistent cache note after a successful fetch', async () => {
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({ name: 'plugin-r', state: 'unauthorized', declared_unresolved: true }),
    ])
    mocks.ResolvePlugin.mockResolvedValue(
      main.PluginDTO.createFrom({
        name: 'plugin-r',
        state: 'unauthorized',
        declared_capabilities: ['http'],
        declared_allowed_hosts: [],
        declared_allowed_paths: [],
        declared_unresolved: false,
        granted_capabilities: [],
        granted_allowed_hosts: [],
        granted_allowed_paths: [],
        tools: [],
      }),
    )
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-r' })
    fireEvent.click(within(row).getByRole('button', { name: '取回声明' }))

    const updated = await screen.findByRole('group', { name: '插件 plugin-r' })
    expect(within(updated).getByText(/已取回并缓存该插件包/)).toBeInTheDocument()
    expect(within(updated).getByRole('button', { name: '授权' })).not.toBeDisabled()
  })

  it('offers no retry when the package is untrusted', async () => {
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({ name: 'plugin-x', state: 'unauthorized', declared_unresolved: true }),
    ])
    mocks.ResolvePlugin.mockRejectedValue(new Error('插件包不被信任'))
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-x' })
    fireEvent.click(within(row).getByRole('button', { name: '取回声明' }))

    const updated = await screen.findByRole('group', { name: '插件 plugin-x' })
    expect(within(updated).queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
    expect(within(updated).getByText(/不被信任/)).toBeInTheDocument()
  })

  it('offers a retry when the fetch merely failed', async () => {
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({ name: 'plugin-n', state: 'unauthorized', declared_unresolved: true }),
    ])
    mocks.ResolvePlugin.mockRejectedValue(new Error('resolve plugin "plugin-n": dial tcp: connection refused'))
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-n' })
    fireEvent.click(within(row).getByRole('button', { name: '取回声明' }))

    const updated = await screen.findByRole('group', { name: '插件 plugin-n' })
    expect(within(updated).getByRole('button', { name: '重试' })).toBeInTheDocument()
  })
})
