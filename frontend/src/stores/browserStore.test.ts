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

describe('browserStore takeover', () => {
  beforeEach(() => useBrowserStore.getState().reset())
  it('defaults to false', () => {
    expect(useBrowserStore.getState().takeover).toBe(false)
  })
  it('setTakeover toggles', () => {
    useBrowserStore.getState().setTakeover(true)
    expect(useBrowserStore.getState().takeover).toBe(true)
  })
  it('clears takeover when session cleared', () => {
    useBrowserStore.getState().setSession('sess-1')
    useBrowserStore.getState().setTakeover(true)
    useBrowserStore.getState().setSession(null)
    expect(useBrowserStore.getState().takeover).toBe(false)
  })
})
