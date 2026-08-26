import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// vi.mock() factories are hoisted above imports/top-level consts (see
// SettingsModal.test.tsx / PluginConsentDialog.test.tsx), so the mock
// functions must be built with vi.hoisted().
const mocks = vi.hoisted(() => ({
  ListPlugins: vi.fn(),
  GrantPlugin: vi.fn(),
  DenyPlugin: vi.fn(),
}))
vi.mock('../../../wailsjs/go/main/App', () => mocks)

import { PluginsPage } from './PluginsPage'
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
  mocks.ListPlugins.mockReset()
  mocks.GrantPlugin.mockReset()
  mocks.DenyPlugin.mockReset()
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

describe('PluginsPage — load failure is surfaced, not swallowed', () => {
  it('shows the error instead of rendering an empty list', async () => {
    mocks.ListPlugins.mockRejectedValue(new Error('plugin access denied'))
    render(<PluginsPage />)
    await screen.findByText(/加载插件列表失败/)
    expect(screen.getByText(/plugin access denied/)).toBeInTheDocument()
    expect(screen.queryByText('此部署未配置任何插件。')).not.toBeInTheDocument()
  })
})
