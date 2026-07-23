import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

// The Wails runtime mock keeps a real listener registry rather than a bare
// vi.fn(): the task-outcome wait registers on 'agent:event' and relies on the
// cancel function EventsOn returns, so tests must be able to (a) drive the
// registered callback and (b) observe that cancelling actually unregisters.
const runtimeMocks = vi.hoisted(() => {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {}
  return {
    listeners,
    EventsOn: vi.fn((name: string, cb: (...args: any[]) => void) => {
      ;(listeners[name] ??= []).push(cb)
      return () => {
        listeners[name] = (listeners[name] ?? []).filter((registered) => registered !== cb)
      }
    }),
    EventsOff: vi.fn((name: string) => {
      delete listeners[name]
    }),
  }
})
vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: runtimeMocks.EventsOn,
  EventsOff: runtimeMocks.EventsOff,
}))

// emitAgentEvent replays one SSE event exactly as sse_bridge.go emits it:
// {type, data} where data is the raw RuntimeEvent JSON string.
function emitAgentEvent(payload: { type: string; data: string }) {
  for (const cb of runtimeMocks.listeners['agent:event'] ?? []) cb(payload)
}

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
      { id: 's1', project: 'p', title: 't1', archived: false, updatedAt: '', workingDir },
    ],
  })
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset())
  for (const name of Object.keys(runtimeMocks.listeners)) delete runtimeMocks.listeners[name]
  // mockClear (not mockReset) so the registry implementation survives; the call
  // history must not leak across tests, since unmount cleanup from a previous
  // test would otherwise show up as an EventsOff call in this one.
  runtimeMocks.EventsOn.mockClear()
  runtimeMocks.EventsOff.mockClear()
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

  // Regression: with no session selected, onPickWorkingDir returned on its very
  // first line without telling anyone, so the menu item just looked dead. Every
  // other failure path in that function already reports via a system message.
  it('explains why nothing happens when 工作目录 is picked with no session selected', async () => {
    useSessionStore.setState({ currentSessionId: '', sessions: [] })
    const user = userEvent.setup()
    render(<ChatPanel />)

    await openAttachMenu(user)
    await user.click(screen.getByText('工作目录'))

    // The picker must not open: working_dir binds to a session, and there is none.
    expect(mocks.PickDirectory).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByText(/尚未选择会话/)).toBeInTheDocument()
    })
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

// The old flow polled GetTaskResult 120 x 600ms and then gave up with
// "任务状态: running，暂无结果" — a 72s hard ceiling that silently hid a task
// that was still running on the backend. The wait is now SSE-driven
// (task_completed / task_failed on 'agent:event'), with polling as a fallback
// and a long timeout whose message states the truth.
//
// These tests run on fake timers and submit with fireEvent rather than
// userEvent: the point of each assertion is *which* clock tick produced the
// answer, so no timer may advance except where the test advances it.
describe('ChatPanel task-outcome wait', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function submit(prompt = '写个文件') {
    fireEvent.change(screen.getByPlaceholderText(/输入消息/), { target: { value: prompt } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
  }

  // flush lets pending promise callbacks (SubmitTask, GetTaskResult) run
  // without moving the clock.
  async function flush() {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  function lastAssistantContent(): string {
    const assistant = useChatStore.getState().messages.filter((m) => m.role === 'assistant')
    return assistant.length > 0 ? assistant[assistant.length - 1].content : ''
  }

  it('a task_completed SSE event ends the wait without any timer advancing', async () => {
    seedSession()
    mocks.SubmitTask.mockResolvedValue('task-1')
    mocks.GetTaskResult.mockResolvedValue({ status: 'done', result: '文件已写入', total_tokens: 42 })
    render(<ChatPanel />)

    submit()
    await flush()
    // The clock has not moved, so no poll can have fired: whatever appears next
    // is attributable to the SSE event alone.
    expect(mocks.GetTaskResult).not.toHaveBeenCalled()

    await act(async () => {
      emitAgentEvent({ type: 'task_completed', data: JSON.stringify({ task_id: 'task-1' }) })
    })
    await flush()

    expect(lastAssistantContent()).toBe('文件已写入')
  })

  it('ignores a terminal SSE event belonging to another task', async () => {
    seedSession()
    mocks.SubmitTask.mockResolvedValue('task-mine')
    mocks.GetTaskResult.mockResolvedValue({ status: 'done', result: '不该被别人的事件触发' })
    render(<ChatPanel />)

    submit()
    await flush()

    await act(async () => {
      emitAgentEvent({ type: 'task_completed', data: JSON.stringify({ task_id: 'task-other' }) })
    })
    await flush()

    expect(mocks.GetTaskResult).not.toHaveBeenCalled()
    expect(lastAssistantContent()).toBe('')
  })

  it('falls back to low-frequency polling when the terminal SSE event never arrives', async () => {
    seedSession()
    mocks.SubmitTask.mockResolvedValue('task-2')
    mocks.GetTaskResult.mockResolvedValueOnce({ status: 'running', result: '' }).mockResolvedValue({
      status: 'done',
      result: '轮询兜底拿到结果',
      total_tokens: 7,
    })
    render(<ChatPanel />)

    submit()
    await flush()
    await advance(3000)

    // Polling is now the fallback, not the primary channel: three seconds must
    // buy one request, not the five the 600ms loop used to make.
    expect(mocks.GetTaskResult.mock.calls.length).toBe(1)

    await advance(3000)
    expect(lastAssistantContent()).toBe('轮询兜底拿到结果')
  })

  it('on timeout says the task is still running instead of claiming there is no result', async () => {
    seedSession()
    mocks.SubmitTask.mockResolvedValue('task-3')
    mocks.GetTaskResult.mockResolvedValue({ status: 'running', result: '' })
    render(<ChatPanel />)

    submit()
    await flush()
    // Well past the old 72s ceiling: the wait must still be in flight.
    await advance(5 * 60 * 1000)
    expect(lastAssistantContent()).toBe('')

    await advance(30 * 60 * 1000)

    const content = lastAssistantContent()
    expect(content).toContain('仍在后端运行')
    expect(content).not.toContain('暂无结果')
  })

  it('unregisters its SSE listener with the handle EventsOn returned, not EventsOff', async () => {
    seedSession()
    mocks.SubmitTask.mockResolvedValue('task-4')
    mocks.GetTaskResult.mockResolvedValue({ status: 'done', result: '完成' })
    render(<ChatPanel />)
    // useAgentEvents holds its own 'agent:event' listener; EventsOff would take
    // that one down too, which is why the wait must use the cancel handle.
    const baseline = (runtimeMocks.listeners['agent:event'] ?? []).length

    submit()
    await flush()
    expect((runtimeMocks.listeners['agent:event'] ?? []).length).toBe(baseline + 1)

    await act(async () => {
      emitAgentEvent({ type: 'task_completed', data: JSON.stringify({ task_id: 'task-4' }) })
    })
    await flush()

    expect(lastAssistantContent()).toBe('完成')
    expect((runtimeMocks.listeners['agent:event'] ?? []).length).toBe(baseline)
    expect(runtimeMocks.EventsOff).not.toHaveBeenCalledWith('agent:event')
  })
})
