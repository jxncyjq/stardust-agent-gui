import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// vi.mock() factories are hoisted above imports/top-level consts (see
// configStore.test.ts), so the mock object must be built with vi.hoisted().
const mocks = vi.hoisted(() => ({
  SetSessionMode: vi.fn(),
}))
vi.mock('../../wailsjs/go/main/App', () => mocks)

import { ModeSelector } from './ModeSelector'
import { useSessionStore } from '../stores/sessionStore'
import { useChatStore } from '../stores/chatStore'

function seedSessions() {
  useSessionStore.setState({
    currentSessionId: 's1',
    sessions: [
      { id: 's1', project: 'p', agent: 'a', title: 't1', archived: false, updatedAt: '', mode: undefined },
      { id: 's2', project: 'p', agent: 'a', title: 't2', archived: false, updatedAt: '', mode: 'plan' },
    ],
  })
}

beforeEach(() => {
  mocks.SetSessionMode.mockReset()
  useChatStore.setState({ messages: [] })
  useSessionStore.setState({ currentSessionId: '', sessions: [] })
})

describe('ModeSelector', () => {
  it('defaults the current session to auto when mode is unset', () => {
    seedSessions()
    render(<ModeSelector />)
    expect(screen.getByRole('combobox')).toHaveValue('auto')
  })

  it('shows the current session mode when already set', () => {
    seedSessions()
    useSessionStore.getState().setCurrentSession('s2')
    render(<ModeSelector />)
    expect(screen.getByRole('combobox')).toHaveValue('plan')
  })

  it('changing the mode calls SetSessionMode for the current session and updates only that session (per-session)', async () => {
    seedSessions()
    mocks.SetSessionMode.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<ModeSelector />)

    await user.selectOptions(screen.getByRole('combobox'), 'manual')

    await waitFor(() => {
      expect(mocks.SetSessionMode).toHaveBeenCalledWith('s1', 'manual')
    })
    const sessions = useSessionStore.getState().sessions
    expect(sessions.find((s) => s.id === 's1')?.mode).toBe('manual')
    // The other session (s2) must be untouched: mode is per-session, not global.
    expect(sessions.find((s) => s.id === 's2')?.mode).toBe('plan')
  })

  it('reports a system message and does not update the store when the backend rejects', async () => {
    seedSessions()
    mocks.SetSessionMode.mockRejectedValue(new Error('working_dir locked: boom'))
    const user = userEvent.setup()
    render(<ModeSelector />)

    await user.selectOptions(screen.getByRole('combobox'), 'plan')

    await waitFor(() => {
      expect(useChatStore.getState().messages.length).toBe(1)
    })
    const msg = useChatStore.getState().messages[0]
    expect(msg.role).toBe('system')
    expect(msg.content).toContain('boom')
    // The optimistic-looking select reverts because the store was never updated.
    expect(useSessionStore.getState().sessions.find((s) => s.id === 's1')?.mode).toBeUndefined()
  })
})
