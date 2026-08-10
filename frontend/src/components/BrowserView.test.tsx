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

describe('BrowserView takeover', () => {
  beforeEach(() => {
    useBrowserStore.getState().reset()
    useBrowserStore.getState().setSession('sess-1')
    vi.restoreAllMocks()
    // vi.restoreAllMocks() 对纯 vi.fn()（非 vi.spyOn）没有"原始实现"可恢复，
    // 会把 factory 里设的 mockResolvedValue 清空成 undefined；这里重新设一次。
    vi.mocked(GetBrowserEndpoint).mockResolvedValue({ baseURL: 'http://h:1', token: 'tok' })
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
})
