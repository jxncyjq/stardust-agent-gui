import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('../../wailsjs/go/main/App', () => ({ OpenPath: vi.fn(), SaveGeneratedFile: vi.fn(), GetBrowserEndpoint: vi.fn() }))
import { FileCardList } from './FileCardList'

it('renders a card per file', () => {
  render(<FileCardList files={[
    { path: 'a.html', url: 'u1', downloadUrl: 'd1', name: 'a.html' },
    { path: 'b.md', url: 'u2', downloadUrl: 'd2', name: 'b.md' },
  ]} />)
  expect(screen.getByText('a.html')).toBeInTheDocument()
  expect(screen.getByText('b.md')).toBeInTheDocument()
})

it('renders nothing for empty', () => {
  const { container } = render(<FileCardList files={[]} />)
  expect(container.textContent).toBe('')
})
