import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PreviewContent } from './PreviewContent'

describe('PreviewContent kind dispatch', () => {
  it('html → sandboxed iframe', () => {
    render(<PreviewContent source={{ kind: 'html', html: '<h1>h</h1>' }} raw={false} />)
    const f = screen.getByTitle('HTML 预览内容') as HTMLIFrameElement
    expect(f.getAttribute('sandbox')).not.toBeNull()
    expect(f.getAttribute('sandbox')).not.toContain('allow-scripts')
    expect(f.getAttribute('srcdoc')).toBe('<h1>h</h1>')
  })
  it('code → shiki pre', () => {
    const { container } = render(<PreviewContent source={{ kind: 'code', text: 'const x=1', lang: 'typescript' }} raw={false} />)
    expect(container.querySelector('pre')).not.toBeNull()
  })
  it('markdown → frontmatter table + body', () => {
    render(<PreviewContent source={{ kind: 'markdown', text: '---\nid: x1\n---\n# 标题' }} raw={false} />)
    expect(screen.getByText('id')).toBeInTheDocument()
    expect(screen.getByText('x1')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '标题' })).toBeInTheDocument()
  })
  it('markdown raw mode shows source pre', () => {
    const { container } = render(<PreviewContent source={{ kind: 'markdown', text: '# 标题' }} raw={true} />)
    expect(container.querySelector('pre')?.textContent).toContain('# 标题')
  })
  it('image → img with dataUri', () => {
    render(<PreviewContent source={{ kind: 'image', dataUri: 'data:image/png;base64,AAA' }} raw={false} />)
    expect(screen.getByRole('img').getAttribute('src')).toBe('data:image/png;base64,AAA')
  })
  it('binary → placeholder', () => {
    render(<PreviewContent source={{ kind: 'binary' }} raw={false} />)
    expect(screen.getByText('不支持预览此文件')).toBeInTheDocument()
  })
})
