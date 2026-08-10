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

// postInput/postTakeover now forward through the Go Wails bindings (not a
// direct fetch), so mock the binding module and assert the arguments.
const browserInputMock = vi.fn()
const browserTakeoverMock = vi.fn()
vi.mock('../../wailsjs/go/main/App', () => ({
  BrowserInput: (id: string, events: string) => browserInputMock(id, events),
  BrowserTakeover: (id: string, enabled: boolean) => browserTakeoverMock(id, enabled),
}))

describe('postInput / postTakeover', () => {
  beforeEach(() => {
    browserInputMock.mockReset().mockResolvedValue(undefined)
    browserTakeoverMock.mockReset().mockResolvedValue(undefined)
  })
  it('forwards input events as a JSON string via the binding', async () => {
    await postInput('sess-1', [{ type: 'click', x: 0.5, y: 0.5, button: 'left' }])
    expect(browserInputMock).toHaveBeenCalledWith(
      'sess-1',
      JSON.stringify([{ type: 'click', x: 0.5, y: 0.5, button: 'left' }]),
    )
  })
  it('forwards takeover toggle via the binding', async () => {
    await postTakeover('sess-1', true)
    expect(browserTakeoverMock).toHaveBeenCalledWith('sess-1', true)
  })
  it('propagates a binding rejection (fail-loud)', async () => {
    browserTakeoverMock.mockRejectedValue(new Error('post takeover: status 409'))
    await expect(postTakeover('sess-1', true)).rejects.toThrow(/409/)
  })
})
