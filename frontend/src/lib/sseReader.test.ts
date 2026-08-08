import { describe, it, expect, vi } from 'vitest'
import { readSSE } from './sseReader'

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(ctrl) {
      if (i < chunks.length) ctrl.enqueue(enc.encode(chunks[i++]))
      else ctrl.close()
    },
  })
}

describe('readSSE', () => {
  it('parses events across chunk boundaries and sends bearer', async () => {
    const events: { event: string; id?: string; data: string }[] = []
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok')
      return { ok: true, status: 200, body: streamFrom(['event: frame\nid: 1\nda', 'ta: {"b":1}\n\nevent: progress\ndata: {}\n\n']) } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    await readSSE('http://x/stream', 'tok', 0, (e) => events.push(e), new AbortController().signal)

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ event: 'frame', id: '1', data: '{"b":1}' })
    expect(events[1].event).toBe('progress')
  })

  it('sends Last-Event-ID when >0 and omits Authorization when token empty', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>
      expect(h['Last-Event-ID']).toBe('5')
      expect(h['Authorization']).toBeUndefined()
      return { ok: true, status: 200, body: streamFrom(['']) } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    await readSSE('http://x/stream', '', 5, () => {}, new AbortController().signal)
  })
})
