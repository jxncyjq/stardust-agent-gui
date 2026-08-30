import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const appMocks = vi.hoisted(() => ({ BrowserSessions: vi.fn() }))
vi.mock('../../wailsjs/go/main/App', () => appMocks)

import { BrowserTabs } from './BrowserTabs'

const twoSessions = JSON.stringify({
  sessions: [
    { session_id: 'sess-1', url: 'https://first.example/page', takeover: false, has_page: true },
    { session_id: 'sess-2', url: 'https://second.example/', takeover: true, has_page: false },
  ],
})

beforeEach(() => {
  appMocks.BrowserSessions.mockReset()
  appMocks.BrowserSessions.mockResolvedValue(twoSessions)
})

// Agent 在一个对话里可能开过好几个浏览器会话（查完 A 站再查 B 站），而此前**除了
// 最后那个，其余都没有入口**：视图只认 SSE 报的最后一个 id，用户看不见也回不去。

describe('BrowserTabs', () => {
  it('shows one tab per session, labelled by where it is', async () => {
    render(<BrowserTabs chatSessionId="chat-A" activeSessionId="sess-1" onSelect={() => {}} />)

    expect(await screen.findByRole('tab', { name: /first\.example/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /second\.example/ })).toBeInTheDocument()
  })

  it('marks which tab is showing', async () => {
    render(<BrowserTabs chatSessionId="chat-A" activeSessionId="sess-2" onSelect={() => {}} />)

    const active = await screen.findByRole('tab', { name: /second\.example/ })
    expect(active).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /first\.example/ })).toHaveAttribute('aria-selected', 'false')
  })

  it('hands the clicked session back to the view', async () => {
    const onSelect = vi.fn()
    render(<BrowserTabs chatSessionId="chat-A" activeSessionId="sess-1" onSelect={onSelect} />)

    fireEvent.click(await screen.findByRole('tab', { name: /second\.example/ }))
    expect(onSelect).toHaveBeenCalledWith('sess-2')
  })

  // 只问当前对话：把别的对话的会话摆进标签条，用户点进去的是一个与眼前工作无关的
  // 页面。
  it('asks only for this conversation', async () => {
    render(<BrowserTabs chatSessionId="chat-A" activeSessionId={null} onSelect={() => {}} />)
    await waitFor(() => expect(appMocks.BrowserSessions).toHaveBeenCalledWith('chat-A'))
  })

  // 一个会话都没有是最常见的状态（Agent 还没浏览过任何东西）。此时标签条应当消失，
  // 而不是留一条空条占着位置。
  it('renders nothing when there are no sessions', async () => {
    appMocks.BrowserSessions.mockResolvedValue(JSON.stringify({ sessions: [] }))
    const { container } = render(
      <BrowserTabs chatSessionId="chat-A" activeSessionId={null} onSelect={() => {}} />,
    )
    await waitFor(() => expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0))
  })

  // 单个会话也不显示标签条：一个标签的标签条只是噪声，地址栏已经说明了在哪。
  it('stays out of the way when there is only one session', async () => {
    appMocks.BrowserSessions.mockResolvedValue(
      JSON.stringify({ sessions: [{ session_id: 'sess-1', url: 'https://only.example/', takeover: false, has_page: true }] }),
    )
    const { container } = render(
      <BrowserTabs chatSessionId="chat-A" activeSessionId="sess-1" onSelect={() => {}} />,
    )
    await waitFor(() => expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0))
  })

  it('says so when the list cannot be read, instead of showing nothing', async () => {
    appMocks.BrowserSessions.mockRejectedValue(new Error('serve unreachable'))
    render(<BrowserTabs chatSessionId="chat-A" activeSessionId={null} onSelect={() => {}} />)

    expect(await screen.findByText(/serve unreachable/)).toBeInTheDocument()
  })
})
