import { describe, it, expect } from 'vitest'
import { mapGeneratedFiles, isPreviewable } from './generatedFiles'

describe('mapGeneratedFiles', () => {
  it('maps backend snake_case to GeneratedFile', () => {
    const out = mapGeneratedFiles([{ path: 'a/b.html', url: '/v1/files?x', download_url: '/v1/files?x&download=1', name: 'b.html' }])
    expect(out).toEqual([{ path: 'a/b.html', url: '/v1/files?x', downloadUrl: '/v1/files?x&download=1', name: 'b.html' }])
  })
  it('returns [] for missing/nonarray', () => {
    expect(mapGeneratedFiles(undefined)).toEqual([])
    expect(mapGeneratedFiles(null)).toEqual([])
    expect(mapGeneratedFiles('x')).toEqual([])
  })
})

describe('isPreviewable', () => {
  it('true for html/md/text/code/image', () => {
    for (const n of ['a.html','a.md','a.txt','a.ts','a.png','a.svg']) expect(isPreviewable(n)).toBe(true)
  })
  it('false for office/binary', () => {
    for (const n of ['a.docx','a.xlsx','a.pptx','a.pdf','a.zip']) expect(isPreviewable(n)).toBe(false)
  })
})
