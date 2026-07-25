import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

// vi.mock() factories are hoisted above imports/top-level consts, so the mock
// objects must be built with vi.hoisted() (see ChatPanel.test.tsx).
const mocks = vi.hoisted(() => ({
  ListSessions: vi.fn(),
  NewSession: vi.fn(),
  RenameSession: vi.fn(),
  DeleteSession: vi.fn(),
  SetSessionArchived: vi.fn(),
  RenameProject: vi.fn(),
  DeleteProject: vi.fn(),
  SetProjectArchived: vi.fn(),
}))
vi.mock('../../wailsjs/go/main/App', () => mocks)

const confirmMock = vi.hoisted(() => vi.fn())
vi.mock('../stores/confirmStore', () => ({ confirm: confirmMock }))

import { Sidebar, mapSession, groupSessions } from './Sidebar'
import { useSessionStore } from '../stores/sessionStore'

// The sidebar groups by project only. A session's agent_id is frozen at
// creation while the answering agent is picked per submission, so an agent
// level here would display a value that contradicts what actually ran — it is
// labelled on each assistant message instead.
describe('groupSessions', () => {
  it('groups by project without an agent level', () => {
    const tree = groupSessions([
      { id: 's1', project: 'p', title: 't1', archived: false, updatedAt: '' },
      { id: 's2', project: 'p', title: 't2', archived: false, updatedAt: '' },
    ])

    expect([...tree.keys()]).toEqual(['p'])
    // Both sessions sit directly under the project. This used to be asserted by
    // giving the two fixtures different agents; Session no longer carries an
    // agent at all, so an agent level is now impossible to build by
    // construction and the type carries that guarantee.
    expect(tree.get('p')?.map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('falls back to 默认任务 for sessions without a project', () => {
    const tree = groupSessions([
      { id: 's1', project: '', title: 't1', archived: false, updatedAt: '' },
    ])

    expect(tree.get('默认任务')?.map((s) => s.id)).toEqual(['s1'])
  })
})

// mapSession normalizes the raw Wails ListSessions() record into the Session
// shape the store expects. This covers the `mode` field added for the
// per-session mode selector (ModeSelector): the backend's AgentSession.Mode
// must survive the raw -> Session mapping unmodified.
describe('mapSession', () => {
  it('carries the backend mode field through', () => {
    const session = mapSession({ id: 's1', project: 'p', agent_id: 'a', title: 't', mode: 'plan' })
    expect(session?.mode).toBe('plan')
  })

  it('leaves mode undefined when the backend omits it', () => {
    const session = mapSession({ id: 's1', project: 'p', agent_id: 'a', title: 't' })
    expect(session?.mode).toBeUndefined()
  })

  it('drops sessions without an id regardless of mode', () => {
    expect(mapSession({ mode: 'auto' })).toBeNull()
  })

  it('carries the backend working_dir field through as workingDir', () => {
    const session = mapSession({ id: 's1', project: 'p', agent_id: 'a', title: 't', working_dir: '/repo' })
    expect(session?.workingDir).toBe('/repo')
  })

  it('leaves workingDir undefined when the backend omits working_dir', () => {
    const session = mapSession({ id: 's1', project: 'p', agent_id: 'a', title: 't' })
    expect(session?.workingDir).toBeUndefined()
  })
})

// Deleting a session goes through the self-drawn ConfirmDialog (confirmStore)
// instead of window.confirm, so it must actually await the resolved choice
// before calling DeleteSession.
describe('Sidebar delete session confirmation', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => fn.mockReset())
    confirmMock.mockReset()
    mocks.ListSessions.mockResolvedValue([
      { id: 's1', project: 'p', title: 'Session One' },
    ])
    useSessionStore.setState({ sessions: [], currentSessionId: '' })
  })

  async function openDeleteMenuForSession() {
    render(<Sidebar />)
    const row = await screen.findByText('Session One')
    fireEvent.contextMenu(row)
    return screen.findByText('删除')
  }

  it('deletes a session only after confirm resolves true', async () => {
    confirmMock.mockResolvedValue(true)
    const deleteItem = await openDeleteMenuForSession()
    fireEvent.click(deleteItem)

    await waitFor(() => expect(mocks.DeleteSession).toHaveBeenCalledWith('s1'))
  })

  it('does not delete when confirm resolves false', async () => {
    confirmMock.mockResolvedValue(false)
    const deleteItem = await openDeleteMenuForSession()
    fireEvent.click(deleteItem)

    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    expect(mocks.DeleteSession).not.toHaveBeenCalled()
  })
})
