import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { ThreePanelLayout } from './ThreePanelLayout'

// 浏览器视图此前挤在右栏的一个 tab 里：要么看事件、要么看浏览器，二选一；而「看着
// Agent 浏览、同时盯事件流」正是这个视图存在的理由。
//
// 给它自己的一列，并且只在**真的有浏览器会话**时占位——没有会话时多一条空栏，是拿
// 屏幕宽度换一个什么都不显示的框。

beforeEach(() => {
  localStorage.clear()
})

function renderLayout(browser?: React.ReactNode) {
  return render(
    <ThreePanelLayout
      sidebar={<div>SIDEBAR</div>}
      chat={<div>CHAT</div>}
      status={<div>STATUS</div>}
      browser={browser}
    />,
  )
}

describe('the browser column', () => {
  it('is absent when nothing is browsing', () => {
    renderLayout(undefined)

    expect(screen.queryByText('BROWSER')).toBeNull()
    // 其余三栏照旧。
    expect(screen.getByText('CHAT')).toBeInTheDocument()
    expect(screen.getByText('STATUS')).toBeInTheDocument()
  })

  it('takes its own column when there is something to show', () => {
    renderLayout(<div>BROWSER</div>)

    expect(screen.getByText('BROWSER')).toBeInTheDocument()
    // 与状态栏**并存**，不是二选一——这正是从 tab 里搬出来的理由。
    expect(screen.getByText('STATUS')).toBeInTheDocument()
  })

  it('can be resized by its own gutter', () => {
    renderLayout(<div>BROWSER</div>)

    const handle = screen.getByRole('separator', { name: '调整浏览器面板宽度' })
    expect(handle).toBeInTheDocument()
    fireEvent.mouseDown(handle)
    fireEvent.mouseMove(window, { clientX: 600 })
    fireEvent.mouseUp(window)
    // 宽度落盘：下次打开还是这个宽度，而不是每次都回到默认值。
    expect(Number(localStorage.getItem('browserWidth'))).toBeGreaterThan(0)
  })

  it('clamps a stored width that would squeeze the other columns out', () => {
    localStorage.setItem('browserWidth', '99999')
    renderLayout(<div>BROWSER</div>)

    // 一个越界的存量值（改过配置、换过屏幕）不能把别的栏挤没。挂载时夹住并把夹过
    // 的值写回去，于是这台机器上的下一次启动就是正常的——这与另外两栏一致。
    const column = screen.getByText('BROWSER').parentElement as HTMLElement
    expect(column.style.width).toBe('900px')
    expect(Number(localStorage.getItem('browserWidth'))).toBe(900)
  })
})

vi.mock('../icons', async (importOriginal) => await importOriginal())
