import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkspaceStore } from './workspaceStore'

describe('workspaceStore', () => {
  beforeEach(() => useWorkspaceStore.getState().reset())
  it('sets root and clears on reset', () => {
    useWorkspaceStore.getState().setRoot('/w')
    expect(useWorkspaceStore.getState().rootDir).toBe('/w')
    useWorkspaceStore.getState().reset()
    expect(useWorkspaceStore.getState().rootDir).toBe('')
  })
  it('toggles a directory expanded state', () => {
    useWorkspaceStore.getState().toggleExpanded('sub')
    expect(useWorkspaceStore.getState().expanded.has('sub')).toBe(true)
    useWorkspaceStore.getState().toggleExpanded('sub')
    expect(useWorkspaceStore.getState().expanded.has('sub')).toBe(false)
  })
  it('sets filter and maximized', () => {
    useWorkspaceStore.getState().setFilter('abc')
    expect(useWorkspaceStore.getState().filter).toBe('abc')
    useWorkspaceStore.getState().setMaximized(true)
    expect(useWorkspaceStore.getState().maximized).toBe(true)
  })
})
