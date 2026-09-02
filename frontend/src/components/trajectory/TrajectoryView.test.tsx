import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 组件测试不碰真网络也不需要 Wails runtime：取数（GetSessionEvents）与「查看全文」
// （FetchPreviewFile，TrajectoryCell 用）都 mock 掉。两个都得列出来——vi.mock 的工厂
// 决定了这个模块有哪些具名导出，漏一个就是 import 期报错。
const mocks = vi.hoisted(() => ({
  GetSessionEvents: vi.fn(),
  FetchPreviewFile: vi.fn(),
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}))
vi.mock('../../../wailsjs/go/main/App', () => ({
  GetSessionEvents: mocks.GetSessionEvents,
  FetchPreviewFile: mocks.FetchPreviewFile,
}))
vi.mock('../../../wailsjs/runtime/runtime', () => ({
  EventsOn: mocks.EventsOn,
  EventsOff: mocks.EventsOff,
}))

import { TrajectoryView } from './TrajectoryView'
import { useTrajectoryStore } from '../../stores/trajectoryStore'

const T = '2026-09-02T00:00:0'

beforeEach(() => {
  vi.clearAllMocks()
  useTrajectoryStore.getState().reset()
  // tool/call 的 arguments 是 TrajectoryCell 的必给字段（空串合法、缺席是坏数据），
  // 所以夹具带上它——否则这一行渲染成 BAD 而不是工具名，测的就不是轨迹了。
  mocks.GetSessionEvents.mockResolvedValue({
    events: [
      { seq: 0, type: 'turn/start', time: `${T}0Z`, data: { turn: 0 } },
      { seq: 1, type: 'user/message', time: `${T}1Z`, data: { turn: 0, content: '读一下 notes.md' } },
      {
        seq: 2,
        type: 'tool/call',
        time: `${T}2Z`,
        data: { turn: 0, name: 'read_file', call_id: 'c1', arguments: '{"path":"notes.md"}' },
      },
    ],
    next_seq: 3,
  })
})

describe('TrajectoryView', () => {
  it('挂载后把事件铺成轨迹', async () => {
    render(<TrajectoryView sessionID="sess-1" />)
    await waitFor(() => expect(screen.getByText(/Turn 0/)).toBeInTheDocument())
    expect(screen.getByText(/读一下 notes\.md/)).toBeInTheDocument()
    expect(screen.getByText(/read_file/)).toBeInTheDocument()
  })

  // 搜索在**已加载的事件**里做（spec §7），不发新请求——
  // 用户搜的是「我刚看到的这些」。
  it('搜索只过滤已加载的事件，不发新请求', async () => {
    render(<TrajectoryView sessionID="sess-1" />)
    await waitFor(() => expect(screen.getByText(/read_file/)).toBeInTheDocument())

    mocks.GetSessionEvents.mockClear()
    await userEvent.type(screen.getByRole('searchbox'), 'read_file')

    await waitFor(() => expect(screen.queryByText(/读一下 notes\.md/)).not.toBeInTheDocument())
    expect(screen.getByText(/read_file/)).toBeInTheDocument()
    expect(mocks.GetSessionEvents).not.toHaveBeenCalled()
  })

  // 过滤后仍按 turn 分组：拍平成一个列表会丢掉「这一条属于哪一轮」，而那正是
  // 轨迹视图存在的理由。
  it('过滤后仍按 turn 分组，不把命中的事件拍平', async () => {
    mocks.GetSessionEvents.mockResolvedValue({
      events: [
        { seq: 0, type: 'user/message', time: `${T}0Z`, data: { turn: 0, content: '第一轮的问题' } },
        { seq: 1, type: 'user/message', time: `${T}1Z`, data: { turn: 1, content: '第二轮 grep 一下' } },
        { seq: 2, type: 'tool/call', time: `${T}2Z`, data: { turn: 1, name: 'grep', arguments: '' } },
      ],
      next_seq: 3,
    })
    render(<TrajectoryView sessionID="sess-1" />)
    await waitFor(() => expect(screen.getByText(/第一轮的问题/)).toBeInTheDocument())

    await userEvent.type(screen.getByRole('searchbox'), 'grep')

    await waitFor(() => expect(screen.queryByText(/第一轮的问题/)).not.toBeInTheDocument())
    expect(screen.getByText('Turn 1')).toBeInTheDocument()
    expect(screen.queryByText('Turn 0')).not.toBeInTheDocument()
  })

  // 一条都没匹配上不是「这条会话还没有轨迹」——那是 TrajectoryTable 的空态文案，
  // 用在这里等于把「搜不到」说成「没有」。
  it('搜不到时说的是搜不到，不是这条会话没有轨迹', async () => {
    render(<TrajectoryView sessionID="sess-1" />)
    await waitFor(() => expect(screen.getByText(/read_file/)).toBeInTheDocument())

    await userEvent.type(screen.getByRole('searchbox'), 'zzz-不存在')

    await waitFor(() => expect(screen.getByText(/没有匹配/)).toBeInTheDocument())
    expect(screen.queryByText(/还没有轨迹/)).not.toBeInTheDocument()
  })

  it('没有选中会话时说明要先选一个', () => {
    render(<TrajectoryView sessionID={null} />)
    expect(screen.getByText(/选择|先选/)).toBeInTheDocument()
    expect(mocks.GetSessionEvents).not.toHaveBeenCalled()
  })
})
