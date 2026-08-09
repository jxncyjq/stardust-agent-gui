import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageBubble } from './MessageBubble'
import { usePreviewStore } from '../stores/previewStore'

const runtimeMocks = vi.hoisted(() => ({ BrowserOpenURL: vi.fn() }))
vi.mock('../../wailsjs/runtime/runtime', () => runtimeMocks)

describe('MessageBubble agent label', () => {
  // The answering agent is chosen per submission, so it is labelled on the
  // message rather than on the session (the sidebar no longer groups by agent).
  it('labels an assistant reply with the agent that produced it', () => {
    render(<MessageBubble message={{ id: 'a1', role: 'assistant', content: 'hi', agent: 'researcher' }} />)

    expect(screen.getByText('researcher')).toBeInTheDocument()
  })

  // History predating the field carries no agent; inventing a default would
  // claim something untrue about who answered.
  it('omits the label when the message carries no agent', () => {
    render(<MessageBubble message={{ id: 'a2', role: 'assistant', content: 'hi' }} />)

    expect(screen.queryByText('researcher')).not.toBeInTheDocument()
    expect(screen.queryByText('default-agent')).not.toBeInTheDocument()
  })

  it('does not label user messages with an agent', () => {
    render(<MessageBubble message={{ id: 'u1', role: 'user', content: 'ask', agent: 'researcher' }} />)

    expect(screen.queryByText('researcher')).not.toBeInTheDocument()
  })
})

describe('MessageBubble copy affordance', () => {
  // Regression: the whole action bar was gated on isAssistant, so a prompt could
  // not be copied — re-sending a tweaked prompt is a routine action.
  it('offers copy on a user message', () => {
    render(<MessageBubble message={{ id: 'u1', role: 'user', content: 'ask' }} />)

    expect(screen.getByRole('button', { name: '复制消息' })).toBeInTheDocument()
  })

  it('still offers copy on an assistant message', () => {
    render(<MessageBubble message={{ id: 'a1', role: 'assistant', content: 'hi' }} />)

    expect(screen.getByRole('button', { name: '复制消息' })).toBeInTheDocument()
  })

  // Downloading a prompt as Markdown has no use; only replies get that action.
  it('does not offer download on a user message', () => {
    render(<MessageBubble message={{ id: 'u1', role: 'user', content: 'ask' }} />)

    expect(screen.queryByRole('button', { name: '下载为 Markdown' })).not.toBeInTheDocument()
  })
})

describe('MessageBubble code highlighting', () => {
  // A fenced code block must render Shiki's tokenised output, not react-markdown's
  // bare <pre>. Shiki emits <pre class="shiki ..."> with per-token colored spans.
  it('highlights a fenced code block with Shiki', () => {
    const md = '```ts\nconst x: number = 1\n```'
    const { container } = render(
      <MessageBubble message={{ id: 'a1', role: 'assistant', content: md }} />
    )
    const pre = container.querySelector('pre.shiki')
    expect(pre).not.toBeNull()
    // Tokenisation produced inline-styled color spans (not one flat text node).
    expect(pre!.querySelectorAll('span[style*="color"]').length).toBeGreaterThan(0)
  })

  it('leaves plain prose untouched (no shiki wrapper on non-code)', () => {
    const { container } = render(
      <MessageBubble message={{ id: 'a2', role: 'assistant', content: 'hello **world**' }} />
    )
    expect(container.querySelector('pre.shiki')).toBeNull()
    expect(container.querySelector('strong')?.textContent).toBe('world')
  })
})

describe('MessageBubble image attachments', () => {
  it('renders attached images of a user message', () => {
    const imgs = ['data:image/png;base64,AAA', 'data:image/png;base64,BBB']
    render(<MessageBubble message={{ id: 'u1', role: 'user', content: '看这个', images: imgs }} />)
    const rendered = screen.getAllByRole('img')
    expect(rendered).toHaveLength(2)
    expect(rendered.map((el) => el.getAttribute('src'))).toEqual(imgs)
  })

  it('renders no img when a message has no images', () => {
    render(<MessageBubble message={{ id: 'u2', role: 'user', content: 'hi' }} />)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('still shows the text content alongside images', () => {
    render(<MessageBubble message={{ id: 'u3', role: 'user', content: '看这个', images: ['data:image/png;base64,AAA'] }} />)
    expect(screen.getByText('看这个')).toBeInTheDocument()
  })
})

describe('MessageBubble link routing', () => {
  it('routes http links to the system browser instead of navigating', () => {
    runtimeMocks.BrowserOpenURL.mockClear()
    render(<MessageBubble message={{ id: 'a1', role: 'assistant', content: '看 [这里](https://example.com)' }} />)
    fireEvent.click(screen.getByText('这里'))
    expect(runtimeMocks.BrowserOpenURL).toHaveBeenCalledWith('https://example.com')
  })
})

describe('MessageBubble html preview button', () => {
  beforeEach(() => usePreviewStore.getState().close())

  it('offers a preview button for a fenced html block and opens it', () => {
    const md = '前言\n```html\n<h1>Hi</h1>\n```\n'
    render(<MessageBubble message={{ id: 'a2', role: 'assistant', content: md }} />)
    fireEvent.click(screen.getByRole('button', { name: '预览 HTML' }))
    const src = usePreviewStore.getState().source
    expect(src?.kind).toBe('html')
    expect(src?.html).toContain('<h1>Hi</h1>')
  })

  it('shows no preview button when there is no html block', () => {
    render(<MessageBubble message={{ id: 'a3', role: 'assistant', content: '```ts\nconst x=1\n```' }} />)
    expect(screen.queryByRole('button', { name: '预览 HTML' })).toBeNull()
  })
})
