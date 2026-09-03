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

// runtimeMocks stands in for the Wails runtime's event API, in the same shape
// ChatPanel.test.tsx uses: EventsOn records the callback and returns the
// canceller the component is expected to call on unmount.
const runtimeMocks = vi.hoisted(() => {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {}
  return {
    listeners,
    EventsOn: vi.fn((name: string, cb: (...args: any[]) => void) => {
      ;(listeners[name] ??= []).push(cb)
      return () => {
        listeners[name] = (listeners[name] ?? []).filter((registered) => registered !== cb)
      }
    }),
  }
})
vi.mock('../../../wailsjs/runtime/runtime', () => ({ EventsOn: runtimeMocks.EventsOn }))

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
    declared_extensions: [],
    declared_unresolved: false,
    declared_unresolved_reason: '',
    granted_capabilities: [],
    granted_allowed_hosts: [],
    granted_allowed_paths: [],
    granted_extensions: [],
    ...overrides,
  })
}

beforeEach(() => {
  mocks.ListPlugins.mockReset()
  mocks.GrantPlugin.mockReset()
  mocks.DenyPlugin.mockReset()
  mocks.ResolvePlugin.mockReset()
  usePluginConsentStore.setState({ inFlight: 0 })
  for (const key of Object.keys(runtimeMocks.listeners)) delete runtimeMocks.listeners[key]
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
      makePlugin({ name: 'remote-x', state: 'unauthorized', declared_capabilities: [], declared_unresolved: true, declared_unresolved_reason: 'not_cached' }),
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
        declared_unresolved_reason: 'load_failed',
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
      makePlugin({ name: 'plugin-u', state: 'unauthorized', declared_unresolved: true, declared_unresolved_reason: 'not_cached' }),
    ])
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-u' })
    expect(within(row).getByRole('button', { name: '取回声明' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: '授权' })).toBeDisabled()
  })

  it('registers the fetch as in-flight so the modal close guards can see it', async () => {
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({ name: 'plugin-i', state: 'unauthorized', declared_unresolved: true, declared_unresolved_reason: 'not_cached' }),
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
      makePlugin({ name: 'plugin-r', state: 'unauthorized', declared_unresolved: true, declared_unresolved_reason: 'not_cached' }),
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
      makePlugin({ name: 'plugin-x', state: 'unauthorized', declared_unresolved: true, declared_unresolved_reason: 'not_cached' }),
    ])
    // Rejects with a bare STRING, not `new Error(...)` — this is what a
    // real Wails binding rejection actually looks like (calls.js rejects
    // with the raw error string, never an Error instance; see errText's
    // comment in PluginsPage.tsx). errText()'s `String(err)` branch must
    // handle this identically to the Error-instance branch other tests in
    // this file exercise.
    mocks.ResolvePlugin.mockRejectedValue('插件包不被信任')
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-x' })
    fireEvent.click(within(row).getByRole('button', { name: '取回声明' }))

    const updated = await screen.findByRole('group', { name: '插件 plugin-x' })
    expect(within(updated).queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
    expect(within(updated).getByText(/不被信任/)).toBeInTheDocument()
  })

  it('offers a retry when the fetch merely failed', async () => {
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({ name: 'plugin-n', state: 'unauthorized', declared_unresolved: true, declared_unresolved_reason: 'not_cached' }),
    ])
    mocks.ResolvePlugin.mockRejectedValue(new Error('resolve plugin "plugin-n": dial tcp: connection refused'))
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-n' })
    fireEvent.click(within(row).getByRole('button', { name: '取回声明' }))

    const updated = await screen.findByRole('group', { name: '插件 plugin-n' })
    expect(within(updated).getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  // IMPORTANT-2 from the Task 5 review: onGrant/onDeny at the PluginsPage
  // level must hand PluginConsentDialog the FETCHED declaration
  // (resolved[plugin.name]), not the stale pre-fetch `plugin` from `.map()`.
  // Without that fix, clicking 授权 after a successful fetch opens the
  // dialog on the original declared_unresolved:true/declared_capabilities:[]
  // snapshot, and the dialog's own `unresolvedBlocked`/`confirmDisabled`
  // logic (PluginConsentDialog.tsx:90,109) re-disables "确认并授权" —
  // silently defeating the entire point of fetching first. Neither the
  // in-flight test nor the "shows the declaration..." test above opens the
  // dialog after a fetch, so this is the only test that would catch a
  // regression on PluginsPage.tsx:216-217.
  it('opens the consent dialog on the FETCHED declaration, not the stale pre-fetch one, after a successful fetch', async () => {
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({ name: 'plugin-f', state: 'unauthorized', declared_capabilities: [], declared_unresolved: true, declared_unresolved_reason: 'not_cached' }),
    ])
    mocks.ResolvePlugin.mockResolvedValue(
      main.PluginDTO.createFrom({
        name: 'plugin-f',
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
    const row = await screen.findByRole('group', { name: '插件 plugin-f' })
    fireEvent.click(within(row).getByRole('button', { name: '取回声明' }))

    const updated = await screen.findByRole('group', { name: '插件 plugin-f' })
    const grantButton = await within(updated).findByRole('button', { name: '授权' })
    await waitFor(() => expect(grantButton).not.toBeDisabled())
    fireEvent.click(grantButton)

    const dialog = await screen.findByRole('dialog')
    // Reflects the FETCHED declaration: the read-only capability list shows
    // "http" (from the mocked ResolvePlugin response), and the confirm
    // button is enabled — the strongest assertion available, since a stale
    // declared_unresolved:true snapshot would keep both of these false.
    expect(within(dialog).getByText('http')).toBeInTheDocument()
    expect(within(dialog).queryByText(/该插件的声明尚未在本地解析/)).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '确认并授权' })).not.toBeDisabled()
  })
})

describe('PluginsPage — I-1: the deny dialog must show the CURRENT grant, not the pre-fetch one', () => {
  // The resolved DTO is fresher for declared_*, and STALER for granted_*:
  // server-side Resolve fills granted_* from entry.Grant as of the moment of
  // the fetch, and `resolved` is deliberately never cleared. Handing it to
  // the deny dialog therefore pins that dialog to the pre-fetch grant state
  // for the rest of the session — so the one dialog whose entire job is to
  // show what is about to be revoked shows nothing at all.
  //
  // This test fails on
  // `onDeny={() => setDialog({ plugin: resolved[plugin.name] ?? plugin, … })}`:
  // the resolved fixture below carries granted_capabilities: [], captured
  // before the grant, so the "当前已授权的能力（只读）" list comes back empty.
  it('lists the capability granted AFTER the fetch when 撤销授权 opens', async () => {
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({
        name: 'plugin-dn',
        state: 'unauthorized',
        declared_capabilities: [],
        declared_unresolved: true,
        declared_unresolved_reason: 'not_cached',
      }),
    ])
    // The fetch response: the declaration is now known, and nothing is
    // granted yet — this empty granted_capabilities is exactly the snapshot
    // that used to leak into the deny dialog.
    mocks.ResolvePlugin.mockResolvedValue(
      main.PluginDTO.createFrom({
        name: 'plugin-dn',
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
    // The grant response: http IS granted now, and the row goes 运行中.
    mocks.GrantPlugin.mockResolvedValue(
      main.ConsentResultDTO.createFrom({
        name: 'plugin-dn',
        state: 'loaded',
        pending_convergence: false,
        declared_capabilities: ['http'],
        declared_allowed_hosts: [],
        declared_allowed_paths: [],
        declared_unresolved: false,
        granted_capabilities: ['http'],
        granted_allowed_hosts: [],
        granted_allowed_paths: [],
        tools: [],
      }),
    )
    render(<PluginsPage />)

    // 1. fetch
    const row = await screen.findByRole('group', { name: '插件 plugin-dn' })
    fireEvent.click(within(row).getByRole('button', { name: '取回声明' }))

    // 2. grant http
    const fetched = await screen.findByRole('group', { name: '插件 plugin-dn' })
    const grantButton = await within(fetched).findByRole('button', { name: '授权' })
    await waitFor(() => expect(grantButton).not.toBeDisabled())
    fireEvent.click(grantButton)
    const grantDialog = await screen.findByRole('dialog')
    fireEvent.click(within(grantDialog).getByRole('button', { name: '确认并授权' }))
    await screen.findByText('已生效')
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    // 3. 撤销授权 — the dialog must show what is actually granted RIGHT NOW.
    const granted = await screen.findByRole('group', { name: '插件 plugin-dn' })
    fireEvent.click(within(granted).getByRole('button', { name: '撤销授权' }))

    const denyDialog = await screen.findByRole('dialog')
    expect(within(denyDialog).getByText('当前已授权的能力（只读）')).toBeInTheDocument()
    expect(within(denyDialog).getByText('http')).toBeInTheDocument()
  })
})

describe('PluginsPage — I-3: the cache note stops claiming 未授权 once the plugin is authorized', () => {
  it('drops the （未授权，可随时撤销） clause after a successful grant, keeping the cache fact', async () => {
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({
        name: 'plugin-cn',
        state: 'unauthorized',
        declared_capabilities: [],
        declared_unresolved: true,
        declared_unresolved_reason: 'not_cached',
      }),
    ])
    mocks.ResolvePlugin.mockResolvedValue(
      main.PluginDTO.createFrom({
        name: 'plugin-cn',
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
    mocks.GrantPlugin.mockResolvedValue(
      main.ConsentResultDTO.createFrom({
        name: 'plugin-cn',
        state: 'loaded',
        pending_convergence: false,
        granted_capabilities: ['http'],
        granted_allowed_hosts: [],
        granted_allowed_paths: [],
        tools: [],
      }),
    )
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-cn' })
    fireEvent.click(within(row).getByRole('button', { name: '取回声明' }))

    // Before the grant the clause is correct and must be there.
    const fetched = await screen.findByRole('group', { name: '插件 plugin-cn' })
    expect(within(fetched).getByText(/未授权，可随时撤销/)).toBeInTheDocument()

    const grantButton = await within(fetched).findByRole('button', { name: '授权' })
    await waitFor(() => expect(grantButton).not.toBeDisabled())
    fireEvent.click(grantButton)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '确认并授权' }))
    await screen.findByText('已生效')
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    const updated = await screen.findByRole('group', { name: '插件 plugin-cn' })
    // 运行中 above a line asserting 未授权 is two fields of one row
    // contradicting each other.
    expect(within(updated).getByText('运行中')).toBeInTheDocument()
    expect(within(updated).queryByText(/未授权，可随时撤销/)).not.toBeInTheDocument()
    // The cache fact itself is permanent and must survive.
    expect(within(updated).getByText(/已取回并缓存该插件包/)).toBeInTheDocument()
  })
})

describe('PluginsPage — I-4: 取回声明 is offered only where a fetch can work', () => {
  it('offers no fetch button, and says there is no cache, when the deployment configured none', async () => {
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({
        name: 'plugin-nc',
        state: 'unauthorized',
        declared_unresolved: true,
        declared_unresolved_reason: 'no_cache_configured',
      }),
    ])
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-nc' })
    // A fetch here fails on "this deployment configured no plugins.cache
    // directory" every single time — the remedy is a config edit and a serve
    // restart, which nothing in this panel can do.
    expect(within(row).queryByRole('button', { name: '取回声明' })).not.toBeInTheDocument()
    expect(within(row).getByText(/未配置插件缓存目录/)).toBeInTheDocument()
    // "远程包尚未缓存" is wrong here: there is no cache to be absent from.
    expect(within(row).queryByText(/远程包尚未缓存/)).not.toBeInTheDocument()
    expect(within(row).getByRole('button', { name: '授权' })).toBeDisabled()
  })

  it('offers no fetch button for a package that failed to load', async () => {
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({
        name: 'plugin-lf',
        state: 'unauthorized',
        declared_unresolved: true,
        declared_unresolved_reason: 'load_failed',
        declared_error: 'plugin.json: unexpected end of JSON input',
      }),
    ])
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-lf' })
    // A local entry makes no network call at all, and a remote one is a cache
    // HIT that short-circuits before fetching: both re-read the same broken
    // bytes and fail identically, forever.
    expect(within(row).queryByRole('button', { name: '取回声明' })).not.toBeInTheDocument()
    expect(within(row).getByText(/unexpected end of JSON input/)).toBeInTheDocument()
  })

  it('offers no fetch button when the server sent no reason at all', async () => {
    // Fails CLOSED: an absent or unrecognised reason (an older server, a
    // value this build does not know) must not resurrect the button.
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({ name: 'plugin-ur', state: 'unauthorized', declared_unresolved: true }),
    ])
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-ur' })
    expect(within(row).queryByRole('button', { name: '取回声明' })).not.toBeInTheDocument()
    expect(within(row).getByText(/尚未在本地解析/)).toBeInTheDocument()
    expect(within(row).queryByText(/远程包尚未缓存/)).not.toBeInTheDocument()
  })

  it('offers no 重试 when a fetch failed on a row that was never fetchable', async () => {
    // Reachable when a row degrades between the click and the failure (a 422
    // caches the untrusted package, so the next List reports load_failed).
    // The error still renders — it is not swallowed — but the retry that
    // cannot work does not.
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({
        name: 'plugin-nr',
        state: 'unauthorized',
        declared_unresolved: true,
        declared_unresolved_reason: 'no_cache_configured',
      }),
    ])
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-nr' })
    expect(within(row).queryByRole('button', { name: '取回声明' })).not.toBeInTheDocument()
  })
})

// 2026-08-28 真机走查抓到的三个缺陷，全部是「断言了该出现的出现了，没人数不该
// 出现的」这一类。
//
// 原先这里引用了 docs 仓的一个路径（docs/superpowers/2026-08-28-gui-plugin-walkthrough.md），
// 但那份文档从未提交——两个仓里都不存在，git 历史里也没有。跨仓引用本就一改就悬空，
// 何况指向一份不存在的文件；三条缺陷的实质都记在下面，注释自包含即可：
//
//  F1 不可信告警把整条原始错误链（HTTP 状态行 + JSON 包体 + 四层转义的
//     绝对路径，633 字符）塞进同一个 <p>，人要读的那句被埋在中间。
//  F2 load() 只清 overrides，不清 resolveError/retryError，于是刷新之后
//     同一个失败由服务端和客户端各讲一遍。
//  F3 `resolved` 遮蔽服务端真相且永不清除。缓存条目从磁盘消失后，界面
//     仍宣称「已取回并缓存」，并且收走了唯一能修正它的「取回声明」按钮。
describe('PluginsPage — 真机走查抓到的缺陷', () => {
  const UNTRUSTED_CHAIN =
    'resolve plugin "plugin-t": 插件包不被信任: post /v1/plugins/plugin-t/resolve failed: ' +
    'status 422: {"error":"resolve plugin \\"plugin-t\\": plugin package is not trusted: ' +
    'verify signature: signature does not verify against key \\"demo-key\\""}'

  function uncachedRow(name: string) {
    return makePlugin({
      name,
      state: 'unauthorized',
      declared_unresolved: true,
      declared_unresolved_reason: 'not_cached',
    })
  }

  function resolvedView(name: string) {
    return main.PluginDTO.createFrom({
      name,
      state: 'unauthorized',
      declared_capabilities: ['log'],
      declared_allowed_hosts: [],
      declared_allowed_paths: [],
      declared_unresolved: false,
      granted_capabilities: [],
      granted_allowed_hosts: [],
      granted_allowed_paths: [],
      tools: [],
    })
  }

  it('F3: a refresh that reports the package uncached again drops the cache note and restores 取回声明', async () => {
    // The fetched view is not a fact about this session, it is a claim about
    // the SERVER'S DISK — and the server is the one that knows. Deleting the
    // cache entry (an operator clearing the cache dir, a disk cleanup) makes
    // "已取回并缓存该插件包" false, and until this fix a 刷新 could not
    // correct it: `resolved` shadowed the fresh row, so the panel kept
    // asserting the package was cached AND withheld the one control that
    // could fix it. Only restarting the app cleared it.
    mocks.ListPlugins.mockResolvedValue([uncachedRow('plugin-g')])
    mocks.ResolvePlugin.mockResolvedValue(resolvedView('plugin-g'))
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-g' })
    fireEvent.click(within(row).getByRole('button', { name: '取回声明' }))
    await screen.findByText(/已取回并缓存该插件包/)

    // The package is gone from the cache again; the next List says so.
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))

    await waitFor(() => {
      const refreshed = screen.getByRole('group', { name: '插件 plugin-g' })
      expect(within(refreshed).queryByText(/已取回并缓存该插件包/)).not.toBeInTheDocument()
    })
    const refreshed = screen.getByRole('group', { name: '插件 plugin-g' })
    expect(within(refreshed).getByRole('button', { name: '取回声明' })).toBeInTheDocument()
    expect(within(refreshed).getByRole('button', { name: '授权' })).toBeDisabled()
  })

  it('F3: a refresh that still agrees the package is resolved keeps the cache note', async () => {
    // The other half of the rule: reconciling must not throw away a fetch the
    // server still corroborates, or the operator loses a download they paid
    // for every time they click 刷新 — the very thing `resolved` survives a
    // refresh to prevent.
    mocks.ListPlugins.mockResolvedValueOnce([uncachedRow('plugin-k')]).mockResolvedValue([
      makePlugin({ name: 'plugin-k', state: 'unauthorized', declared_capabilities: ['log'] }),
    ])
    mocks.ResolvePlugin.mockResolvedValue(resolvedView('plugin-k'))
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-k' })
    fireEvent.click(within(row).getByRole('button', { name: '取回声明' }))
    await screen.findByText(/已取回并缓存该插件包/)

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))

    await waitFor(() => expect(mocks.ListPlugins).toHaveBeenCalledTimes(2))
    const refreshed = screen.getByRole('group', { name: '插件 plugin-k' })
    expect(within(refreshed).getByText(/已取回并缓存该插件包/)).toBeInTheDocument()
  })

  it('F2: a refresh clears the client-side fetch failure instead of doubling the server report', async () => {
    // A 422 caches the untrusted package, so the NEXT List reports the same
    // failure server-side as load_failed. Keeping the client-side alert past
    // that refresh renders one signature failure twice, ~1200 characters of
    // it, with no indication the two lines are the same event.
    mocks.ListPlugins.mockResolvedValueOnce([uncachedRow('plugin-d2')]).mockResolvedValue([
      makePlugin({
        name: 'plugin-d2',
        state: 'unauthorized',
        declared_unresolved: true,
        declared_unresolved_reason: 'load_failed',
        declared_error: 'verify plugin.json signature: plugin package is not trusted',
      }),
    ])
    mocks.ResolvePlugin.mockRejectedValue(UNTRUSTED_CHAIN)
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-d2' })
    fireEvent.click(within(row).getByRole('button', { name: '取回声明' }))
    await screen.findByText(/该插件包未通过信任校验/)

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))

    await waitFor(() => {
      const refreshed = screen.getByRole('group', { name: '插件 plugin-d2' })
      expect(within(refreshed).queryByText(/该插件包未通过信任校验/)).not.toBeInTheDocument()
    })
    // The server's own account of the same failure survives — clearing the
    // duplicate must not clear the report.
    const refreshed = screen.getByRole('group', { name: '插件 plugin-d2' })
    expect(within(refreshed).getByText(/插件声明解析失败/)).toBeInTheDocument()
  })

  it('F2: a stale 重试失败 does not resurface on a later convergence', async () => {
    // retryError is keyed by plugin name and load() never cleared it, while
    // load() DOES clear the override that gates its rendering. So the stale
    // text is invisible right after the refresh and reappears the moment a
    // new grant reports pending_convergence — attributing an old failure to
    // a request that has not failed.
    mocks.ListPlugins.mockResolvedValue([makePlugin({ name: 'plugin-rt', state: 'unauthorized' })])
    const pendingResult = main.ConsentResultDTO.createFrom({
      name: 'plugin-rt',
      pending_convergence: true,
      convergence_detail: 'apply deferred: 1 task still running',
      granted_capabilities: [],
      granted_allowed_hosts: [],
      granted_allowed_paths: [],
    })
    mocks.GrantPlugin.mockResolvedValueOnce(pendingResult)
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-rt' })
    fireEvent.click(within(row).getByRole('button', { name: '授权' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认并授权' }))
    await screen.findByText('已授权，等待收敛生效')
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    mocks.GrantPlugin.mockRejectedValueOnce('grant plugin "plugin-rt": boundary not reached')
    fireEvent.click(
      within(screen.getByRole('group', { name: '插件 plugin-rt' })).getByRole('button', { name: '重试收敛' }),
    )
    await screen.findByText(/重试失败/)

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(mocks.ListPlugins).toHaveBeenCalledTimes(2))

    // A fresh grant that is merely pending must not inherit the old failure.
    mocks.GrantPlugin.mockResolvedValueOnce(pendingResult)
    fireEvent.click(within(screen.getByRole('group', { name: '插件 plugin-rt' })).getByRole('button', { name: '授权' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认并授权' }))
    await screen.findByText('已授权，等待收敛生效')
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    const pendingRow = await screen.findByRole('group', { name: '插件 plugin-rt' })
    expect(within(pendingRow).queryByText(/重试失败/)).not.toBeInTheDocument()
  })

  it('F1: the untrusted alert states the finding alone and folds the raw chain behind a disclosure', async () => {
    mocks.ListPlugins.mockResolvedValue([uncachedRow('plugin-t')])
    mocks.ResolvePlugin.mockRejectedValue(UNTRUSTED_CHAIN)
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-t' })
    fireEvent.click(within(row).getByRole('button', { name: '取回声明' }))

    const updated = await screen.findByRole('group', { name: '插件 plugin-t' })
    const alert = within(updated).getByRole('alert')
    expect(alert.textContent).toBe('该插件包未通过信任校验，重试无法解决此问题，请联系插件包的提供方。')
    // The chain is kept, not dropped — an operator diagnosing a supply-chain
    // problem needs it — but it is one click away instead of in the sentence.
    expect(within(updated).getByText('显示详细错误')).toBeInTheDocument()
    expect(within(updated).getByText(/status 422/)).toBeInTheDocument()
    expect(within(updated).queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
  })

  it('F1: a plain fetch failure and a declaration-load failure fold their chains the same way', async () => {
    mocks.ListPlugins.mockResolvedValue([
      uncachedRow('plugin-p'),
      makePlugin({
        name: 'plugin-l',
        state: 'unauthorized',
        declared_unresolved: true,
        declared_unresolved_reason: 'load_failed',
        declared_error: 'load plugin package "C:\\cache\\sha256\\0d7f": verify plugin.json signature: bad',
      }),
    ])
    mocks.ResolvePlugin.mockRejectedValue('resolve plugin "plugin-p": dial tcp 127.0.0.1:18099: connection refused')
    render(<PluginsPage />)
    const loadRow = await screen.findByRole('group', { name: '插件 plugin-l' })
    expect(within(loadRow).getByText('插件声明解析失败。')).toBeInTheDocument()
    expect(within(loadRow).getByText('显示详细错误')).toBeInTheDocument()
    expect(within(loadRow).getByText(/verify plugin.json signature: bad/)).toBeInTheDocument()

    const fetchRow = screen.getByRole('group', { name: '插件 plugin-p' })
    fireEvent.click(within(fetchRow).getByRole('button', { name: '取回声明' }))
    const updated = await screen.findByRole('group', { name: '插件 plugin-p' })
    expect(within(updated).getByText('取回声明失败。')).toBeInTheDocument()
    expect(within(updated).getByText(/connection refused/)).toBeInTheDocument()
    expect(within(updated).getByRole('button', { name: '重试' })).toBeInTheDocument()
  })
})

// G5：面板按事件自动刷新。
//
// 插件生命周期事件（收敛完成、健康度卸载、依赖恢复）此刻已经从 loader 一路流到
// 前端，面板此前却只在打开时取一次、之后靠手点刷新——多人运维或后台收敛时，
// 屏幕上是旧状态。
//
// 事件只当「有什么变了」的信号：随后向 ListPlugins 问一次权威状态，不按事件
// 文本打补丁（那行 message 是给人看的，格式随时会变）。顺带的好处是刷新走的是
// 面板既有的 load()，因此自动带上 resolved 的对账，两条刷新路径行为一致。
describe('PluginsPage — 事件驱动的自动刷新', () => {
  function emitPluginEvent(type = 'plugin/loaded') {
    for (const cb of runtimeMocks.listeners['agent:plugin'] ?? []) cb({ type, data: '{"message":"plugin=x"}' })
  }

  it('reloads the list when a plugin lifecycle event arrives', async () => {
    mocks.ListPlugins.mockResolvedValueOnce([
      makePlugin({ name: 'plugin-live', state: 'unauthorized' }),
    ]).mockResolvedValue([makePlugin({ name: 'plugin-live', state: 'loaded', tools: ['t'] })])

    render(<PluginsPage />)
    await screen.findByRole('group', { name: '插件 plugin-live' })
    expect(mocks.ListPlugins).toHaveBeenCalledTimes(1)

    emitPluginEvent()

    await waitFor(() => expect(mocks.ListPlugins).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(within(screen.getByRole('group', { name: '插件 plugin-live' })).getByText('运行中')).toBeInTheDocument()
    })
  })

  it('coalesces a burst of events into a single reload', async () => {
    // 一次收敛会连发好几条（卸旧、装新、依赖恢复）。每条拉一次列表既放大请求，
    // 也会把「收敛进行中」的半截状态显示出来。
    mocks.ListPlugins.mockResolvedValue([makePlugin({ name: 'plugin-burst', state: 'loaded' })])
    render(<PluginsPage />)
    await screen.findByRole('group', { name: '插件 plugin-burst' })
    expect(mocks.ListPlugins).toHaveBeenCalledTimes(1)

    for (let i = 0; i < 5; i++) emitPluginEvent()

    await waitFor(() => expect(mocks.ListPlugins).toHaveBeenCalledTimes(2))
    // 等过一整个去抖窗口再看：如果没有合并，这里会看到 6 次。
    // 必须 > pluginEventReloadDelayMs(300)，否则等于什么都没验。
    await new Promise((resolve) => setTimeout(resolve, 420))
    expect(mocks.ListPlugins).toHaveBeenCalledTimes(2)
  })

  it('stops listening when the panel unmounts', async () => {
    // 设置面板会被反复开关。漏掉 cancel() 就是每开一次多一个监听器，
    // 最后一次收敛会触发 N 次刷新。
    mocks.ListPlugins.mockResolvedValue([makePlugin({ name: 'plugin-unmount', state: 'loaded' })])
    const view = render(<PluginsPage />)
    await screen.findByRole('group', { name: '插件 plugin-unmount' })

    view.unmount()
    emitPluginEvent()
    // 必须等过整个去抖窗口（300ms）：等得比它短，一个仍在排队的刷新会被漏掉,
    // 这条测试就无法发现「卸载时忘了退订」。
    await new Promise((resolve) => setTimeout(resolve, 420))

    expect(mocks.ListPlugins).toHaveBeenCalledTimes(1)
  })
})

// A row-level "重试收敛" resends the SAME grant. Everything the first grant
// authorized has to travel with it — an extension dropped on the retry would
// silently revoke a power the operator granted, and the row would go on
// showing the plugin as authorized.
describe('PluginsPage — a convergence retry resends the whole grant', () => {
  it('resends the granted extensions', async () => {
    mocks.ListPlugins.mockResolvedValue([
      makePlugin({ name: 'plugin-p', state: 'unauthorized', declared_extensions: ['decide'] }),
    ])
    mocks.GrantPlugin.mockResolvedValue(
      main.ConsentResultDTO.createFrom({
        name: 'plugin-p',
        pending_convergence: true,
        convergence_detail: 'apply deferred',
        granted_capabilities: [],
        granted_allowed_hosts: [],
        granted_allowed_paths: [],
        granted_extensions: ['decide'],
      }),
    )
    render(<PluginsPage />)
    const row = await screen.findByRole('group', { name: '插件 plugin-p' })
    fireEvent.click(within(row).getByRole('button', { name: '授权' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /decide/ }))
    fireEvent.click(await screen.findByRole('button', { name: '确认并授权' }))
    await screen.findByText('已授权，等待收敛生效')
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    const pendingRow = await screen.findByRole('group', { name: '插件 plugin-p' })
    mocks.GrantPlugin.mockClear()
    fireEvent.click(within(pendingRow).getByRole('button', { name: '重试收敛' }))

    await waitFor(() => expect(mocks.GrantPlugin).toHaveBeenCalled())
    expect(mocks.GrantPlugin).toHaveBeenCalledWith('plugin-p', [], [], [], ['decide'])
  })
})
