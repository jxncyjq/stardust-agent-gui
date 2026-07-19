import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// vi.mock() factories are hoisted above imports/top-level consts (see
// ModeSelector.test.tsx), so the mock object must be built with vi.hoisted().
const mocks = vi.hoisted(() => ({
  DecideApproval: vi.fn(),
}))
vi.mock('../../wailsjs/go/main/App', () => mocks)

import { ApprovalPrompt } from './ApprovalPrompt'
import { useApprovalStore } from '../stores/approvalStore'

function seedTicket() {
  useApprovalStore.getState().onPending({
    ticket_id: 't1',
    task_id: 'task-1',
    tool: 'shell',
    arguments: { cmd: 'rm -rf /tmp/x' },
  })
}

beforeEach(() => {
  mocks.DecideApproval.mockReset()
  useApprovalStore.setState({ pending: [] })
})

describe('ApprovalPrompt', () => {
  it('renders nothing when there are no pending tickets', () => {
    const { container } = render(<ApprovalPrompt />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the tool name and arguments for a pending ticket', () => {
    seedTicket()
    render(<ApprovalPrompt />)
    expect(screen.getByText(/shell/)).toBeInTheDocument()
    expect(screen.getByText(/cmd/)).toBeInTheDocument()
    expect(screen.getByText(/rm -rf \/tmp\/x/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批准' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '拒绝' })).toBeInTheDocument()
  })

  it('clicking 批准 calls DecideApproval with the "approve" verb and removes the ticket', async () => {
    seedTicket()
    mocks.DecideApproval.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<ApprovalPrompt />)

    await user.click(screen.getByRole('button', { name: '批准' }))

    await waitFor(() => {
      expect(mocks.DecideApproval).toHaveBeenCalledWith('task-1', 't1', 'approve')
    })
    await waitFor(() => {
      expect(useApprovalStore.getState().pending).toHaveLength(0)
    })
  })

  it('clicking 拒绝 calls DecideApproval with the "deny" verb and removes the ticket', async () => {
    seedTicket()
    mocks.DecideApproval.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<ApprovalPrompt />)

    await user.click(screen.getByRole('button', { name: '拒绝' }))

    await waitFor(() => {
      expect(mocks.DecideApproval).toHaveBeenCalledWith('task-1', 't1', 'deny')
    })
    await waitFor(() => {
      expect(useApprovalStore.getState().pending).toHaveLength(0)
    })
  })

  it('shows an inline error and keeps the ticket when DecideApproval 404s (ticket gone)', async () => {
    seedTicket()
    mocks.DecideApproval.mockRejectedValue(new Error('decide approval "t1" for task "task-1": ticket not found: gone'))
    const user = userEvent.setup()
    render(<ApprovalPrompt />)

    await user.click(screen.getByRole('button', { name: '批准' }))

    await waitFor(() => {
      expect(screen.getByText(/ticket not found/)).toBeInTheDocument()
    })
    // The failed decision must not silently remove the ticket.
    expect(useApprovalStore.getState().pending).toHaveLength(1)
  })

  it('shows an inline error and keeps the ticket when DecideApproval 409s (already decided)', async () => {
    seedTicket()
    mocks.DecideApproval.mockRejectedValue(new Error('decide approval "t1" for task "task-1": already decided: done'))
    const user = userEvent.setup()
    render(<ApprovalPrompt />)

    await user.click(screen.getByRole('button', { name: '拒绝' }))

    await waitFor(() => {
      expect(screen.getByText(/already decided/)).toBeInTheDocument()
    })
    expect(useApprovalStore.getState().pending).toHaveLength(1)
  })
})
