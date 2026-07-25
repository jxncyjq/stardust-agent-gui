import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConfirmDialog } from './ConfirmDialog'
import { useConfirmStore, confirm } from '../stores/confirmStore'

beforeEach(() => useConfirmStore.setState({ request: null }))

describe('ConfirmDialog', () => {
  it('renders nothing when there is no request', () => {
    const { container } = render(<ConfirmDialog />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the request and resolves true on confirm click', async () => {
    render(<ConfirmDialog />)
    const p = confirm({ title: '删除', message: '不可撤销', confirmLabel: '删除', danger: true })
    expect(await screen.findByText('不可撤销')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await expect(p).resolves.toBe(true)
  })

  it('resolves false on Escape', async () => {
    render(<ConfirmDialog />)
    const p = confirm({ title: 't', message: 'm' })
    await screen.findByText('m')
    fireEvent.keyDown(document, { key: 'Escape' })
    await expect(p).resolves.toBe(false)
  })
})
