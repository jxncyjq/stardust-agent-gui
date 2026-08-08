import { describe, it, expect, beforeEach } from 'vitest'
import { useBrowserStore } from './browserStore'

describe('browserStore', () => {
  beforeEach(() => useBrowserStore.getState().reset())

  it('sets and clears session', () => {
    useBrowserStore.getState().setSession('sess-1')
    expect(useBrowserStore.getState().sessionId).toBe('sess-1')
    useBrowserStore.getState().setSession(null)
    expect(useBrowserStore.getState().sessionId).toBeNull()
    expect(useBrowserStore.getState().frameDataUri).toBeNull() // 清 session 重置帧
  })

  it('onFrame builds data uri', () => {
    useBrowserStore.getState().onFrame('image/jpeg', 'AAAA')
    expect(useBrowserStore.getState().frameDataUri).toBe('data:image/jpeg;base64,AAAA')
  })

  it('onObservation stores elements + text', () => {
    useBrowserStore.getState().onObservation({ elements: [{ ref: 'e1', role: 'button', name: '搜索' }], text: '[e1] <button> 搜索' })
    expect(useBrowserStore.getState().elements).toHaveLength(1)
    expect(useBrowserStore.getState().observationText).toContain('e1')
  })
})
