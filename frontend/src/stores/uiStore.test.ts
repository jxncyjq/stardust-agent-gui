import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from './uiStore'

describe('uiStore rightView', () => {
  beforeEach(() => useUIStore.getState().setRightView('status'))

  it('defaults to status', () => {
    expect(useUIStore.getState().rightView).toBe('status')
  })

  it('setRightView switches the active right column view', () => {
    useUIStore.getState().setRightView('preview')
    expect(useUIStore.getState().rightView).toBe('preview')
  })
})
