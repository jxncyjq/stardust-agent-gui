import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore } from './chatStore'

beforeEach(() => useChatStore.setState({ messages: [] }))

describe('chatStore updateMessage', () => {
  it('patches an existing message in place and leaves others untouched', () => {
    const { addMessage, updateMessage } = useChatStore.getState()
    addMessage({ id: 'a', role: 'assistant', content: 'streamed', streaming: true })
    addMessage({ id: 'b', role: 'user', content: 'q' })

    updateMessage('a', {
      content: 'final',
      streaming: false,
      meta: {
        elapsedSec: 3,
        promptTokens: 10,
        completionTokens: 5,
        cachedTokens: 2,
        totalTokens: 15,
      },
    })

    const [a, b] = useChatStore.getState().messages
    expect(a.content).toBe('final')
    expect(a.streaming).toBe(false)
    expect(a.meta?.totalTokens).toBe(15)
    // The untouched message is preserved exactly.
    expect(b).toEqual({ id: 'b', role: 'user', content: 'q' })
  })

  it('is a no-op when the id does not exist', () => {
    const { addMessage, updateMessage } = useChatStore.getState()
    addMessage({ id: 'a', role: 'assistant', content: 'x' })
    updateMessage('missing', { content: 'y' })
    expect(useChatStore.getState().messages).toEqual([{ id: 'a', role: 'assistant', content: 'x' }])
  })
})
