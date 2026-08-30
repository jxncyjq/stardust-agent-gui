import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// App 挂了一整棵树；这里只关心「浏览器栏在不在、怎么收起、怎么回来」，所以把重的
// 子树都换成占位。
vi.mock('./components/Sidebar', () => ({ Sidebar: () => <div>sidebar</div> }))
vi.mock('./components/ChatPanel', () => ({ ChatPanel: () => <div>chat</div> }))
vi.mock('./components/StatusPanel', () => ({ StatusPanel: () => <div>status</div> }))
vi.mock('./components/workspace/WorkspaceFilePanel', () => ({
  WorkspaceFilePanel: () => <div>files</div>,
}))
vi.mock('./components/WebPreviewPanel', () => ({ WebPreviewPanel: () => <div>preview</div> }))
vi.mock('./components/ConnectionBadge', () => ({ ConnectionBadge: () => <div>badge</div> }))
vi.mock('./components/settings/SettingsModal', () => ({ SettingsModal: () => null }))
vi.mock('./components/ConfirmDialog', () => ({ ConfirmDialog: () => null }))
vi.mock('./hooks/useBrowserSession', () => ({ useBrowserSession: () => {} }))
vi.mock('./hooks/useHtmlPreviewEvents', () => ({ useHtmlPreviewEvents: () => {} }))
vi.mock('./components/BrowserView', () => ({
  BrowserView: ({ onClose }: { onClose?: () => void }) => (
    <div>
      browser-view
      <button type="button" onClick={onClose}>
        收起
      </button>
    </div>
  ),
}))

import App from './App'
import { useBrowserStore } from './stores/browserStore'
import { useUIStore } from './stores/uiStore'

beforeEach(() => {
  localStorage.clear()
  useBrowserStore.getState().reset()
  useBrowserStore.getState().setSession(null)
  useUIStore.getState().setBrowserPanelOpen(true)
})

// 浏览器视图从右栏的一个 tab 搬到了自己的一栏。这三条钉住那次搬家的意义：不浏览时
// 不占地方、浏览时与状态栏并存、收起来之后回得去。

describe('the browser panel', () => {
  it('takes no space when nothing is browsing', () => {
    render(<App />)

    expect(screen.queryByText('browser-view')).toBeNull()
    expect(screen.queryByRole('button', { name: '显示浏览器' })).toBeNull()
  })

  it('appears beside the status panel once a session exists', async () => {
    render(<App />)
    useBrowserStore.getState().setSession('sess-1')

    expect(await screen.findByText('browser-view')).toBeInTheDocument()
    // 与状态栏并存，而不是二选一——这正是从 tab 里搬出来的理由。
    expect(screen.getByText('status')).toBeInTheDocument()
  })

  it('can be dismissed and brought back', async () => {
    render(<App />)
    useBrowserStore.getState().setSession('sess-1')
    fireEvent.click(await screen.findByRole('button', { name: '收起' }))

    await waitFor(() => expect(screen.queryByText('browser-view')).toBeNull())
    // 收起来之后必须有路回去，否则那个会话就又看不见了——正是这次改动要消灭的状态。
    fireEvent.click(screen.getByRole('button', { name: '显示浏览器' }))
    expect(await screen.findByText('browser-view')).toBeInTheDocument()
  })

  it('reopens itself when the agent starts a new session', async () => {
    render(<App />)
    useBrowserStore.getState().setSession('sess-1')
    fireEvent.click(await screen.findByRole('button', { name: '收起' }))
    await waitFor(() => expect(screen.queryByText('browser-view')).toBeNull())

    useBrowserStore.getState().setSession('sess-2')

    expect(await screen.findByText('browser-view')).toBeInTheDocument()
  })
})
