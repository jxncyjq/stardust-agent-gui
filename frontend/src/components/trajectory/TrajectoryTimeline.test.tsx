import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TrajectoryTimeline } from './TrajectoryTimeline'

describe('TrajectoryTimeline', () => {
  it('渲染 Input / Model / Tools 三条密度带', () => {
    render(
      <TrajectoryTimeline
        events={[
          { seq: 0, type: 'user/message', time: 't', data: { turn: 0 } },
          { seq: 1, type: 'assistant/message', time: 't', data: { turn: 0 } },
          { seq: 2, type: 'tool/call', time: 't', data: { turn: 0, name: 'read_file' } },
        ]}
      />,
    )
    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.getByText('Tools')).toBeInTheDocument()
  })

  it('每条带子的刻度数反映该类事件的条数', () => {
    const { container } = render(
      <TrajectoryTimeline
        events={[
          { seq: 0, type: 'tool/call', time: 't', data: { turn: 0 } },
          { seq: 1, type: 'tool/call', time: 't', data: { turn: 0 } },
          { seq: 2, type: 'tool/call', time: 't', data: { turn: 0 } },
        ]}
      />,
    )
    expect(container.querySelectorAll('[data-band="tools"] [data-tick]')).toHaveLength(3)
  })

  it('三条带子各按自己的事件类型计数，互不串台', () => {
    const { container } = render(
      <TrajectoryTimeline
        events={[
          { seq: 0, type: 'user/message', time: 't', data: { turn: 0 } },
          { seq: 1, type: 'assistant/message', time: 't', data: { turn: 0 } },
          { seq: 2, type: 'assistant/message', time: 't', data: { turn: 0 } },
          { seq: 3, type: 'tool/call', time: 't', data: { turn: 0 } },
          { seq: 4, type: 'tool/result', time: 't', data: { turn: 0 } },
          { seq: 5, type: 'turn/start', time: 't', data: { turn: 0 } },
        ]}
      />,
    )
    expect(container.querySelectorAll('[data-band="input"] [data-tick]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-band="model"] [data-tick]')).toHaveLength(2)
    // Tools 带同时收 tool/call 与 tool/result；turn/start 三条带子都不收。
    expect(container.querySelectorAll('[data-band="tools"] [data-tick]')).toHaveLength(2)
  })
})
