import { describe, it, expect, vi, beforeEach } from 'vitest'

const appMocks = vi.hoisted(() => ({ FetchPreviewFile: vi.fn() }))
vi.mock('../../wailsjs/go/main/App', () => appMocks)

import { fetchPreview } from './fetchPreview'

beforeEach(() => appMocks.FetchPreviewFile.mockReset())

const file = (name: string) => ({ path: name, url: '/v1/files?x', downloadUrl: '/v1/files?x&download=1', name })

it('calls FetchPreviewFile with sessionID + path', async () => {
  appMocks.FetchPreviewFile.mockResolvedValue({ kind: 'html', text: '<h1>hi</h1>', dataURI: '', lang: '' })
  await fetchPreview(file('a.html'), 's1')
  expect(appMocks.FetchPreviewFile).toHaveBeenCalledWith('s1', 'a.html')
})

it('maps html WorkspaceFile to an html PreviewSource', async () => {
  appMocks.FetchPreviewFile.mockResolvedValue({ kind: 'html', text: '<h1>hi</h1>', dataURI: '', lang: '' })
  const src = await fetchPreview(file('a.html'), 's1')
  expect(src).toEqual({ kind: 'html', html: '<h1>hi</h1>', title: 'a.html', sourceUrl: '/v1/files?x' })
})

it('maps markdown', async () => {
  appMocks.FetchPreviewFile.mockResolvedValue({ kind: 'markdown', text: '# t', dataURI: '', lang: '' })
  const src = await fetchPreview(file('d.md'), 's1')
  expect(src.kind).toBe('markdown')
})

it('maps code with lang', async () => {
  appMocks.FetchPreviewFile.mockResolvedValue({ kind: 'code', text: 'const x=1', dataURI: '', lang: 'typescript' })
  const src = await fetchPreview(file('a.ts'), 's1')
  expect(src).toEqual({ kind: 'code', text: 'const x=1', lang: 'typescript', title: 'a.ts', path: 'a.ts' })
})

it('maps image dataURI', async () => {
  appMocks.FetchPreviewFile.mockResolvedValue({ kind: 'image', text: '', dataURI: 'data:image/png;base64,AAA', lang: '' })
  const src = await fetchPreview(file('i.png'), 's1')
  expect(src).toEqual({ kind: 'image', dataUri: 'data:image/png;base64,AAA', title: 'i.png', path: 'i.png' })
})

// Error propagation is intentionally not swallowed: fetchPreview is a bare
// `await FetchPreviewFile(...)` + mapping, so a Go-side error (non-2xx / read
// failure — asserted in app_workspace_test.go) rejects straight through to the
// caller, which surfaces it (FileCard's handlePreview .catch(console.error)).
