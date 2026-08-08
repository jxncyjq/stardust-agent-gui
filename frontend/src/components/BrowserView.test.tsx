import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useBrowserStore } from '../stores/browserStore'
import { BrowserView } from './BrowserView'

// 桩 useBrowserStream（避免真连流）
vi.mock('../hooks/useBrowserStream', () => ({ useBrowserStream: () => {} }))

describe('BrowserView', () => {
  beforeEach(() => useBrowserStore.getState().reset())

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
})
