import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TrajectoryToolbar } from './TrajectoryToolbar'

const events = [
  { seq: 0, type: 'turn/start', time: '2026-09-02T00:00:00Z', data: { turn: 0 } },
  { seq: 1, type: 'user/message', time: '2026-09-02T00:00:01Z', data: { turn: 0, content: 'x' } },
  { seq: 2, type: 'tool/call', time: '2026-09-02T00:00:02Z', data: { turn: 0, name: 'read_file', call_id: 'c1' } },
  { seq: 3, type: 'tool/call', time: '2026-09-02T00:00:03Z', data: { turn: 0, name: 'write_file', call_id: 'c2' } },
  { seq: 4, type: 'turn/end', time: '2026-09-02T00:00:10Z', data: { turn: 0, reason: 'completed' } },
]

describe('TrajectoryToolbar', () => {
  it('统计 Turns 与 Calls', () => {
    render(<TrajectoryToolbar events={events} turnCount={1} query="" onQueryChange={() => {}} />)
    expect(screen.getByText(/Turns/)).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText(/Calls/)).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('Duration 用首尾事件的时间差', () => {
    render(<TrajectoryToolbar events={events} turnCount={1} query="" onQueryChange={() => {}} />)
    // 首 00:00:00 尾 00:00:10 → 10 秒
    expect(screen.getByText(/10/)).toBeInTheDocument()
  })

  it('搜索框把输入交给调用方', async () => {
    const onQueryChange = vi.fn()
    render(<TrajectoryToolbar events={events} turnCount={1} query="" onQueryChange={onQueryChange} />)
    await userEvent.type(screen.getByRole('searchbox'), 'read')
    expect(onQueryChange).toHaveBeenCalled()
  })

  it('没有事件时 Duration 显示占位而不是 NaN', () => {
    render(<TrajectoryToolbar events={[]} turnCount={0} query="" onQueryChange={() => {}} />)
    expect(screen.queryByText(/NaN/)).toBeNull()
    expect(screen.getByTestId('trajectory-duration').textContent).toBe('—')
  })

  // time 是端点契约里的必给字段，解析不出来是坏数据——不许悄悄显示成 0 秒。
  it('时间戳解析不出来时显式标出，而不是显示 0', () => {
    const bad = [
      { seq: 0, type: 'turn/start', time: '不是时间', data: { turn: 0 } },
      { seq: 1, type: 'turn/end', time: '也不是', data: { turn: 0 } },
    ]
    render(<TrajectoryToolbar events={bad} turnCount={1} query="" onQueryChange={() => {}} />)
    expect(screen.getByTestId('trajectory-duration').textContent).toMatch(/时间戳无效/)
  })
})
