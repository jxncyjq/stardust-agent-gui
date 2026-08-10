import { describe, it, expect, vi, beforeEach } from 'vitest'

const appMocks = vi.hoisted(() => ({ GetBrowserEndpoint: vi.fn() }))
vi.mock('../../wailsjs/go/main/App', () => appMocks)

import { fetchPreview } from './fetchPreview'

describe('fetchPreview', () => {
  beforeEach(() => {
    appMocks.GetBrowserEndpoint.mockReset()
    appMocks.GetBrowserEndpoint.mockResolvedValue({ baseURL: 'http://127.0.0.1:9000', token: 'tok' })
    vi.stubGlobal('fetch', vi.fn())
  })

  it('resolves relative url against baseURL and sends bearer token', async () => {
    ;(fetch as any).mockResolvedValue(new Response('<h1>hi</h1>', { headers: { 'Content-Type': 'text/html' } }))
    const src = await fetchPreview({ path: 'a.html', url: '/v1/files?x', downloadUrl: '', name: 'a.html' })
    expect((fetch as any).mock.calls[0][0]).toBe('http://127.0.0.1:9000/v1/files?x')
    expect((fetch as any).mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
    expect(src).toEqual({ kind: 'html', html: '<h1>hi</h1>', title: 'a.html', sourceUrl: '/v1/files?x' })
  })

  it('builds markdown source for .md', async () => {
    ;(fetch as any).mockResolvedValue(new Response('# t', { headers: { 'Content-Type': 'text/markdown' } }))
    const src = await fetchPreview({ path: 'd.md', url: '/v1/files?y', downloadUrl: '', name: 'd.md' })
    expect(src.kind).toBe('markdown')
  })

  it('builds code source for .ts', async () => {
    ;(fetch as any).mockResolvedValue(new Response('const x=1', { headers: { 'Content-Type': 'text/plain' } }))
    const src = await fetchPreview({ path: 'a.ts', url: '/v1/files?z', downloadUrl: '', name: 'a.ts' })
    expect(src.kind).toBe('code')
  })

  it('throws on non-ok response', async () => {
    ;(fetch as any).mockResolvedValue(new Response('nope', { status: 404 }))
    await expect(fetchPreview({ path: 'a.html', url: '/v1/files?x', downloadUrl: '', name: 'a.html' })).rejects.toThrow()
  })
})
