import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mapToNormalized, Throttler, postInput, postTakeover } from './browserInput'

describe('mapToNormalized', () => {
  const rect = { left: 100, top: 50, width: 200, height: 400 }
  it('maps center to 0.5,0.5', () => {
    expect(mapToNormalized(rect, 200, 250)).toEqual({ x: 0.5, y: 0.5 })
  })
  it('clamps below-left to 0,0', () => {
    expect(mapToNormalized(rect, 0, 0)).toEqual({ x: 0, y: 0 })
  })
  it('clamps beyond bottom-right to 1,1', () => {
    expect(mapToNormalized(rect, 9999, 9999)).toEqual({ x: 1, y: 1 })
  })
})

describe('Throttler', () => {
  it('gates within interval, opens after', () => {
    const t = new Throttler(25)
    expect(t.ready(0)).toBe(true)
    expect(t.ready(10)).toBe(false)
    expect(t.ready(30)).toBe(true)
  })
})

describe('postInput / postTakeover', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  it('POSTs input with bearer and events', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    await postInput('http://h:1', 'tok', 'sess-1', [{ type: 'click', x: 0.5, y: 0.5, button: 'left' }])
    expect(fetchMock).toHaveBeenCalledWith(
      'http://h:1/v1/browser/sessions/sess-1/input',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      }),
    )
  })
  it('throws loud on non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409 }))
    await expect(postTakeover('http://h:1', '', 'sess-1', true)).rejects.toThrow(/409/)
  })
})
