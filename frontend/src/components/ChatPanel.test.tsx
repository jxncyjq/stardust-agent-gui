import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// vi.mock() factories are hoisted above imports/top-level consts (see
// ModeSelector.test.tsx), so the mock objects must be built with vi.hoisted().
const mocks = vi.hoisted(() => ({
  SubmitTask: vi.fn(),
  GetTaskResult: vi.fn(),
  GetSessionTurns: vi.fn(),
  NewSession: vi.fn(),
  ListSessions: vi.fn(),
  SendAgentMessage: vi.fn(),
  HandoffTask: vi.fn(),
  SkillCommand: vi.fn(),
  PickDirectory: vi.fn(),
  SetSessionWorkingDir: vi.fn(),
  SetSessionMode: vi.fn(),
  ListAgents: vi.fn(),
  ServeStatus: vi.fn(),
  ListPendingApprovals: vi.fn(),
}))
vi.mock('../../wailsjs/go/main/App', () => mocks)
vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}))

import { ChatPanel } from './ChatPanel'
import { useSessionStore } from '../stores/sessionStore'
import { useChatStore } from '../stores/chatStore'
import { useAgentStore } from '../stores/agentStore'
import { useRunStore } from '../stores/runStore'
import { useApprovalStore } from '../stores/approvalStore'

function seedSession(workingDir?: string) {
  useSessionStore.setState({
    currentSessionId: 's1',
    sessions: [
      { id: 's1', project: 'p', agent: 'a', title: 't1', archived: false, updatedAt: '', workingDir },
    ],
  })
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset())
  mocks.GetSessionTurns.mockResolvedValue([])
  mocks.ListAgents.mockResolvedValue([])
  mocks.ServeStatus.mockResolvedValue({ running: true, port: 0 })
  mocks.ListPendingApprovals.mockResolvedValue([])
  useChatStore.setState({ messages: [] })
  useSessionStore.setState({ currentSessionId: '', sessions: [] })
  useRunStore.setState({ runs: {}, now: Date.now() })
  useAgentStore.setState({ agents: [], selected: 'default-agent', error: '' })
  useApprovalStore.setState({ pending: [] })
})

// Opens the "+" popup menu, which offers "图片" (existing image attach flow,
// unchanged) and "工作目录" (this task's new directory-picker flow).
async function openAttachMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '添加附件' }))
}

describe('ChatPanel working-directory picker', () => {
  it('shows a menu with 图片 and 工作目录 options when + is clicked', async () => {
    seedSession()
    const user = userEvent.setup()
    render(<ChatPanel />)

    await openAttachMenu(user)

    expect(screen.getByText('图片')).toBeInTheDocument()
    expect(screen.getByText('工作目录')).toBeInTheDocument()
  })

  it('picking a directory calls SetSessionWorkingDir and renders a chip', async () => {
    seedSession()
    mocks.PickDirectory.mockResolvedValue('/repo/project')
    mocks.SetSessionWorkingDir.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<ChatPanel />)

    await openAttachMenu(user)
    await user.click(screen.getByText('工作目录'))

    await waitFor(() => {
      expect(mocks.SetSessionWorkingDir).toHaveBeenCalledWith('s1', '/repo/project')
    })
    expect(useSessionStore.getState().sessions.find((s) => s.id === 's1')?.workingDir).toBe(
      '/repo/project'
    )
    expect(await screen.findByText('/repo/project')).toBeInTheDocument()
  })

  it('cancelling the directory dialog (empty string) does not call SetSessionWorkingDir and shows no chip', async () => {
    seedSession()
    mocks.PickDirectory.mockResolvedValue('')
    const user = userEvent.setup()
    render(<ChatPanel />)

    await openAttachMenu(user)
    await user.click(screen.getByText('工作目录'))

    await waitFor(() => {
      expect(mocks.PickDirectory).toHaveBeenCalled()
    })
    expect(mocks.SetSessionWorkingDir).not.toHaveBeenCalled()
    expect(useSessionStore.getState().sessions.find((s) => s.id === 's1')?.workingDir).toBeUndefined()
    expect(screen.queryByTitle(/工作目录/)).not.toBeInTheDocument()
  })

  it('reports a system message when SetSessionWorkingDir rejects (set-once violation, 400)', async () => {
    seedSession()
    mocks.PickDirectory.mockResolvedValue('/repo/project')
    mocks.SetSessionWorkingDir.mockRejectedValue(new Error('working_dir already bound'))
    const user = userEvent.setup()
    render(<ChatPanel />)

    await openAttachMenu(user)
    await user.click(screen.getByText('工作目录'))

    await waitFor(() => {
      expect(useChatStore.getState().messages.length).toBe(1)
    })
    const msg = useChatStore.getState().messages[0]
    expect(msg.role).toBe('system')
    expect(msg.content).toContain('working_dir already bound')
    // The store is left untouched: no chip appears from a failed bind.
    expect(useSessionStore.getState().sessions.find((s) => s.id === 's1')?.workingDir).toBeUndefined()
  })

  it('once a workingDir is bound, the menu item is inert: clicking it neither reopens the picker nor calls SetSessionWorkingDir again', async () => {
    seedSession('/already/bound')
    const user = userEvent.setup()
    render(<ChatPanel />)

    await openAttachMenu(user)
    await user.click(screen.getByText('工作目录（已绑定，不可更改）'))

    expect(mocks.PickDirectory).not.toHaveBeenCalled()
    expect(mocks.SetSessionWorkingDir).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(useChatStore.getState().messages.length).toBe(1)
    })
    expect(useChatStore.getState().messages[0].content).toContain('不可更改')
  })
})
