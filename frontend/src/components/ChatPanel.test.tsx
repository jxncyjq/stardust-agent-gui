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
  InterruptTask: vi.fn(),
  SetSessionMode: vi.fn(),
  ListAgents: vi.fn(),
  ServeStatus: vi.fn(),
  ListPendingApprovals: vi.fn(),
  GetAgentModelInfo: vi.fn(),
  // 「轨迹」标签把 TrajectoryView 拉进了 ChatPanel 的模块图，于是它的两个绑定也
  // 得在这个 mock 里：vi.mock 的工厂决定了模块有哪些具名导出，漏一个就是 import
  // 期 "No X export is defined on the mock" 而不是运行期的空值。
  GetSessionEvents: vi.fn(),
  FetchPreviewFile: vi.fn(),
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

// emitAgentToken replays one token delta exactly as sse_bridge.go emits it on
// the dedicated channel after unmarshalling the RuntimeEvent envelope: an
// {task_id, message} object (not a bare string).
function emitAgentToken(payload: { task_id: string; message: string }) {
  for (const cb of runtimeMocks.listeners['agent:token'] ?? []) cb(payload)
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
  mocks.GetAgentModelInfo.mockResolvedValue({ model: 'test-model', context_length: 128000, profile: 'p' })
  mocks.InterruptTask.mockResolvedValue(undefined)
  // 空轨迹页：events 为空、next_seq 为 0 都是端点契约里的合法取值。不给的话
  // useSessionEvents 会把 undefined 的 next_seq 当坏数据报错，噪音掩盖真失败。
  mocks.GetSessionEvents.mockResolvedValue({ events: [], next_seq: 0 })
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
// Task 2 (batch 2): the picked images must ride along on the user message
// itself (Message.images from Task 1), not just get funneled straight into
// SubmitTask — otherwise the message bubble has nothing to render and the
// caller falls back to a placeholder string.
describe('ChatPanel sends images on the message', () => {
  it('stores the sent images on the user message and drops the [附图] placeholder', async () => {
    seedSession()
    mocks.SubmitTask.mockResolvedValue('task-img')
    mocks.GetTaskResult.mockResolvedValue({ status: 'done', result: 'ok' })
    const user = userEvent.setup()
    render(<ChatPanel />)

    // Pick one image via the hidden file input (accept image/*, multiple).
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, file)

    // readFileAsDataURL is async (FileReader.readAsDataURL): wait for the
    // thumbnail preview to actually render before sending, otherwise
    // pendingImages would still be empty when sendMessage snapshots it.
    await waitFor(() => {
      expect(screen.getByAltText('已选图片 1')).toBeInTheDocument()
    })

    await user.type(screen.getByPlaceholderText(/输入消息/), '看这个')
    await user.click(screen.getByRole('button', { name: '发送消息' }))

    await waitFor(() => expect(mocks.SubmitTask).toHaveBeenCalled())
    const userMsg = useChatStore.getState().messages.find((m) => m.role === 'user')!
    expect(userMsg.images?.length).toBe(1)
    expect(userMsg.content).toBe('看这个') // 纯 prompt，无 [附图 N 张] 占位
    expect(userMsg.content).not.toContain('附图')
  })
})

// Task 6: generated_files (backend PR #76) rides along on both the history
// replay path (GetSessionTurns) and the live completion path (GetTaskResult),
// mapped via mapGeneratedFiles onto Message.generatedFiles. MessageBubble
// already renders a FileCard per entry (file.name), so asserting the card
// text is a faithful proxy for "the message carries generatedFiles".
describe('ChatPanel carries generatedFiles from history replay', () => {
  it('attaches generatedFiles from GetSessionTurns to the rebuilt assistant message', async () => {
    mocks.GetSessionTurns.mockResolvedValue([
      {
        role: 'assistant',
        content: '已生成文件',
        created_at: '2026-01-01T00:00:00Z',
        agent_id: 'default-agent',
        generated_files: [
          {
            path: 'out/report.md',
            url: '/v1/files/out/report.md',
            download_url: '/v1/files/out/report.md?dl=1',
            name: 'report.md',
          },
        ],
      },
    ])
    seedSession()
    render(<ChatPanel />)

    await waitFor(() => {
      expect(screen.getByText('report.md')).toBeInTheDocument()
    })
    const assistant = useChatStore.getState().messages.find((m) => m.role === 'assistant')
    expect(assistant?.generatedFiles?.length).toBe(1)
    expect(assistant?.generatedFiles?.[0].name).toBe('report.md')
  })

  it('replayed history with no generated_files carries an empty array (no cards render)', async () => {
    mocks.GetSessionTurns.mockResolvedValue([
      { role: 'assistant', content: '普通回复', created_at: '2026-01-01T00:00:00Z', agent_id: 'default-agent' },
    ])
    seedSession()
    render(<ChatPanel />)

    await waitFor(() => {
      expect(screen.getByText('普通回复')).toBeInTheDocument()
    })
    const assistant = useChatStore.getState().messages.find((m) => m.role === 'assistant')
    expect(assistant?.generatedFiles).toEqual([])
  })
})

describe('ChatPanel message list render budget (A3)', () => {
  it('renders only the last N messages and offers 显示更早 when over budget (A3)', async () => {
    seedSession()
    render(<ChatPanel />)

    // 灌入超过预算条数的消息
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: `m${i}`,
      role: 'assistant' as const,
      content: `msg ${i}`,
    }))
    act(() => {
      useChatStore.setState({ messages: many })
    })

    // 只渲染末尾 RENDER_BUDGET(150) 条：最早的 msg 0 不在 DOM，msg 199 在。
    await waitFor(() => {
      expect(screen.queryByText('msg 0')).toBeNull()
    })
    expect(screen.getByText('msg 199')).toBeInTheDocument()
    // 有"显示更早"按钮。
    const earlier = screen.getByRole('button', { name: /显示更早/ })
    expect(earlier).toBeInTheDocument()

    // 点一次扩大预算 → 更早的消息进入 DOM。
    const user = userEvent.setup()
    await user.click(earlier)
    await waitFor(() => {
      expect(screen.getByText('msg 0')).toBeInTheDocument()
    })
  })

  it('does not show 显示更早 when message count is under budget', async () => {
    seedSession()
    render(<ChatPanel />)

    act(() => {
      useChatStore.setState({ messages: [{ id: 'm1', role: 'assistant' as const, content: 'hi' }] })
    })

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /显示更早/ })).toBeNull()
    })
  })
})

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

  function assistantMessages() {
    return useChatStore.getState().messages.filter((m) => m.role === 'assistant')
  }

  it('streams token deltas into one assistant bubble and finalizes it on task_completed without a second message', async () => {
    seedSession()
    mocks.SubmitTask.mockResolvedValue('task-s')
    mocks.GetTaskResult.mockResolvedValue({
      status: 'done',
      result: '你好世界',
      total_tokens: 12,
      prompt_tokens: 8,
      completion_tokens: 4,
    })
    render(<ChatPanel />)

    submit()
    await flush()

    // Deltas arrive before the terminal event: a single assistant bubble forms
    // and accumulates, marked streaming while in flight.
    await act(async () => {
      emitAgentToken({ task_id: 'task-s', message: '你好' })
      emitAgentToken({ task_id: 'task-s', message: '世界' })
    })
    await flush()

    let assistants = assistantMessages()
    expect(assistants.length).toBe(1)
    expect(assistants[0].streaming).toBe(true)
    expect(assistants[0].content).toBe('你好世界')

    // task_completed finalizes the same bubble (no second message) and attaches
    // the usage meta pulled from GetTaskResult.
    await act(async () => {
      emitAgentEvent({ type: 'task_completed', data: JSON.stringify({ task_id: 'task-s' }) })
    })
    await flush()

    assistants = assistantMessages()
    expect(assistants.length).toBe(1)
    expect(assistants[0].streaming).toBe(false)
    expect(assistants[0].content).toBe('你好世界')
    expect(assistants[0].meta?.totalTokens).toBe(12)
    expect(assistants[0].meta?.promptTokens).toBe(8)
    expect(assistants[0].meta?.completionTokens).toBe(4)
  })

  it('ignores token deltas belonging to another task and falls back to one appended message', async () => {
    seedSession()
    mocks.SubmitTask.mockResolvedValue('task-mine')
    mocks.GetTaskResult.mockResolvedValue({ status: 'done', result: '我的结果', total_tokens: 3 })
    render(<ChatPanel />)

    submit()
    await flush()

    // A delta for a different task must not create a bubble here.
    await act(async () => {
      emitAgentToken({ task_id: 'task-other', message: '别人的' })
    })
    await flush()
    expect(assistantMessages().length).toBe(0)

    // With no token of its own, this task takes the non-streaming fallback path:
    // exactly one assistant message, appended from GetTaskResult.
    await act(async () => {
      emitAgentEvent({ type: 'task_completed', data: JSON.stringify({ task_id: 'task-mine' }) })
    })
    await flush()

    const assistants = assistantMessages()
    expect(assistants.length).toBe(1)
    expect(assistants[0].content).toBe('我的结果')
    expect(assistants[0].streaming).toBeFalsy()
  })

  it('re-appends the authoritative reply on completion when a session switch wiped the streaming bubble mid-stream', async () => {
    seedSession()
    mocks.SubmitTask.mockResolvedValue('task-sw')
    mocks.GetTaskResult.mockResolvedValue({ status: 'done', result: '完整回复', total_tokens: 5 })
    render(<ChatPanel />)

    submit()
    await flush()
    await act(async () => {
      emitAgentToken({ task_id: 'task-sw', message: '部分' })
    })
    await flush()
    expect(assistantMessages().length).toBe(1)

    // Emulate loadHistory clearing the view on a mid-stream session switch: the
    // streamed bubble is gone but the wait's streamedId closure still points at
    // it, so appendToken/updateMessage would silently no-op and the reply would
    // never reach the live view. On completion the authoritative reply must be
    // appended instead.
    act(() => {
      useChatStore.getState().clearMessages()
    })
    await act(async () => {
      emitAgentEvent({ type: 'task_completed', data: JSON.stringify({ task_id: 'task-sw' }) })
    })
    await flush()

    const assistants = assistantMessages()
    expect(assistants.length).toBe(1)
    expect(assistants[0].content).toBe('完整回复')
    expect(assistants[0].streaming).toBeFalsy()
  })

  it('on timeout with a streamed bubble, finalizes it and still surfaces the still-running notice', async () => {
    seedSession()
    mocks.SubmitTask.mockResolvedValue('task-to')
    mocks.GetTaskResult.mockResolvedValue({ status: 'running', result: '' })
    render(<ChatPanel />)

    submit()
    await flush()
    await act(async () => {
      emitAgentToken({ task_id: 'task-to', message: '开始了' })
    })
    await flush()

    await advance(30 * 60 * 1000)

    // The streamed bubble stops spinning...
    const streamed = useChatStore.getState().messages.find((m) => m.id === 'assistant-task-to')
    expect(streamed?.streaming).toBeFalsy()
    // ...and the truth that the task is still running on the backend is surfaced,
    // matching the non-streaming path rather than being silently dropped.
    const surfaced = useChatStore.getState().messages.some((m) => m.content.includes('仍在后端运行'))
    expect(surfaced).toBe(true)
  })

  it('attaches generatedFiles from GetTaskResult to the completed assistant message (streamed bubble path)', async () => {
    seedSession()
    mocks.SubmitTask.mockResolvedValue('task-gf')
    mocks.GetTaskResult.mockResolvedValue({
      status: 'done',
      result: '已生成文件',
      total_tokens: 5,
      generated_files: [
        {
          path: 'out/report.md',
          url: '/v1/files/out/report.md',
          download_url: '/v1/files/out/report.md?dl=1',
          name: 'report.md',
        },
      ],
    })
    render(<ChatPanel />)

    submit()
    await flush()
    // Stream a token first so this exercises the "streamed bubble finalized in
    // place" branch, not the non-streaming append fallback.
    await act(async () => {
      emitAgentToken({ task_id: 'task-gf', message: '已生成文件' })
    })
    await flush()

    await act(async () => {
      emitAgentEvent({ type: 'task_completed', data: JSON.stringify({ task_id: 'task-gf' }) })
    })
    await flush()

    const assistants = assistantMessages()
    expect(assistants.length).toBe(1)
    expect(assistants[0].generatedFiles?.length).toBe(1)
    expect(assistants[0].generatedFiles?.[0].name).toBe('report.md')
    expect(screen.getByText('report.md')).toBeInTheDocument()
  })

  it('attaches generatedFiles from GetTaskResult on the non-streaming append fallback path', async () => {
    seedSession()
    mocks.SubmitTask.mockResolvedValue('task-gf2')
    mocks.GetTaskResult.mockResolvedValue({
      status: 'done',
      result: '已生成文件2',
      generated_files: [
        { path: 'out/x.txt', url: '/v1/files/out/x.txt', download_url: '/v1/files/out/x.txt?dl=1', name: 'x.txt' },
      ],
    })
    render(<ChatPanel />)

    submit()
    await flush()
    // No token delta arrives: this task takes the non-streaming append path.
    await act(async () => {
      emitAgentEvent({ type: 'task_completed', data: JSON.stringify({ task_id: 'task-gf2' }) })
    })
    await flush()

    const assistants = assistantMessages()
    expect(assistants.length).toBe(1)
    expect(assistants[0].generatedFiles?.length).toBe(1)
    expect(assistants[0].generatedFiles?.[0].name).toBe('x.txt')
    expect(screen.getByText('x.txt')).toBeInTheDocument()
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

  it('shows a Stop button while sending and calls InterruptTask with the running task id when clicked', async () => {
    seedSession()
    mocks.SubmitTask.mockResolvedValue('task-stop')
    // Left pending deliberately: the task must still be "sending" when the
    // button is clicked, so GetTaskResult never resolves in this test.
    mocks.GetTaskResult.mockReturnValue(new Promise(() => {}))
    render(<ChatPanel />)

    // Before sending, the button reads 发送 and there is no Stop control.
    expect(screen.queryByRole('button', { name: '停止任务' })).toBeNull()

    submit()
    await flush()

    const stopButton = screen.getByRole('button', { name: '停止任务' })
    expect(screen.queryByRole('button', { name: '发送消息' })).toBeNull()

    fireEvent.click(stopButton)
    await flush()

    expect(mocks.InterruptTask).toHaveBeenCalledWith('task-stop')
  })

  it('reports a system notice when InterruptTask rejects instead of failing silently', async () => {
    seedSession()
    mocks.SubmitTask.mockResolvedValue('task-stop-err')
    mocks.GetTaskResult.mockReturnValue(new Promise(() => {}))
    mocks.InterruptTask.mockRejectedValue(new Error('task already finished'))
    render(<ChatPanel />)

    submit()
    await flush()

    const stopButton = screen.getByRole('button', { name: '停止任务' })
    fireEvent.click(stopButton)
    await flush()

    const notice = useChatStore.getState().messages.some(
      (m) => m.role === 'system' && m.content.includes('中断失败') && m.content.includes('task already finished')
    )
    expect(notice).toBe(true)
  })

  it('a task_cancelled SSE event finalizes the streamed bubble, keeps the partial text, and does not read as a failure', async () => {
    seedSession()
    mocks.SubmitTask.mockResolvedValue('task-cancel')
    mocks.GetTaskResult.mockResolvedValue({ status: 'cancelled', result: '部分输出' })
    render(<ChatPanel />)

    submit()
    await flush()

    await act(async () => {
      emitAgentToken({ task_id: 'task-cancel', message: '已经写了一半' })
    })
    await flush()

    let assistants = assistantMessages()
    expect(assistants.length).toBe(1)
    expect(assistants[0].streaming).toBe(true)

    await act(async () => {
      emitAgentEvent({ type: 'task_cancelled', data: JSON.stringify({ task_id: 'task-cancel' }) })
    })
    await flush()

    assistants = assistantMessages()
    expect(assistants.length).toBe(1)
    expect(assistants[0].streaming).toBe(false)
    // The partial streamed text survives — it is not cleared — and is marked
    // as interrupted rather than reading like a normal completion.
    expect(assistants[0].content).toContain('已经写了一半')
    expect(assistants[0].content).toContain('已中断')
    expect(assistants[0].content).not.toContain('任务执行失败')
  })
})

// A task that suspends for approval is NOT finished: a human answers the
// ticket and the task resumes. Treating "suspended" as terminal froze the
// bubble on "任务状态: suspended，暂无结果" forever — a real-machine
// walkthrough approved the ticket, watched the backend run the tool and reach
// "done", and the screen never moved.
describe('ChatPanel keeps waiting through an approval suspend', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports the resumed task result instead of freezing on suspended', async () => {
    seedSession()
    mocks.SubmitTask.mockResolvedValue('task-suspend')
    // First read: suspended (waiting for a human). Then: the approved run.
    mocks.GetTaskResult
      .mockResolvedValueOnce({ status: 'suspended', result: '' })
      .mockResolvedValue({ status: 'done', result: 'note file' })
    render(<ChatPanel />)

    fireEvent.change(screen.getByPlaceholderText(/输入消息/), { target: { value: 'read the note' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    // Fake timers: advance explicitly rather than waiting on wall clock. The
    // fallback poll runs twice — the first read sees suspended, the second the
    // resumed result.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })

    const assistant = useChatStore.getState().messages.filter((m) => m.role === 'assistant')
    expect(assistant.some((m) => m.content.includes('suspended，暂无结果'))).toBe(false)
  })
})

// 轨迹与对话互斥（spec §7 的 I1）：轨迹是「回头看整件事」的专注动作，需要整条栏的
// 横向空间放「命令 → 结果」，所以它不是对话旁边的一块，而是顶掉对话的一个标签。
describe('ChatPanel 顶部的「对话 / 轨迹」标签', () => {
  it('对话与轨迹是互斥的两个标签', async () => {
    seedSession()
    const user = userEvent.setup()
    render(<ChatPanel />)

    // 默认在「对话」：输入框在。
    expect(screen.getByPlaceholderText(/输入消息/)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '轨迹' }))

    // 切到「轨迹」：对话的输入框不在了，轨迹在了。
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/输入消息/)).not.toBeInTheDocument()
    })
    expect(screen.getByRole('searchbox', { name: '搜索轨迹' })).toBeInTheDocument()

    // 切回去：轨迹让位给对话，同样是互斥的。
    await user.click(screen.getByRole('tab', { name: '对话' }))
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/输入消息/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('searchbox', { name: '搜索轨迹' })).not.toBeInTheDocument()
  })

  // 待批的审批票挡着任务：它跟着标签走，否则用户在轨迹标签上等的是一个永远不动的
  // 任务，而屏幕上没有任何东西说明为什么。
  it('切到轨迹后，待批的审批票仍然看得见', async () => {
    seedSession()
    useApprovalStore.getState().onPending({
      ticket_id: 't1',
      task_id: 'task-1',
      tool: 'shell',
      arguments: { cmd: 'rm -rf /tmp/x' },
      requested_by: 'host:sensitive',
    })
    const user = userEvent.setup()
    render(<ChatPanel />)

    await user.click(screen.getByRole('tab', { name: '轨迹' }))

    expect(screen.getByRole('button', { name: '批准' })).toBeInTheDocument()
  })

  it('轨迹标签看的是当前选中的会话', async () => {
    seedSession()
    const user = userEvent.setup()
    render(<ChatPanel />)

    await user.click(screen.getByRole('tab', { name: '轨迹' }))

    // 接线守卫：视图不取数就永远空着，而那不报任何错。
    await waitFor(() => {
      expect(mocks.GetSessionEvents).toHaveBeenCalledWith('s1', 0, expect.any(Number))
    })
  })
})
