import { describe, it, expect, beforeEach } from 'vitest'
import { getEditorTemplate, setEditorTemplate } from './editorTemplate'

describe('editorTemplate', () => {
  beforeEach(() => localStorage.clear())
  it('returns empty string when unset', () => {
    expect(getEditorTemplate()).toBe('')
  })
  it('persists and reads back', () => {
    setEditorTemplate('code "{path}"')
    expect(getEditorTemplate()).toBe('code "{path}"')
  })
})
