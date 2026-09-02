import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TrajectoryTurn } from './TrajectoryTurn'

describe('TrajectoryTurn', () => {
  it('左侧显示 Turn N 标记，并渲染组内每一条事件', () => {
    render(
      <TrajectoryTurn
        group={{
          turn: 2,
          events: [
            { seq: 10, type: 'user/message', time: 't', data: { turn: 2, content: '问题' } },
            { seq: 11, type: 'assistant/message', time: 't', data: { turn: 2, content: '回答' } },
          ],
        }}
        sessionID="sess-1"
      />,
    )
    expect(screen.getByText(/Turn 2/)).toBeInTheDocument()
    expect(screen.getByText(/问题/)).toBeInTheDocument()
    expect(screen.getByText(/回答/)).toBeInTheDocument()
  })

  // store 把缺 turn 字段的事件归到 -1 组（数据损坏而不是可选）。这一组必须显式
  // 说明它坏在哪，不能显示成一个看着正常的 "Turn -1"。
  it('turn 为 -1 的分组显式说明这些事件缺 turn 字段', () => {
    render(
      <TrajectoryTurn
        group={{ turn: -1, events: [{ seq: 3, type: 'user/message', time: 't', data: { content: '孤儿' } }] }}
        sessionID="sess-1"
      />,
    )
    expect(screen.getByText(/缺少 turn/)).toBeInTheDocument()
    expect(screen.getByText(/孤儿/)).toBeInTheDocument()
  })
})
