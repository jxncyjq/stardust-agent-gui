import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const runtimeMocks = vi.hoisted(() => ({ BrowserOpenURL: vi.fn() }))
vi.mock('../../wailsjs/runtime/runtime', () => runtimeMocks)

import { WebPreviewPanel } from './WebPreviewPanel'

describe('WebPreviewPanel', () => {
  beforeEach(() => runtimeMocks.BrowserOpenURL.mockClear())

  it('shows an empty state when there is no source', () => {
    render(<WebPreviewPanel source={null} onClose={() => {}} />)
    expect(screen.queryByTitle('HTML 预览内容')).toBeNull()
    expect(screen.getByText('暂无预览内容')).toBeInTheDocument()
  })

  it('renders the html into a sandboxed iframe srcdoc', () => {
    render(
      <WebPreviewPanel
        source={{ kind: 'html', html: '<h1>hello</h1>', title: '报告' }}
        onClose={() => {}}
      />
    )
    const iframe = screen.getByTitle('HTML 预览内容') as HTMLIFrameElement
    expect(iframe.getAttribute('srcdoc')).toBe('<h1>hello</h1>')
    const sandbox = iframe.getAttribute('sandbox')
    expect(sandbox).not.toBeNull()
    expect(sandbox).not.toContain('allow-scripts')
    expect(sandbox).not.toContain('allow-same-origin')
  })

  it('shows the title in the toolbar', () => {
    render(
      <WebPreviewPanel source={{ kind: 'html', html: '<p>x</p>', title: '报告' }} onClose={() => {}} />
    )
    expect(screen.getByText('报告')).toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(<WebPreviewPanel source={{ kind: 'html', html: '<p>x</p>' }} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('opens sourceUrl externally and hides the button without one', () => {
    const { rerender } = render(
      <WebPreviewPanel source={{ kind: 'html', html: '<p>x</p>' }} onClose={() => {}} />
    )
    expect(screen.queryByRole('button', { name: '在系统浏览器打开' })).toBeNull()

    rerender(
      <WebPreviewPanel
        source={{ kind: 'html', html: '<p>x</p>', sourceUrl: 'https://example.com' }}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '在系统浏览器打开' }))
    expect(runtimeMocks.BrowserOpenURL).toHaveBeenCalledWith('https://example.com')
  })
})
