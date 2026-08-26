import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// vi.mock() factories are hoisted above imports/top-level consts (see
// ModeSelector.test.tsx / ApprovalPrompt's own bindings), so the mock
// functions must be built with vi.hoisted().
const mocks = vi.hoisted(() => ({
  GrantPlugin: vi.fn(),
  DenyPlugin: vi.fn(),
}))
vi.mock('../../../wailsjs/go/main/App', () => mocks)

import { PluginConsentDialog } from './PluginConsentDialog'
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
  mocks.GrantPlugin.mockReset()
  mocks.DenyPlugin.mockReset()
})

describe('PluginConsentDialog — capabilities are a read-only list', () => {
  it('never renders a checkbox for a capability row', () => {
    const plugin = makePlugin({ declared_capabilities: ['fs', 'http'] })
    render(<PluginConsentDialog plugin={plugin} mode="grant" onClose={vi.fn()} onResult={vi.fn()} />)

    // Both declared capabilities show up as plain read-only text.
    expect(screen.getByText('fs')).toBeInTheDocument()
    expect(screen.getByText('http')).toBeInTheDocument()

    // This fixture declares no hosts/paths, so if capabilities correctly
    // render as a read-only list (never as checkboxes, disabled or not),
    // there must be NO checkbox anywhere in the dialog at all.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('states in one sentence that a capability declaration is not a menu', () => {
    const plugin = makePlugin({ declared_capabilities: ['fs'] })
    render(<PluginConsentDialog plugin={plugin} mode="grant" onClose={vi.fn()} onResult={vi.fn()} />)
    expect(screen.getByText(/能力声明不是菜单/)).toBeInTheDocument()
  })
})

describe('PluginConsentDialog — hosts/paths are checkboxes, default all-checked', () => {
  it('renders one checked checkbox per declared host and path', () => {
    const plugin = makePlugin({
      declared_capabilities: ['http', 'fs'],
      declared_allowed_hosts: ['api.example.com', 'cdn.example.com'],
      declared_allowed_paths: ['/tmp/plugin-a'],
    })
    render(<PluginConsentDialog plugin={plugin} mode="grant" onClose={vi.fn()} onResult={vi.fn()} />)

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(checkboxes).toHaveLength(3)
    checkboxes.forEach((cb) => expect(cb.checked).toBe(true))
  })

  it('lets a host be unchecked individually', () => {
    const plugin = makePlugin({
      declared_capabilities: ['fs'],
      declared_allowed_hosts: ['api.example.com', 'cdn.example.com'],
    })
    render(<PluginConsentDialog plugin={plugin} mode="grant" onClose={vi.fn()} onResult={vi.fn()} />)
    const cb = screen.getByRole('checkbox', { name: /api\.example\.com/ }) as HTMLInputElement
    fireEvent.click(cb)
    expect(cb.checked).toBe(false)
    // the other host stays checked — this is narrowing, not an all-or-nothing toggle.
    expect((screen.getByRole('checkbox', { name: /cdn\.example\.com/ }) as HTMLInputElement).checked).toBe(true)
  })
})

describe('PluginConsentDialog — clearing every host blocks an http grant before submit', () => {
  it('disables confirm and shows a reason once all hosts are unchecked', () => {
    const plugin = makePlugin({
      declared_capabilities: ['http'],
      declared_allowed_hosts: ['api.example.com'],
    })
    render(<PluginConsentDialog plugin={plugin} mode="grant" onClose={vi.fn()} onResult={vi.fn()} />)

    const confirmBtn = screen.getByRole('button', { name: '确认并授权' })
    expect(confirmBtn).toBeEnabled()

    fireEvent.click(screen.getByRole('checkbox', { name: /api\.example\.com/ }))

    expect(confirmBtn).toBeDisabled()
    expect(screen.getByText(/至少保留一个主机/)).toBeInTheDocument()
    // and the request must never even be attempted
    expect(mocks.GrantPlugin).not.toHaveBeenCalled()
  })

  it('does not block when http is declared but the plugin declares no hosts at all', () => {
    const plugin = makePlugin({ declared_capabilities: ['http'], declared_allowed_hosts: [] })
    render(<PluginConsentDialog plugin={plugin} mode="grant" onClose={vi.fn()} onResult={vi.fn()} />)
    expect(screen.getByRole('button', { name: '确认并授权' })).toBeEnabled()
  })
})

// Mirrors the http/hosts block above exactly — same server-side rule
// (consent.RefuseUnnamedAllowlist), same shape, for the fs/allowed_paths
// pair instead of http/allowed_hosts.
describe('PluginConsentDialog — clearing every path blocks an fs grant before submit', () => {
  it('disables confirm and shows a reason once all paths are unchecked', () => {
    const plugin = makePlugin({
      declared_capabilities: ['fs'],
      declared_allowed_paths: ['/tmp/plugin-a'],
    })
    render(<PluginConsentDialog plugin={plugin} mode="grant" onClose={vi.fn()} onResult={vi.fn()} />)

    const confirmBtn = screen.getByRole('button', { name: '确认并授权' })
    expect(confirmBtn).toBeEnabled()

    fireEvent.click(screen.getByRole('checkbox', { name: /\/tmp\/plugin-a/ }))

    expect(confirmBtn).toBeDisabled()
    expect(screen.getByText(/至少保留一个路径/)).toBeInTheDocument()
    expect(mocks.GrantPlugin).not.toHaveBeenCalled()
  })

  it('does not block when fs is declared but the plugin declares no paths at all', () => {
    const plugin = makePlugin({ declared_capabilities: ['fs'], declared_allowed_paths: [] })
    render(<PluginConsentDialog plugin={plugin} mode="grant" onClose={vi.fn()} onResult={vi.fn()} />)
    expect(screen.getByRole('button', { name: '确认并授权' })).toBeEnabled()
  })
})

describe('PluginConsentDialog — no cancel affordance while converging', () => {
  it('renders zero buttons while the grant request is in flight', async () => {
    let resolveGrant: (v: main.ConsentResultDTO) => void = () => {}
    mocks.GrantPlugin.mockReturnValue(new Promise((resolve) => { resolveGrant = resolve }))

    const plugin = makePlugin({ declared_capabilities: [] })
    render(<PluginConsentDialog plugin={plugin} mode="grant" onClose={vi.fn()} onResult={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '确认并授权' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument()
    })
    // The whole point: no button exists to press, named "取消" or otherwise,
    // for as long as the server request is outstanding.
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByText('取消')).not.toBeInTheDocument()

    resolveGrant(main.ConsentResultDTO.createFrom({ name: plugin.name, pending_convergence: false, state: 'loaded' }))
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })

  it('backdrop click does not dismiss the dialog while the grant request is in flight', async () => {
    mocks.GrantPlugin.mockReturnValue(new Promise(() => {})) // never resolves — stays "in flight"
    const onClose = vi.fn()
    const plugin = makePlugin({ declared_capabilities: [] })
    render(<PluginConsentDialog plugin={plugin} mode="grant" onClose={onClose} onResult={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '确认并授权' }))
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())

    // The dialog's own outer overlay (the backdrop) is the dialog card's
    // parent element — click it directly, not the card itself.
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('backdrop click DOES dismiss the dialog once the request has settled (sanity check for the guard above)', async () => {
    mocks.GrantPlugin.mockResolvedValue(
      main.ConsentResultDTO.createFrom({ name: 'sample-plugin', pending_convergence: false, state: 'loaded' }),
    )
    const onClose = vi.fn()
    const plugin = makePlugin({ declared_capabilities: [] })
    render(<PluginConsentDialog plugin={plugin} mode="grant" onClose={onClose} onResult={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '确认并授权' }))
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the retry-convergence affordance (not a cancel) once pending_convergence is true', async () => {
    mocks.GrantPlugin.mockResolvedValue(
      main.ConsentResultDTO.createFrom({
        name: 'sample-plugin',
        pending_convergence: true,
        convergence_detail: 'apply deferred: 2 tasks still running',
      }),
    )
    const onResult = vi.fn()
    const plugin = makePlugin({ declared_capabilities: [] })
    render(<PluginConsentDialog plugin={plugin} mode="grant" onClose={vi.fn()} onResult={onResult} />)

    fireEvent.click(screen.getByRole('button', { name: '确认并授权' }))

    await screen.findByText(/等待收敛生效/)
    expect(screen.getByText(/2 tasks still running/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试收敛' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument()
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][0].pending_convergence).toBe(true)
  })
})

describe('PluginConsentDialog — declared_unresolved is not "requests nothing"', () => {
  it('blocks grant with a distinct reason instead of showing an empty checklist', () => {
    const plugin = makePlugin({ declared_capabilities: [], declared_unresolved: true })
    render(<PluginConsentDialog plugin={plugin} mode="grant" onClose={vi.fn()} onResult={vi.fn()} />)

    expect(screen.queryByText('此插件未声明任何能力。')).not.toBeInTheDocument()
    expect(screen.getAllByText(/尚未在本地解析/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '确认并授权' })).toBeDisabled()
  })
})

describe('PluginConsentDialog — deny mode', () => {
  it('has no capability/host/path checkboxes and confirms via DenyPlugin', async () => {
    mocks.DenyPlugin.mockResolvedValue(
      main.ConsentResultDTO.createFrom({ name: 'sample-plugin', pending_convergence: false, state: 'disabled' }),
    )
    const onResult = vi.fn()
    const plugin = makePlugin({
      state: 'loaded',
      granted_capabilities: ['fs'],
      granted_allowed_hosts: [],
      granted_allowed_paths: [],
    })
    render(<PluginConsentDialog plugin={plugin} mode="deny" onClose={vi.fn()} onResult={onResult} />)

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '确认撤销' }))

    await waitFor(() => expect(mocks.DenyPlugin).toHaveBeenCalledWith('sample-plugin'))
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1))
  })
})

describe('PluginConsentDialog — error recovery is surfaced, not a dead end', () => {
  it('shows a rejected GrantPlugin call and "返回修改" takes the user back to the editable form', async () => {
    mocks.GrantPlugin.mockRejectedValueOnce(new Error('server unreachable'))
    const plugin = makePlugin({ declared_capabilities: ['fs'], declared_allowed_paths: ['/tmp/plugin-a'] })
    render(<PluginConsentDialog plugin={plugin} mode="grant" onClose={vi.fn()} onResult={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '确认并授权' }))
    await screen.findByText(/请求失败：server unreachable/)

    fireEvent.click(screen.getByRole('button', { name: '返回修改' }))

    // Back on the editable form: the confirm button and the path checkbox
    // are there again, and the stale error text is gone.
    expect(screen.getByRole('button', { name: '确认并授权' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /\/tmp\/plugin-a/ })).toBeInTheDocument()
    expect(screen.queryByText(/请求失败/)).not.toBeInTheDocument()
  })

  it('retries a failed grant via the "重试" button and reaches the success state', async () => {
    mocks.GrantPlugin.mockRejectedValueOnce(new Error('timeout'))
    mocks.GrantPlugin.mockResolvedValueOnce(
      main.ConsentResultDTO.createFrom({ name: 'sample-plugin', pending_convergence: false, state: 'loaded' }),
    )
    const plugin = makePlugin({ declared_capabilities: [] })
    render(<PluginConsentDialog plugin={plugin} mode="grant" onClose={vi.fn()} onResult={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '确认并授权' }))
    await screen.findByText(/请求失败：timeout/)

    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => expect(mocks.GrantPlugin).toHaveBeenCalledTimes(2))
    await screen.findByText('已生效')
    expect(screen.queryByText(/请求失败/)).not.toBeInTheDocument()
  })

  it('surfaces a rejected DenyPlugin call the same way, with a "重试" affordance', async () => {
    mocks.DenyPlugin.mockRejectedValueOnce(new Error('revoke failed'))
    const plugin = makePlugin({ state: 'loaded', granted_capabilities: ['fs'] })
    render(<PluginConsentDialog plugin={plugin} mode="deny" onClose={vi.fn()} onResult={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '确认撤销' }))
    await screen.findByText(/请求失败：revoke failed/)
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })
})
