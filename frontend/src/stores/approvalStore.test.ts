import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock() factories are hoisted above imports/top-level consts (see
// configStore.test.ts), so the mock object must be built with vi.hoisted().
const mocks = vi.hoisted(() => ({
  ListPendingApprovals: vi.fn(),
}))
vi.mock('../../wailsjs/go/main/App', () => mocks)

import { useApprovalStore } from './approvalStore'

beforeEach(() => {
  mocks.ListPendingApprovals.mockReset()
  useApprovalStore.setState({ pending: [] })
})

describe('approvalStore', () => {
  it('onPending adds a normalized ticket (SSE payload uses the "tool" key)', () => {
    useApprovalStore.getState().onPending({
      ticket_id: 't1',
      task_id: 'task-1',
      tool: 'shell',
      arguments: { cmd: 'ls' },
    })
    const pending = useApprovalStore.getState().pending
    expect(pending).toHaveLength(1)
    expect(pending[0]).toEqual({
      ticket_id: 't1',
      task_id: 'task-1',
      tool: 'shell',
      arguments: { cmd: 'ls' },
    })
  })

  it('onPending de-duplicates by ticket_id', () => {
    useApprovalStore.getState().onPending({ ticket_id: 't1', task_id: 'task-1', tool: 'shell' })
    useApprovalStore.getState().onPending({ ticket_id: 't1', task_id: 'task-1', tool: 'shell' })
    expect(useApprovalStore.getState().pending).toHaveLength(1)
  })

  it('onResolved removes the ticket by ticket_id', () => {
    useApprovalStore.getState().onPending({ ticket_id: 't1', task_id: 'task-1', tool: 'shell' })
    useApprovalStore.getState().onPending({ ticket_id: 't2', task_id: 'task-1', tool: 'write' })
    useApprovalStore.getState().onResolved({ ticket_id: 't1' })
    const pending = useApprovalStore.getState().pending
    expect(pending).toHaveLength(1)
    expect(pending[0].ticket_id).toBe('t2')
  })

  it('load() fills pending from ListPendingApprovals, normalizing the "tool_name" key', async () => {
    mocks.ListPendingApprovals.mockResolvedValue([
      { ticket_id: 't1', task_id: 'task-1', tool_name: 'shell', arguments: { cmd: 'ls' } },
    ])
    await useApprovalStore.getState().load()
    const pending = useApprovalStore.getState().pending
    expect(pending).toHaveLength(1)
    expect(pending[0].tool).toBe('shell')
  })

  it('load() merges with existing pending tickets, de-duplicated by ticket_id', async () => {
    useApprovalStore.getState().onPending({ ticket_id: 't1', task_id: 'task-1', tool: 'shell' })
    mocks.ListPendingApprovals.mockResolvedValue([
      { ticket_id: 't1', task_id: 'task-1', tool_name: 'shell' },
      { ticket_id: 't2', task_id: 'task-1', tool_name: 'write' },
    ])
    await useApprovalStore.getState().load()
    const pending = useApprovalStore.getState().pending
    expect(pending.map((t) => t.ticket_id).sort()).toEqual(['t1', 't2'])
  })
})
