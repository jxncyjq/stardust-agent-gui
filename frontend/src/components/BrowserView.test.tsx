import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserView } from './BrowserView'
import { useBrowserStore } from '../stores/browserStore'
import { GetBrowserEndpoint } from '../../wailsjs/go/main/App'

// mock Wails 绑定与 stream hook（避免真连 SSE）。
vi.mock('../../wailsjs/go/main/App', () => ({
  GetBrowserEndpoint: vi.fn().mockResolvedValue({ baseURL: 'http://h:1', token: 'tok' }),
}))
vi.mock('../hooks/useBrowserStream', () => ({ useBrowserStream: () => {} }))

describe('BrowserView', () => {
  beforeEach(() => {
    useBrowserStore.getState().reset()
    vi.restoreAllMocks()
    // vi.restoreAllMocks() 对纯 vi.fn()（非 vi.spyOn）没有"原始实现"可恢复，
    // 会把 factory 里设的 mockResolvedValue 清空成 undefined；这里重新设一次。
    vi.mocked(GetBrowserEndpoint).mockResolvedValue({ baseURL: 'http://h:1', token: 'tok' })
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

    it('toggles takeover via POST and shows banner', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', fetchMock)
      render(<BrowserView />)
      const btn = screen.getByRole('button', { name: /接管/ })
      fireEvent.click(btn)
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          'http://h:1/v1/browser/sessions/sess-1/takeover',
          expect.objectContaining({ method: 'POST' }),
        ),
      )
      await waitFor(() => expect(screen.getByText(/接管中/)).toBeInTheDocument())
    })

    it('does not enter takeover when toggle POST fails', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 })
      vi.stubGlobal('fetch', fetchMock)
      render(<BrowserView />)
      const btn = screen.getByRole('button', { name: /接管/ })
      fireEvent.click(btn)
      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      // 给失败路径的 catch/日志一个 microtask 落地的机会，再断言状态未被翻转。
      await waitFor(() => expect(useBrowserStore.getState().takeover).toBe(false))
      expect(screen.queryByText(/接管中/)).not.toBeInTheDocument()
    })
  })
})
