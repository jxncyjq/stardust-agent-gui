import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ContextMenu } from './ContextMenu'

// jsdom has no layout engine, so a rendered menu measures 0x0 and no clamping
// logic would ever trigger. These tests stub the measured box to a realistic
// two-item menu and drive window.innerWidth/innerHeight directly.
const MENU_WIDTH = 120
const MENU_HEIGHT = 60

function stubMenuBox() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: MENU_WIDTH,
    height: MENU_HEIGHT,
    top: 0,
    left: 0,
    right: MENU_WIDTH,
    bottom: MENU_HEIGHT,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height })
}

const items = [
  { label: '图片', onSelect: () => {} },
  { label: '工作目录', onSelect: () => {} },
]

function renderMenu(x: number, y: number) {
  const { container } = render(<ContextMenu x={x} y={y} items={items} onClose={() => {}} />)
  const menu = container.firstElementChild as HTMLElement
  return {
    left: parseFloat(menu.style.left),
    top: parseFloat(menu.style.top),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ContextMenu viewport clamping', () => {
  // Regression: the "+" attach button sits in the toolbar at the very bottom of
  // the window, so opening its menu at the click coordinate pushed the items
  // below the viewport where they could not be clicked at all.
  it('keeps the menu fully visible when opened near the bottom edge', () => {
    stubMenuBox()
    setViewport(1264, 761)

    const { top } = renderMenu(300, 735)

    expect(top + MENU_HEIGHT).toBeLessThanOrEqual(761)
  })

  it('keeps the menu fully visible when opened near the right edge', () => {
    stubMenuBox()
    setViewport(1264, 761)

    const { left } = renderMenu(1240, 300)

    expect(left + MENU_WIDTH).toBeLessThanOrEqual(1264)
  })

  it('leaves the position untouched when the menu already fits', () => {
    stubMenuBox()
    setViewport(1264, 761)

    const { left, top } = renderMenu(300, 200)

    expect(left).toBe(300)
    expect(top).toBe(200)
  })

  // A menu taller than the window cannot fit; it must still start on screen
  // rather than being pushed to a negative offset that clips its first items.
  it('never positions the menu off the top or left edge', () => {
    stubMenuBox()
    setViewport(100, 40)

    const { left, top } = renderMenu(90, 30)

    expect(top).toBeGreaterThanOrEqual(0)
    expect(left).toBeGreaterThanOrEqual(0)
  })
})
