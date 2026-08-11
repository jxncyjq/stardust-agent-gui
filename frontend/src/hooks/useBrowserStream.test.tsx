import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBrowserStore } from '../stores/browserStore'

// Controllable EventsOn stub: capture each channel's handler so the test can
// dispatch Wails events synchronously.
const handlers: Record<string, (p: unknown) => void> = {}
vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: (ch: string, h: (p: unknown) => void) => {
    handlers[ch] = h
    return () => {}
  },
  EventsOff: (ch: string) => {
    delete handlers[ch]
  },
}))

import { useBrowserStream } from './useBrowserStream'

describe('useBrowserStream', () => {
  beforeEach(() => useBrowserStore.getState().reset())

  it('writes frame/observation/progress/connected for the matching session', () => {
    renderHook(() => useBrowserStream('sess-1'))

    handlers['browser:stream']({ session_id: 'sess-1', connected: true })
    expect(useBrowserStore.getState().connected).toBe(true)

    handlers['browser:frame']({ session_id: 'sess-1', data: '{"mime":"image/jpeg","b64":"AAAA"}' })
    expect(useBrowserStore.getState().frameDataUri).toBe('data:image/jpeg;base64,AAAA')

    handlers['browser:observation']({
      session_id: 'sess-1',
      data: '{"elements":[{"ref":"e1","role":"button","name":"Go"}],"text":"hi"}',
    })
    expect(useBrowserStore.getState().elements).toHaveLength(1)
    expect(useBrowserStore.getState().observationText).toBe('hi')

    handlers['browser:progress']({ session_id: 'sess-1', data: '{"action":"open","status":"done"}' })
    expect(useBrowserStore.getState().progress).toEqual({ action: 'open', status: 'done' })
  })

  it('ignores events for a different session', () => {
    renderHook(() => useBrowserStream('sess-1'))
    handlers['browser:frame']({ session_id: 'sess-OTHER', data: '{"mime":"image/jpeg","b64":"BBBB"}' })
    expect(useBrowserStore.getState().frameDataUri).toBeNull()
    handlers['browser:stream']({ session_id: 'sess-OTHER', connected: true })
    expect(useBrowserStore.getState().connected).toBe(false)
  })

  it('does not subscribe when sessionId is null', () => {
    renderHook(() => useBrowserStream(null))
    expect(handlers['browser:frame']).toBeUndefined()
  })
})
