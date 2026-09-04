import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'

// App pulls in many bound methods/hooks; stub the wails layer wholesale.
vi.mock('../wailsjs/go/main/App', () => ({
  ReadHTMLFile: vi.fn(),
  ListSessions: vi.fn().mockResolvedValue([]),
  ServeStatus: vi.fn().mockResolvedValue({}),
  ListAgents: vi.fn().mockResolvedValue([]),
  ListPendingApprovals: vi.fn().mockResolvedValue([]),
  GetAgentModelInfo: vi.fn().mockResolvedValue({}),
  ListWorkspaceDir: vi.fn().mockResolvedValue([]),
  ReadWorkspaceFile: vi.fn().mockResolvedValue({}),
  SearchWorkspaceContent: vi.fn().mockResolvedValue([]),
  OpenInEditor: vi.fn().mockResolvedValue(undefined),
  RevealInExplorer: vi.fn().mockResolvedValue(undefined),
  BundledChromiumPath: vi.fn().mockResolvedValue(''),
}))
vi.mock('../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(() => () => {}),
  EventsOff: vi.fn(),
  BrowserOpenURL: vi.fn(),
}))

import App from './App'
import { usePreviewStore } from './stores/previewStore'
import { useUIStore } from './stores/uiStore'
import { EventsOn } from '../wailsjs/runtime/runtime'

describe('App right column preview integration', () => {
  beforeEach(() => {
    usePreviewStore.getState().close()
    useUIStore.getState().setRightView('status')
  })

  it('auto-switches to the preview tab when a preview opens', () => {
    render(<App />)
    act(() => {
      usePreviewStore.getState().open({ kind: 'html', html: '<h1>hi</h1>', title: '报告' })
    })
    expect(useUIStore.getState().rightView).toBe('preview')
    expect(screen.getByTitle('HTML 预览内容')).toBeInTheDocument()
  })

  it('switches to files tab', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: '文件' }))
    expect(useUIStore.getState().rightView).toBe('files')
  })
})

// Task 3 的 hook 测试只证明 useChromiumInstall 自己对，证明不了它被接进了 App——本仓
// 栽过三次「接缝在但没人调用它」。这里不 mock useChromiumInstall，让它真的挂载，直接
// 断言 App 渲染后确实订阅了 chromium:install。
describe('App wires up chromium install listener', () => {
  it('App 挂了 chromium 安装监听（否则关掉设置面板就再也收不到进度）', async () => {
    render(<App />)
    await waitFor(() =>
      expect(vi.mocked(EventsOn).mock.calls.some((c) => c[0] === 'chromium:install')).toBe(true)
    )
  })
})
