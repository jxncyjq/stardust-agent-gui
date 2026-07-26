import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

// Mock react-markdown so we can count how many times the (expensive) markdown
// render runs. Without memo, re-rendering the parent re-runs it every time even
// when the message object is unchanged.
const markdownRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('react-markdown', () => ({
  default: (props: any) => {
    markdownRenders.count++
    return <div data-testid="md">{props.children}</div>
  },
}))
vi.mock('../lib/highlighter', () => ({ rehypeShikiPlugin: [] }))

import { MessageBubble } from './MessageBubble'

beforeEach(() => {
  markdownRenders.count = 0
})

describe('MessageBubble memoization (A4)', () => {
  it('does not re-run markdown when re-rendered with the same message object', () => {
    const msg = { id: 'a1', role: 'assistant' as const, content: '# hi' }
    const { rerender } = render(<MessageBubble message={msg} />)
    expect(markdownRenders.count).toBe(1)
    // Same object reference → memo must bail out, markdown not re-run.
    rerender(<MessageBubble message={msg} />)
    expect(markdownRenders.count).toBe(1)
  })

  it('does re-run markdown when the message object changes', () => {
    const { rerender } = render(<MessageBubble message={{ id: 'a1', role: 'assistant', content: 'one' }} />)
    expect(markdownRenders.count).toBe(1)
    rerender(<MessageBubble message={{ id: 'a1', role: 'assistant', content: 'two' }} />)
    expect(markdownRenders.count).toBe(2)
  })
})
