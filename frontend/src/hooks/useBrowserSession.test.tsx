import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBrowserStore } from '../stores/browserStore'

// 用可控的 EventsOn 派发桩
const handlers: Record<string, (p: unknown) => void> = {}
vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: (ch: string, h: (p: unknown) => void) => { handlers[ch] = h; return () => {} },
  EventsOff: () => {},
}))

import { useBrowserSession } from './useBrowserSession'

describe('useBrowserSession', () => {
  beforeEach(() => useBrowserStore.getState().reset())

  it('sets sessionId on session_opened, clears on session_closed', () => {
    renderHook(() => useBrowserSession())
    handlers['browser:session']({ type: 'browser:session_opened', data: '{"session_id":"sess-7"}' })
    expect(useBrowserStore.getState().sessionId).toBe('sess-7')
    handlers['browser:session']({ type: 'browser:session_closed', data: '{"session_id":"sess-7"}' })
    expect(useBrowserStore.getState().sessionId).toBeNull()
  })
})
