import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TrajectoryTable } from './TrajectoryTable'

describe('TrajectoryTable', () => {
  it('按顺序渲染每个 turn 分组', () => {
    render(
      <TrajectoryTable
        turns={[
          { turn: 0, events: [{ seq: 0, type: 'user/message', time: 't', data: { turn: 0, content: '第一' } }] },
          { turn: 1, events: [{ seq: 1, type: 'user/message', time: 't', data: { turn: 1, content: '第二' } }] },
        ]}
        sessionID="sess-1"
      />,
    )
    expect(screen.getByText(/Turn 0/)).toBeInTheDocument()
    expect(screen.getByText(/Turn 1/)).toBeInTheDocument()
  })

  it('没有事件时说明这条会话还没有轨迹，而不是空白', () => {
    render(<TrajectoryTable turns={[]} sessionID="sess-1" />)
    expect(screen.getByText(/还没有/)).toBeInTheDocument()
  })

  it('分组顺序照 props 给的顺序渲染', () => {
    const { container } = render(
      <TrajectoryTable
        turns={[
          { turn: 0, events: [{ seq: 0, type: 'user/message', time: 't', data: { turn: 0, content: 'a' } }] },
          { turn: 1, events: [{ seq: 1, type: 'user/message', time: 't', data: { turn: 1, content: 'b' } }] },
          { turn: 2, events: [{ seq: 2, type: 'user/message', time: 't', data: { turn: 2, content: 'c' } }] },
        ]}
        sessionID="sess-1"
      />,
    )
    const labels = [...container.querySelectorAll('[data-turn-label]')].map((n) => n.textContent)
    expect(labels).toEqual(['Turn 0', 'Turn 1', 'Turn 2'])
  })
})
