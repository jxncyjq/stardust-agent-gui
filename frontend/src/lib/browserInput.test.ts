import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mapToNormalized, mapToNormalizedContained, Throttler, postInput, postTakeover } from './browserInput'

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

describe('mapToNormalizedContained', () => {
  // landscape 200x100 frame inside a square 200x200 box → object-contain fits
  // width, leaves 50px letterbox top and bottom (offY=50), offX=0.
  const box = { left: 0, top: 0, width: 200, height: 200 }
  it('maps box center to image center 0.5,0.5', () => {
    expect(mapToNormalizedContained(box, 200, 100, 100, 100)).toEqual({ x: 0.5, y: 0.5 })
  })
  it('maps the image top edge (inside the letterbox) to y=0', () => {
    expect(mapToNormalizedContained(box, 200, 100, 100, 50)).toEqual({ x: 0.5, y: 0 })
  })
  it('maps the image bottom edge to y=1', () => {
    expect(mapToNormalizedContained(box, 200, 100, 100, 150)).toEqual({ x: 0.5, y: 1 })
  })
  it('clamps clicks in the gray letterbox margin to the image edge', () => {
    expect(mapToNormalizedContained(box, 200, 100, 100, 10)).toEqual({ x: 0.5, y: 0 })
  })
  it('falls back to the raw box when image size is unknown', () => {
    expect(mapToNormalizedContained(box, 0, 0, 100, 100)).toEqual({ x: 0.5, y: 0.5 })
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
