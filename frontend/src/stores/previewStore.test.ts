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

  it('holds a code source', () => {
    usePreviewStore.getState().open({ kind: 'code', text: 'const x=1', lang: 'ts', title: 'a.ts', path: '/w/a.ts' })
    const s = usePreviewStore.getState().source
    expect(s).toEqual({ kind: 'code', text: 'const x=1', lang: 'ts', title: 'a.ts', path: '/w/a.ts' })
  })

  it('holds an image source', () => {
    usePreviewStore.getState().open({ kind: 'image', dataUri: 'data:image/png;base64,AAA', path: '/w/i.png' })
    expect(usePreviewStore.getState().source?.kind).toBe('image')
  })
})
