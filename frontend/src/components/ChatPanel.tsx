import { useRef, useEffect, useState } from 'react'
import {
  SubmitTask,
  GetTaskResult,
  GetSessionTurns,
  NewSession,
  ListSessions,
  SendAgentMessage,
  HandoffTask,
  SkillCommand,
  PickDirectory,
  SetSessionWorkingDir,
  InterruptTask,
} from '../../wailsjs/go/main/App'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { useChatStore } from '../stores/chatStore'
import { useSessionStore } from '../stores/sessionStore'
import { useRunStore } from '../stores/runStore'
import { useStatusStore, type StatusTab } from '../stores/statusStore'
import { useAgentEvents } from '../hooks/useAgentEvents'
import { MessageBubble } from './MessageBubble'
import { ExecutionStatus } from './ExecutionStatus'
import { SlashCommandMenu } from './SlashCommandMenu'
import { ContextMenu } from './ContextMenu'
import { PlusIcon, XIcon, SendIcon, SpinnerIcon, BotIcon, FolderIcon, StopIcon } from './icons'
import { AgentSelector } from './AgentSelector'
import { ModeSelector } from './ModeSelector'
import { ModelBadge } from './ModelBadge'
import { ApprovalPrompt } from './ApprovalPrompt'
import { useAgentStore } from '../stores/agentStore'
import { mapGeneratedFiles, type GeneratedFile } from '../lib/generatedFiles'

// ChatEmptyState fills the message area before the first message: it gives the
// otherwise-blank pane an identity, tells the user how to send, and surfaces a
// few common slash commands as a starting point.
function ChatEmptyState() {
  const hints = ['/new', '/sessions', '/tasks', '/skill']
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6 select-none">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <BotIcon className="w-7 h-7" />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">开始新对话</p>
        <p className="mt-1 text-xs text-muted-foreground">
          输入消息与 Agent 对话 · Enter 发送 · Shift+Enter 换行 · / 唤出命令
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {hints.map((h) => (
          <span
            key={h}
            className="rounded-md border border-border bg-muted/50 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
          >
            {h}
          </span>
        ))}
      </div>
    </div>
  )
}
import {
  filterSlashCommands,
  parseSlashCommand,
  type SlashCommand,
} from '../lib/slashCommands'

// A3: cap how many trailing messages are in the DOM at once. The full history
// lives in chatStore; only the last RENDER_BUDGET render, with a "显示更早"
// button to reveal older ones on demand. This is a render budget (hermes-style),
// not virtualization: the newest message is always rendered, so the scroll-to-
// bottom sentinel (bottomRef) and its logic stay unchanged.
const RENDER_BUDGET = 150

// Polling is the fallback channel now that the wait is SSE-driven, so it runs
// at a low frequency: it only has to cover an SSE event that was missed (the
// stream is at-most-once and may drop across a reconnect).
const POLL_INTERVAL_MS = 3000
// The wait no longer has a short hard ceiling. The old 120 x 600ms budget gave
// up after 72s and reported "任务状态: running，暂无结果", which hid a task that
// was in fact still running on the backend (write_file included) — the exact
// failure mode that unlimited max_tool_rounds made routine. This bound exists
// only so a wait cannot leak forever, and hitting it reports the truth.
const TASK_WAIT_TIMEOUT_MS = 30 * 60 * 1000
// A task's terminal statuses. 'suspended' is deliberately NOT one of them: a
// suspended task is waiting for a human to answer an approval ticket, and it
// resumes into done/failed once they do. Treating it as terminal froze the
// bubble on "任务状态: suspended，暂无结果" forever — the approval could be
// granted, the tool could run, the task could finish, and the screen would
// never move. The long TASK_WAIT_TIMEOUT_MS above is what bounds the wait
// instead, and hitting it still reports the truth.
const TERMINAL_STATUSES = ['done', 'failed', 'cancelled']
// Terminal lifecycle events on the SSE stream (serve emits RuntimeEvent types
// with underscores; the payload carries task_id).
const TERMINAL_EVENT_TYPES = ['task_completed', 'task_failed', 'task_cancelled']

// TaskOutcome is what the UI needs once a submitted task stops running.
// timedOut is carried explicitly rather than encoded as an empty result: the
// message shown for it must say the task is still running, not that there is
// no result.
type TaskOutcome = {
  status: string
  result: string
  totalTokens: number
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  timedOut: boolean
  // generatedFiles are files the task wrote (write_file), carried by
  // GetTaskResult's generated_files field (backend PR #76). [] when the task
  // wrote nothing or the outcome carries no result (e.g. timeout).
  generatedFiles: GeneratedFile[]
}

// StreamingOutcome adds the id of the streamed assistant bubble, when one was
// created. It is present only if at least one token delta for this task arrived
// (a streaming provider on the main runtime path); for a non-streaming provider
// — or if every delta was dropped — it is undefined and the caller appends the
// reply from GetTaskResult instead (backward-compatible fallback).
type StreamingOutcome = TaskOutcome & { streamedId?: string }

// waitForTaskOutcome resolves once the backend reports taskID finished.
//
// The primary terminal signal is the SSE stream (serve /v1/events ->
// sse_bridge.go -> the Wails 'agent:event' channel): a task_completed/
// task_failed event for this task triggers an immediate GetTaskResult. Polling
// remains as a fallback because the stream is at-most-once and can drop events
// across a serve restart or reconnect. onProgress reports the running token
// total so the caller can update the run indicator while the task is in flight.
//
// It also owns the streaming chat bubble for this task (single point managing
// stream + finalize + usage, per the A1 design): token deltas on the dedicated
// 'agent:token' channel create one assistant bubble and accumulate into it. The
// caller finalizes that bubble (stops the spinner, attaches usage) using the
// returned streamedId, so the streamed text is the final message and
// GetTaskResult is used only for usage — never appended as a second bubble.
function waitForTaskOutcome(
  taskID: string,
  sessionID: string,
  agentID: string,
  onProgress: (totalTokens: number) => void
): Promise<StreamingOutcome> {
  return new Promise<StreamingOutcome>((resolve, reject) => {
    let settled = false
    let cancelSSE: (() => void) | undefined
    let cancelToken: (() => void) | undefined
    let pollTimer: ReturnType<typeof setInterval> | undefined
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    // The streamed bubble's id, set on the first token delta for this task.
    let streamedId: string | undefined

    const cleanup = () => {
      // Unregister via the handle EventsOn returned. EventsOff('agent:event')
      // would also drop useAgentEvents' listener on the same channel, which
      // stays mounted for the life of the panel.
      cancelSSE?.()
      cancelToken?.()
      if (pollTimer !== undefined) clearInterval(pollTimer)
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer)
    }
    const settle = (outcome: TaskOutcome) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ ...outcome, streamedId })
    }
    const fail = (err: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      // A streamed bubble must not be left spinning forever when the wait errors
      // out; stop it so the partial text it holds reads as finished.
      if (streamedId) useChatStore.getState().finalizeMessage(streamedId)
      reject(err)
    }

    // check reads the authoritative task record. The SSE event is only a
    // wake-up: the status in storage decides, so an event that arrives before
    // the record is updated simply leaves the fallback poll to catch it.
    const check = () => {
      if (settled) return
      GetTaskResult(taskID)
        .then((res: any) => {
          // A request already in flight when the wait settled must not write
          // back stale progress.
          if (settled) return
          const status = String(res?.status ?? '')
          const totalTokens = Number(res?.total_tokens ?? 0)
          onProgress(totalTokens)
          if (!TERMINAL_STATUSES.includes(status)) return
          settle({
            status,
            result: String(res?.result ?? ''),
            totalTokens,
            promptTokens: Number(res?.prompt_tokens ?? 0),
            completionTokens: Number(res?.completion_tokens ?? 0),
            cachedTokens: Number(res?.cached_tokens ?? 0),
            timedOut: false,
            generatedFiles: mapGeneratedFiles(res?.generated_files),
          })
        })
        .catch((err: unknown) => {
          // A result query that fails is not a task that failed; report it as
          // itself rather than letting the wait hang or pretending it ended.
          fail(new Error(`查询任务 ${taskID} 结果失败: ${errText(err)}`))
        })
    }

    cancelSSE = EventsOn('agent:event', (payload: { type?: string; data?: string }) => {
      if (settled) return
      if (!TERMINAL_EVENT_TYPES.includes(String(payload?.type ?? ''))) return
      let parsed: { task_id?: string }
      try {
        parsed = JSON.parse(String(payload?.data ?? ''))
      } catch (err) {
        console.error('agent:event payload was not valid JSON:', payload, err)
        return
      }
      if (String(parsed?.task_id ?? '') !== taskID) return
      check()
    })

    // Token deltas for this task build the streaming assistant bubble. The first
    // matching delta creates the bubble; the rest accumulate into it. Deltas for
    // other tasks are ignored, and deltas that land while the user has switched
    // to a different session are dropped rather than appended to the wrong view
    // (the reply is still persisted as a turn and replays on switch-back).
    cancelToken = EventsOn('agent:token', (payload: { task_id?: string; message?: string }) => {
      if (settled) return
      if (String(payload?.task_id ?? '') !== taskID) return
      if (useSessionStore.getState().currentSessionId !== sessionID) return
      const store = useChatStore.getState()
      if (!streamedId) {
        streamedId = `assistant-${taskID}`
        store.addMessage({ id: streamedId, role: 'assistant', content: '', streaming: true, agent: agentID })
      }
      store.appendToken(streamedId, String(payload?.message ?? ''))
    })
    pollTimer = setInterval(check, POLL_INTERVAL_MS)
    timeoutTimer = setTimeout(() => {
      settle({
        status: 'timeout',
        result: '',
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        timedOut: true,
        generatedFiles: [],
      })
    }, TASK_WAIT_TIMEOUT_MS)
  })
}

// errText renders an unknown error value as a string for system notices.
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function ChatPanel() {
  useAgentEvents()

  const messages = useChatStore((s) => s.messages)
  const addMessage = useChatStore((s) => s.addMessage)
  const updateMessage = useChatStore((s) => s.updateMessage)
  const clearMessages = useChatStore((s) => s.clearMessages)
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession)
  const workingDir = useSessionStore((s) =>
    s.sessions.find((session) => session.id === s.currentSessionId)?.workingDir
  )
  const setSessionWorkingDir = useSessionStore((s) => s.setSessionWorkingDir)
  const setActiveStatusTab = useStatusStore((s) => s.setActiveTab)

  // Slash command palette state: the filtered command list and the highlighted
  // row. The menu is shown whenever there are matches for the current input.
  const [menuCommands, setMenuCommands] = useState<SlashCommand[]>([])
  const [menuIndex, setMenuIndex] = useState(0)
  const menuOpen = menuCommands.length > 0

  // addSystem inserts a local, model-free notice into the chat view (command
  // output, confirmations, errors). System messages are never sent to the model.
  function addSystem(content: string) {
    addMessage({ id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: 'system', content })
  }

  // Per-session execution state: the indicator and input-disabled state follow
  // the active session, so a task running in one session does not show its
  // spinner while another session is being viewed.
  const runs = useRunStore((s) => s.runs)
  const now = useRunStore((s) => s.now)
  const startRun = useRunStore((s) => s.startRun)
  const updateRun = useRunStore((s) => s.updateRun)
  const setRunTask = useRunStore((s) => s.setRunTask)
  const finishRun = useRunStore((s) => s.finishRun)
  const tick = useRunStore((s) => s.tick)

  const currentRun = currentSessionId ? runs[currentSessionId] : undefined
  const sending = currentRun?.running ?? false

  const [input, setInput] = useState('')
  // Selected images for the next message, held as data URIs
  // ("data:image/...;base64,...") so they can be sent straight to the backend
  // and previewed inline. Cleared after a successful send.
  const [images, setImages] = useState<string[]>([])
  // A3: render budget for messages; only the last renderBudget messages are in the DOM.
  const [renderBudget, setRenderBudget] = useState(RENDER_BUDGET)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // attachMenu holds the screen position of the "+" popup (image / working
  // directory); null means closed. Positioned at the click point, same
  // convention as Sidebar's right-click ContextMenu.
  const [attachMenu, setAttachMenu] = useState<{ x: number; y: number } | null>(null)

  // readFileAsDataURL resolves a File to its data-URI string via FileReader.
  function readFileAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(reader.error ?? new Error('read file failed'))
      reader.readAsDataURL(file)
    })
  }

  // onPickImages reads each chosen image into a data URI and appends it to the
  // pending-images list. The native input is reset so picking the same file
  // again still fires a change event.
  async function onPickImages(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    try {
      const uris = await Promise.all(files.map(readFileAsDataURL))
      setImages((prev) => [...prev, ...uris.filter((u) => u.startsWith('data:'))])
    } catch (err) {
      console.error('read selected images failed:', err)
    }
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index))
  }

  // onPickWorkingDir opens the native directory picker and, if the user chose
  // a directory (a cancelled dialog returns ""), binds it to the current
  // session. working_dir is set-once on the backend: once workingDir is
  // already set, this is not called (see the disabled menu item below), and a
  // 400 from a stale/racing call is reported rather than swallowed.
  async function onPickWorkingDir() {
    if (!currentSessionId) {
      // Not a no-op worth swallowing: the menu item is enabled, so returning
      // silently makes it read as a dead button. working_dir binds to a
      // session, and unlike sendMessage this flow does not create one.
      addSystem('尚未选择会话，请先在左侧选择或新建会话，再设置工作目录')
      return
    }
    let dir: string
    try {
      dir = await PickDirectory()
    } catch (err) {
      addSystem(`选择工作目录失败: ${errText(err)}`)
      return
    }
    if (!dir) return // user cancelled the dialog: a legitimate no-op, not an error
    try {
      await SetSessionWorkingDir(currentSessionId, dir)
      setSessionWorkingDir(currentSessionId, dir)
    } catch (err) {
      addSystem(`设置工作目录失败: ${errText(err)}`)
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // One shared 1s clock advances every running session's elapsed timer. It only
  // runs while at least one session is in flight to avoid idle re-renders.
  const anyRunning = Object.values(runs).some((r) => r.running)
  useEffect(() => {
    if (!anyRunning) return
    const timer = setInterval(() => tick(), 1000)
    return () => clearInterval(timer)
  }, [anyRunning, tick])

  // When the active session changes, replay its persisted history: clear the
  // current view, then load the session's turns and map them into chat messages.
  // An empty session id (no selection) just clears the panel.
  useEffect(() => {
    let cancelled = false
    async function loadHistory() {
      clearMessages()
      setRenderBudget(RENDER_BUDGET)
      if (!currentSessionId) return
      try {
        const turns = await GetSessionTurns(currentSessionId)
        if (cancelled) return
        for (const turn of turns || []) {
          const role = String((turn as any)?.role ?? '')
          const content = String((turn as any)?.content ?? '')
          const createdAt = String((turn as any)?.created_at ?? '')
          // The backend turn carries the agent that produced it; surface it so
          // replayed history is labelled exactly like live replies. Older turns
          // may have none — leave it undefined rather than inventing a default.
          const agent = String((turn as any)?.agent_id ?? '')
          if (role !== 'user' && role !== 'assistant') continue
          addMessage({
            id: `${currentSessionId}-${role}-${createdAt}`,
            role,
            content,
            agent: agent || undefined,
            ...(role === 'assistant' ? { generatedFiles: mapGeneratedFiles((turn as any)?.generated_files) } : {}),
          })
        }
      } catch (err) {
        // Loading history must not crash the panel; report and leave it cleared.
        console.error('load session turns failed:', err)
      }
    }
    loadHistory()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId])

  // onInputChange updates the textarea value and recomputes the slash command
  // palette. The menu opens as soon as the line starts with "/" and there are
  // matching commands; the highlight resets to the top on every keystroke.
  function onInputChange(value: string) {
    setInput(value)
    const matches = filterSlashCommands(value)
    setMenuCommands(matches)
    setMenuIndex(0)
  }

  function closeMenu() {
    setMenuCommands([])
    setMenuIndex(0)
  }

  // applyCommand completes the input to the chosen command name plus a trailing
  // space, leaving the cursor ready for arguments. Argument-less commands could
  // be executed immediately, but completing first keeps the behaviour uniform
  // and lets the user confirm with a second Enter.
  function applyCommand(command: SlashCommand) {
    setInput(command.name + ' ')
    closeMenu()
  }

  // STATUS_TAB_COMMANDS maps the four status-panel slash commands to the tab the
  // right panel should switch to.
  const STATUS_TAB_COMMANDS: Record<string, StatusTab> = {
    '/event': 'events',
    '/tasks': 'tasks',
    '/audit': 'audit',
    '/inbox': 'inbox',
  }

  // executeSlashCommand routes a parsed command to the matching capability and
  // returns true when the input was handled locally (and must not be sent to the
  // model). Unknown commands return false so the caller sends them as text.
  async function executeSlashCommand(raw: string): Promise<boolean> {
    const parsed = parseSlashCommand(raw)
    if (!parsed.name) return false

    // Status-panel tab switches.
    const tab = STATUS_TAB_COMMANDS[parsed.name]
    if (tab) {
      setActiveStatusTab(tab)
      addSystem(`已切换状态面板到「${parsed.name.slice(1)}」`)
      return true
    }

    switch (parsed.name) {
      case '/sessions': {
        try {
          const list = await ListSessions()
          const lines = (list || [])
            .map((s: any) => `• ${String(s?.title || s?.id || '')} (${String(s?.id ?? '')})`)
            .join('\n')
          addSystem(lines ? `会话列表:\n${lines}` : '暂无会话')
        } catch (err) {
          addSystem(`列出会话失败: ${errText(err)}`)
        }
        return true
      }
      case '/new': {
        try {
          const created = await NewSession('默认任务', '')
          const id = String((created as any)?.id ?? '')
          if (id) {
            setCurrentSession(id)
            addSystem(`已创建并切换到新会话 ${id}`)
          } else {
            addSystem('创建会话失败: 未返回会话 id')
          }
        } catch (err) {
          addSystem(`创建会话失败: ${errText(err)}`)
        }
        return true
      }
      case '/switch': {
        const id = parsed.args[0] ?? ''
        if (!id) {
          addSystem('用法: /switch <session_id>')
          return true
        }
        const known = useSessionStore.getState().sessions.some((s) => s.id === id)
        if (!known) {
          addSystem(`会话 ${id} 不存在`)
          return true
        }
        setCurrentSession(id)
        addSystem(`已切换到会话 ${id}`)
        return true
      }
      case '/clear-session': {
        // Clears only the on-screen view; the backend turns are kept, so the
        // history reappears on switch. This matches the GUI's notion of
        // "clear the current context display".
        clearMessages()
        addSystem('已清空当前会话显示（后端历史保留，切换会话可恢复）')
        return true
      }
      case '/history': {
        if (!currentSessionId) {
          addSystem('当前没有选中会话')
          return true
        }
        try {
          const turns = await GetSessionTurns(currentSessionId)
          clearMessages()
          for (const turn of turns || []) {
            const role = String((turn as any)?.role ?? '')
            const content = String((turn as any)?.content ?? '')
            const createdAt = String((turn as any)?.created_at ?? '')
            const agent = String((turn as any)?.agent_id ?? '')
            if (role !== 'user' && role !== 'assistant') continue
            addMessage({
              id: `${currentSessionId}-${role}-${createdAt}`,
              role,
              content,
              agent: agent || undefined,
              ...(role === 'assistant' ? { generatedFiles: mapGeneratedFiles((turn as any)?.generated_files) } : {}),
            })
          }
          addSystem('已刷新对话历史（见上方）')
        } catch (err) {
          addSystem(`刷新历史失败: ${errText(err)}`)
        }
        return true
      }
      case '/task': {
        const id = parsed.args[0] ?? ''
        if (!id) {
          addSystem('用法: /task <task_id>')
          return true
        }
        try {
          const res = await GetTaskResult(id)
          const status = String((res as any)?.status ?? '')
          const result = String((res as any)?.result ?? '')
          addSystem(`任务 ${id} 状态: ${status || '未知'}${result ? `\n${result}` : ''}`)
        } catch (err) {
          addSystem(`查询任务失败: ${errText(err)}`)
        }
        return true
      }
      case '/inbox': {
        // Switch to the inbox tab as well as confirming; covered above by the
        // STATUS_TAB_COMMANDS map, so this case is unreachable but kept explicit.
        setActiveStatusTab('inbox')
        return true
      }
      case '/send': {
        const toAgent = parsed.args[0] ?? ''
        // The message is everything after the agent token.
        const message = parsed.rest.slice(toAgent.length).trim()
        if (!toAgent || !message) {
          addSystem('用法: /send <agent> <message>')
          return true
        }
        try {
          await SendAgentMessage(toAgent, message)
          setActiveStatusTab('inbox')
          addSystem(`已向 ${toAgent} 发送消息`)
        } catch (err) {
          addSystem(`发送消息失败: ${errText(err)}`)
        }
        return true
      }
      case '/handoff': {
        const toAgent = parsed.args[0] ?? ''
        const taskID = parsed.args[1] ?? ''
        // The summary is the remainder after agent and task id.
        const afterAgent = parsed.rest.slice(toAgent.length).trim()
        const summary = afterAgent.slice(taskID.length).trim()
        if (!toAgent || !taskID || !summary) {
          addSystem('用法: /handoff <agent> <task_id> <summary>')
          return true
        }
        try {
          await HandoffTask(toAgent, taskID, summary)
          setActiveStatusTab('inbox')
          addSystem(`已将任务 ${taskID} 交接给 ${toAgent}`)
        } catch (err) {
          addSystem(`交接任务失败: ${errText(err)}`)
        }
        return true
      }
      case '/skill': {
        const action = parsed.args[0] ?? ''
        const arg = parsed.rest.slice(action.length).trim()
        if (!action || !arg) {
          addSystem('用法: /skill install|update|uninstall <arg>')
          return true
        }
        try {
          const summary = await SkillCommand(action, arg)
          addSystem(`技能 ${action} 成功: ${summary}`)
        } catch (err) {
          addSystem(`技能 ${action} 失败: ${errText(err)}`)
        }
        return true
      }
      default:
        return false
    }
  }

  async function sendMessage() {
    // A slash command is intercepted and handled locally; it is never sent to
    // the model. Non-command input falls through to the normal task flow.
    const trimmed = input.trim()
    if (trimmed.startsWith('/')) {
      const handled = await executeSlashCommand(trimmed)
      if (handled) {
        setInput('')
        closeMenu()
        return
      }
    }

    const prompt = input.trim()
    // Block only when the *current* session is busy; other sessions may run
    // concurrently.
    if (!prompt || sending) return

    // Snapshot the pending images for this send, then clear the picker so the
    // next message starts fresh. An empty array is sent for a text-only message,
    // preserving the original behaviour.
    const pendingImages = images
    addMessage({
      id: `user-${Date.now()}`,
      role: 'user',
      content: prompt,
      ...(pendingImages.length > 0 ? { images: pendingImages } : {}),
    })
    setInput('')
    setImages([])

    // Resolve the target session up front so the run is tracked against it even
    // if the user switches away while it is in flight.
    let sessionID = currentSessionId
    if (!sessionID) {
      try {
        const created = await NewSession('默认任务', '')
        sessionID = String((created as any)?.id ?? '')
      } catch (err) {
        addMessage({
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          content: `创建会话失败: ${err instanceof Error ? err.message : String(err)}`,
        })
        return
      }
      if (sessionID) {
        setCurrentSession(sessionID)
      }
    }
    if (!sessionID) return

    startRun(sessionID)
    const startedAt = Date.now()

    // Read outside the try so the catch below can label its error message with
    // the same agent, and snapshot it now: the picker may change while the task
    // is in flight, and the reply belongs to the agent that actually ran it.
    const agentID = useAgentStore.getState().selected

    try {
      const taskID = await SubmitTask(prompt, sessionID, pendingImages, agentID)
      setRunTask(sessionID, taskID)

      const {
        status,
        result,
        totalTokens,
        promptTokens,
        completionTokens,
        cachedTokens,
        timedOut,
        streamedId,
        generatedFiles,
      } = await waitForTaskOutcome(taskID, sessionID, agentID, (tokens) => updateRun(sessionID, tokens))
      if (!timedOut) {
        updateRun(sessionID, totalTokens)
      }

      const content = timedOut
        ? `任务仍在后端运行（前端已等待 ${Math.round(TASK_WAIT_TIMEOUT_MS / 60000)} 分钟未见结束事件）。可在任务面板查看最终结果。`
        : status === 'cancelled'
          ? (result.trim() ? `${result.trim()}\n\n（已中断）` : '（已中断）')
          : result.trim() ||
            (status === 'failed'
              ? '任务执行失败，未返回结果。'
              : `任务状态: ${status}，暂无结果。`)

      // Only touch the live view if the target session is still the one on
      // screen; otherwise the answer is already persisted as a turn and will
      // reappear when the user switches back.
      if (useSessionStore.getState().currentSessionId === sessionID) {
        const meta = {
          elapsedSec: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
          promptTokens,
          completionTokens,
          cachedTokens,
          totalTokens,
        }
        // The streamed bubble is the final message only if it still exists: a
        // mid-stream session switch (loadHistory -> clearMessages) can wipe it
        // while streamedId still points at the gone id, and updateMessage would
        // then silently no-op, dropping the reply from the live view. So key on
        // the bubble actually being present, not just on streamedId being set.
        const bubblePresent =
          streamedId !== undefined &&
          useChatStore.getState().messages.some((m) => m.id === streamedId)
        if (bubblePresent) {
          // Finalize in place: the streamed text is the reply, so nothing is
          // appended. Attach usage meta only when the task actually completed
          // (a timeout carries no usage). A cancelled task keeps its partial
          // streamed text — it is stopped, not cleared — with a short marker
          // appended so it does not read as a normal completion.
          const priorContent = useChatStore.getState().messages.find((m) => m.id === streamedId)?.content ?? ''
          updateMessage(streamedId!, {
            streaming: false,
            agent: agentID,
            ...(status === 'cancelled' ? { content: `${priorContent}\n\n（已中断）` } : {}),
            ...(timedOut ? {} : { meta, generatedFiles }),
          })
          if (timedOut) {
            // The finalized bubble alone cannot convey "still running"; surface
            // the same notice the non-streaming path shows rather than dropping
            // the truth. Distinct id so it does not collide with the bubble.
            addMessage({
              id: `assistant-timeout-${taskID}`,
              role: 'assistant',
              content,
              agent: agentID,
              meta,
              generatedFiles,
            })
          }
        } else {
          // No streamed bubble survives: a non-streaming provider (no token ever
          // arrived) or a bubble wiped by a session switch. Either way, append
          // the reply from GetTaskResult so the live view still shows it.
          addMessage({
            id: `assistant-${taskID}`,
            role: 'assistant',
            content,
            agent: agentID,
            meta,
            generatedFiles,
          })
        }
      }
    } catch (err) {
      if (useSessionStore.getState().currentSessionId === sessionID) {
        addMessage({
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          content: `发送失败: ${err instanceof Error ? err.message : String(err)}`,
          agent: agentID,
        })
      }
    } finally {
      finishRun(sessionID)
    }
  }

  // onStop interrupts the running task for the current session. It is
  // fail-loud: an InterruptTask error (task already finished, backend
  // unreachable, ...) surfaces as a system notice rather than being
  // swallowed, and a missing taskID (race between startRun and the SubmitTask
  // response landing) is reported instead of silently doing nothing.
  async function onStop() {
    const taskID = currentRun?.taskID
    if (!taskID) {
      addSystem('无法中断：未找到运行中的任务 ID')
      return
    }
    try {
      await InterruptTask(taskID)
    } catch (err) {
      addSystem(`中断失败: ${errText(err)}`)
    }
  }

  const elapsedSec = currentRun?.running ? Math.floor((now - currentRun.startedAt) / 1000) : 0

  return (
    <div className="flex flex-col h-full">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {messages.length === 0 ? (
          <ChatEmptyState />
        ) : (
          <>
            {messages.length > renderBudget && (
              <button
                className="interactive self-center text-xs px-3 py-1 rounded border border-border text-muted-foreground hover:bg-muted"
                onClick={() => setRenderBudget((b) => b + RENDER_BUDGET)}
              >
                显示更早（还有 {messages.length - renderBudget} 条）
              </button>
            )}
            {messages.slice(-renderBudget).map((msg) => <MessageBubble key={msg.id} message={msg} />)}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Pending Manual-mode approval tickets, rendered above the input like a
          persistent system notice. */}
      <ApprovalPrompt />

      {/* Input */}
      <div className="border-t border-border p-3">
        {sending && (
          <ExecutionStatus elapsedSec={elapsedSec} totalTokens={currentRun?.totalTokens ?? 0} />
        )}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {images.map((uri, index) => (
              <div key={`${index}-${uri.slice(0, 32)}`} className="relative">
                <img
                  src={uri}
                  alt={`已选图片 ${index + 1}`}
                  className="h-16 w-16 rounded-md object-cover border border-border"
                />
                <button
                  type="button"
                  className="interactive absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:opacity-90"
                  onClick={() => removeImage(index)}
                  aria-label={`移除图片 ${index + 1}`}
                  title="移除图片"
                >
                  <XIcon className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={onPickImages}
        />
        {menuOpen && (
          <SlashCommandMenu
            commands={menuCommands}
            activeIndex={menuIndex}
            onSelect={applyCommand}
            onHover={setMenuIndex}
          />
        )}
        <div className="flex gap-2">
          <textarea
            className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
            rows={3}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              // While the command palette is open, the arrow keys, Tab, and Esc
              // drive the menu instead of the textarea / send action.
              if (menuOpen) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setMenuIndex((i) => (i + 1) % menuCommands.length)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setMenuIndex((i) => (i - 1 + menuCommands.length) % menuCommands.length)
                  return
                }
                if (e.key === 'Tab') {
                  e.preventDefault()
                  applyCommand(menuCommands[menuIndex])
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  closeMenu()
                  return
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  // Enter completes the highlighted command rather than sending,
                  // so the user can then type arguments.
                  e.preventDefault()
                  applyCommand(menuCommands[menuIndex])
                  return
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行, / 唤出命令)"
            disabled={sending}
          />
          <button
            className={
              sending
                ? 'interactive flex items-center gap-1.5 px-4 py-2 bg-destructive text-destructive-foreground rounded-md text-sm hover:opacity-90'
                : 'interactive flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90'
            }
            onClick={sending ? onStop : sendMessage}
            aria-label={sending ? '停止任务' : '发送消息'}
          >
            {sending ? <StopIcon /> : <SendIcon />}
            <span>{sending ? '停止' : '发送'}</span>
          </button>
        </div>

        {/* Toolbar row below the input: working-dir chip + attach menu + agent picker + mode picker. */}
        <div className="mt-2 flex items-center gap-3">
          {workingDir && (
            <div
              className="flex items-center gap-1 rounded-md border border-input bg-muted/50 px-2 py-1 text-xs text-muted-foreground"
              title={`工作目录: ${workingDir}（绑定后不可更改）`}
            >
              <FolderIcon className="w-3.5 h-3.5" />
              <span className="max-w-[160px] truncate">{workingDir}</span>
            </div>
          )}
          <button
            type="button"
            className="interactive flex items-center justify-center h-7 w-7 rounded-md border border-input text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
            onClick={(e) => setAttachMenu({ x: e.clientX, y: e.clientY })}
            disabled={sending}
            aria-label="添加附件"
            title="添加附件"
          >
            <PlusIcon />
          </button>
          {attachMenu && (
            <ContextMenu
              x={attachMenu.x}
              y={attachMenu.y}
              onClose={() => setAttachMenu(null)}
              items={[
                {
                  label: '图片',
                  onSelect: () => fileInputRef.current?.click(),
                },
                {
                  label: workingDir ? '工作目录（已绑定，不可更改）' : '工作目录',
                  onSelect: () => {
                    if (workingDir) {
                      addSystem('工作目录已绑定，不可更改')
                      return
                    }
                    onPickWorkingDir()
                  },
                },
              ]}
            />
          )}
          <AgentSelector />
          <ModeSelector />
          <ModelBadge />
        </div>
      </div>
    </div>
  )
}
