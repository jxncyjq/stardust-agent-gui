import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const appMocks = vi.hoisted(() => ({
  BrowserNavigate: vi.fn(),
  BrowserSessionInfo: vi.fn(),
  BrowserTakeover: vi.fn(),
  BrowserInput: vi.fn(),
  BrowserSetViewport: vi.fn(),
  EnsureBrowserStreamStatus: vi.fn(),
}))
vi.mock('../../wailsjs/go/main/App', () => appMocks)

import { BrowserToolbar } from './BrowserToolbar'

beforeEach(() => {
  Object.values(appMocks).forEach((m) => m.mockReset())
  appMocks.BrowserSessionInfo.mockResolvedValue(
    JSON.stringify({ session_id: 's1', url: 'https://example.com/', takeover: true, has_page: true }),
  )
  appMocks.BrowserNavigate.mockResolvedValue(undefined)
})

// 浏览器视图此前只是一个能点击的录像：界面上答不出「现在在哪」，用户想回上一页
// 也得让 Agent 去做。工具栏就是把这两件事交回给人。

describe('BrowserToolbar', () => {
  it('shows where the browser actually is', async () => {
    render(<BrowserToolbar sessionId="s1" takeover={true} connected={true} />)
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: '地址' })).toHaveValue('https://example.com/'),
    )
  })

  it('navigates to a typed address on Enter', async () => {
    render(<BrowserToolbar sessionId="s1" takeover={true} connected={true} />)
    const box = await screen.findByRole('textbox', { name: '地址' })
    fireEvent.change(box, { target: { value: 'https://other.example/page' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() =>
      expect(appMocks.BrowserNavigate).toHaveBeenCalledWith('s1', 'https://other.example/page', ''),
    )
  })

  it('sends back/forward/reload as actions, not as urls', async () => {
    render(<BrowserToolbar sessionId="s1" takeover={true} connected={true} />)
    fireEvent.click(await screen.findByRole('button', { name: '后退' }))
    fireEvent.click(screen.getByRole('button', { name: '前进' }))
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(appMocks.BrowserNavigate).toHaveBeenCalledTimes(3))
    expect(appMocks.BrowserNavigate.mock.calls.map((c) => c[2])).toEqual(['back', 'forward', 'reload'])
  })

  // 后端只在接管中允许人工导航。禁用而不是让它 409：一个点了就报错的按钮，比一个
  // 明确不可点的按钮更难理解。
  it('disables the controls when nobody has taken over', async () => {
    render(<BrowserToolbar sessionId="s1" takeover={false} connected={true} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新' })).toBeDisabled())
    expect(screen.getByRole('textbox', { name: '地址' })).toBeDisabled()
  })

  // 走查里记过的教训：客户端错误必须看得见，并且在下一次刷新时被清掉——否则一条
  // 过期的红字会一直遮住服务端的真实状态。
  it('shows a refusal instead of swallowing it, and clears it on the next try', async () => {
    appMocks.BrowserNavigate.mockRejectedValueOnce(new Error('409 TAKEOVER_REQUIRED'))
    render(<BrowserToolbar sessionId="s1" takeover={true} connected={true} />)
    fireEvent.click(await screen.findByRole('button', { name: '刷新' }))
    expect(await screen.findByText(/TAKEOVER_REQUIRED/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(screen.queryByText(/TAKEOVER_REQUIRED/)).toBeNull())
  })

  it('reports a session that has gone to sleep rather than calling it disconnected', async () => {
    appMocks.BrowserSessionInfo.mockResolvedValue(
      JSON.stringify({ session_id: 's1', url: 'https://example.com/', takeover: false, has_page: false }),
    )
    render(<BrowserToolbar sessionId="s1" takeover={false} connected={true} />)
    expect(await screen.findByText(/已休眠/)).toBeInTheDocument()
  })
})
