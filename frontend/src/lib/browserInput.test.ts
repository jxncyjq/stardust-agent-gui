import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  mapToNormalized,
  mapToNormalizedContained,
  Throttler,
  postInput,
  postTakeover,
  keyDownEvents,
  keyUpEvents,
  modifiersOf,
  type KeyLike,
} from './browserInput'

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

// 修饰键契约：接管里按 Ctrl+C 必须真的是复制，而不是往页面里打一个字母 c。
//
// 之前 onKeyDown 的分流只有「单字符 → char，其余 → keydown」，于是 Control/Shift
// 这些键作为 keydown 发出去，被后端的键名白名单整批拒绝（每按一次 Shift 一条失败
// 请求），随后的 c 作为 char 落进页面——「复制」变成了「输入 c」。
describe('modifier contract', () => {
  const evt = (over: Partial<KeyLike>): KeyLike => ({
    key: 'a', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...over,
  })

  it('sends nothing for a modifier key on its own', () => {
    for (const key of ['Control', 'Shift', 'Alt', 'Meta']) {
      expect(keyDownEvents(evt({ key }))).toEqual([])
      expect(keyUpEvents(evt({ key }))).toEqual([])
    }
  })

  it('sends a plain printable character as text', () => {
    expect(keyDownEvents(evt({ key: 'a' }))).toEqual([{ type: 'char', text: 'a' }])
    // Shift is already baked into the character; it is not a separate command.
    expect(keyDownEvents(evt({ key: 'A', shiftKey: true }))).toEqual([{ type: 'char', text: 'A' }])
    expect(keyUpEvents(evt({ key: 'a' }))).toEqual([])
  })

  it('sends a shortcut as a key event carrying its modifiers', () => {
    expect(keyDownEvents(evt({ key: 'c', ctrlKey: true }))).toEqual([
      { type: 'keydown', key: 'c', modifiers: ['ctrl'] },
    ])
    expect(keyUpEvents(evt({ key: 'c', ctrlKey: true }))).toEqual([
      { type: 'keyup', key: 'c', modifiers: ['ctrl'] },
    ])
  })

  it('sends named keys as key events, with whatever is held', () => {
    expect(keyDownEvents(evt({ key: 'Enter' }))).toEqual([{ type: 'keydown', key: 'Enter' }])
    expect(keyDownEvents(evt({ key: 'ArrowLeft', shiftKey: true, altKey: true }))).toEqual([
      { type: 'keydown', key: 'ArrowLeft', modifiers: ['shift', 'alt'] },
    ])
  })

  it('reads modifiers off a mouse event so ctrl+click reaches the page', () => {
    expect(modifiersOf(evt({ ctrlKey: true, metaKey: true }))).toEqual(['ctrl', 'meta'])
    expect(modifiersOf(evt({}))).toBeUndefined()
  })
})
