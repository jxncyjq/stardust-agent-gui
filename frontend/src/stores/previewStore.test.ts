import { describe, it, expect, beforeEach } from 'vitest'
import { usePreviewStore } from './previewStore'

describe('previewStore', () => {
  beforeEach(() => usePreviewStore.getState().close())

  it('starts empty', () => {
    expect(usePreviewStore.getState().source).toBeNull()
  })

  it('open sets the source', () => {
    usePreviewStore.getState().open({ kind: 'html', html: '<h1>hi</h1>', title: 'T' })
    const s = usePreviewStore.getState().source
    expect(s).toEqual({ kind: 'html', html: '<h1>hi</h1>', title: 'T' })
  })

  it('close clears the source', () => {
    usePreviewStore.getState().open({ kind: 'html', html: '<h1>hi</h1>' })
    usePreviewStore.getState().close()
    expect(usePreviewStore.getState().source).toBeNull()
  })
})
