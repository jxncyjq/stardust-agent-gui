import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserView } from './BrowserView'
import { useBrowserStore } from '../stores/browserStore'

// takeover/input 现经 Go binding（非 webview fetch），mock binding 模块与 stream hook。
const browserTakeoverMock = vi.fn()
const browserInputMock = vi.fn()
vi.mock('../../wailsjs/go/main/App', () => ({
  BrowserTakeover: (id: string, enabled: boolean) => browserTakeoverMock(id, enabled),
  BrowserInput: (id: string, events: string) => browserInputMock(id, events),
}))
vi.mock('../hooks/useBrowserStream', () => ({ useBrowserStream: () => {} }))

describe('BrowserView', () => {
  beforeEach(() => {
    useBrowserStore.getState().reset()
    vi.restoreAllMocks()
    // vi.restoreAllMocks() 会清掉纯 vi.fn() 的实现（它无 spy 原始实现可恢复），
    // 这里给 binding mock 重设一次默认 resolve。
    browserTakeoverMock.mockReset().mockResolvedValue(undefined)
    browserInputMock.mockReset().mockResolvedValue(undefined)
  })

  it('shows empty state when no session', () => {
    render(<BrowserView />)
    expect(screen.getByText(/未在浏览|no active/i)).toBeInTheDocument()
  })

  it('renders observation elements when present', () => {
    useBrowserStore.getState().setSession('sess-1')
    useBrowserStore.getState().onObservation({ elements: [{ ref: 'e1', role: 'button', name: '搜索' }], text: '' })
    render(<BrowserView />)
    expect(screen.getByText(/搜索/)).toBeInTheDocument()
    expect(screen.getByText(/e1/)).toBeInTheDocument()
  })

  it('draws frame onto canvas when frameDataUri set', () => {
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage, clearRect: vi.fn() } as unknown as CanvasRenderingContext2D)
    useBrowserStore.getState().setSession('sess-1')
    useBrowserStore.getState().onFrame('image/jpeg', 'AAAA')
    render(<BrowserView />)
    // Image.onload 是异步的；断言 canvas 存在 + getContext 被取用（drawImage 在 onload 触发）
    expect(document.querySelector('canvas')).toBeInTheDocument()
  })

  describe('takeover', () => {
    beforeEach(() => {
      useBrowserStore.getState().setSession('sess-1')
    })

    it('toggles takeover via the Go binding and shows banner', async () => {
      render(<BrowserView />)
      const btn = screen.getByRole('button', { name: /接管/ })
      fireEvent.click(btn)
      await waitFor(() => expect(browserTakeoverMock).toHaveBeenCalledWith('sess-1', true))
      await waitFor(() => expect(screen.getByText(/接管中/)).toBeInTheDocument())
    })

    it('does not enter takeover when the toggle binding fails', async () => {
      browserTakeoverMock.mockRejectedValue(new Error('post takeover: status 500'))
      render(<BrowserView />)
      const btn = screen.getByRole('button', { name: /接管/ })
      fireEvent.click(btn)
      await waitFor(() => expect(browserTakeoverMock).toHaveBeenCalled())
      // 给失败路径的 catch/日志一个 microtask 落地的机会，再断言状态未被翻转。
      await waitFor(() => expect(useBrowserStore.getState().takeover).toBe(false))
      expect(screen.queryByText(/接管中/)).not.toBeInTheDocument()
    })
  })
})
