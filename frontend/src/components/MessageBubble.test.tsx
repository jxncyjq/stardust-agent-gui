import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MessageBubble } from './MessageBubble'

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
