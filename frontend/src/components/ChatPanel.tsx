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
} from '../../wailsjs/go/main/App'
import { useChatStore } from '../stores/chatStore'
import { useSessionStore } from '../stores/sessionStore'
import { useRunStore } from '../stores/runStore'
import { useStatusStore, type StatusTab } from '../stores/statusStore'
import { useAgentEvents } from '../hooks/useAgentEvents'
import { MessageBubble } from './MessageBubble'
import { ExecutionStatus } from './ExecutionStatus'
import { SlashCommandMenu } from './SlashCommandMenu'
import { ContextMenu } from './ContextMenu'
import { PlusIcon, XIcon, SendIcon, SpinnerIcon, BotIcon, FolderIcon } from './icons'
import { AgentSelector } from './AgentSelector'
import { ModeSelector } from './ModeSelector'
import { ApprovalPrompt } from './ApprovalPrompt'
import { useAgentStore } from '../stores/agentStore'

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

const POLL_INTERVAL_MS = 600
const POLL_MAX_ATTEMPTS = 120
const TERMINAL_STATUSES = ['done', 'failed', 'suspended']

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// errText renders an unknown error value as a string for system notices.
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function ChatPanel() {
  useAgentEvents()

  const messages = useChatStore((s) => s.messages)
  const addMessage = useChatStore((s) => s.addMessage)
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
  const finishRun = useRunStore((s) => s.finishRun)
  const tick = useRunStore((s) => s.tick)

  const currentRun = currentSessionId ? runs[currentSessionId] : undefined
  const sending = currentRun?.running ?? false

  const [input, setInput] = useState('')
  // Selected images for the next message, held as data URIs
  // ("data:image/...;base64,...") so they can be sent straight to the backend
  // and previewed inline. Cleared after a successful send.
  const [images, setImages] = useState<string[]>([])
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
    if (!currentSessionId) return
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
      if (!currentSessionId) return
      try {
        const turns = await GetSessionTurns(currentSessionId)
        if (cancelled) return
        for (const turn of turns || []) {
          const role = String((turn as any)?.role ?? '')
          const content = String((turn as any)?.content ?? '')
          const createdAt = String((turn as any)?.created_at ?? '')
          if (role !== 'user' && role !== 'assistant') continue
          addMessage({
            id: `${currentSessionId}-${role}-${createdAt}`,
            role,
            content,
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
            if (role !== 'user' && role !== 'assistant') continue
            addMessage({ id: `${currentSessionId}-${role}-${createdAt}`, role, content })
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
    const userContent = pendingImages.length > 0 ? `${prompt}\n[附图 ${pendingImages.length} 张]` : prompt
    addMessage({ id: `user-${Date.now()}`, role: 'user', content: userContent })
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

    try {
      const agentID = useAgentStore.getState().selected
      const taskID = await SubmitTask(prompt, sessionID, pendingImages, agentID)

      let status = ''
      let result = ''
      let totalTokens = 0
      let promptTokens = 0
      let completionTokens = 0
      let cachedTokens = 0
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
        await delay(POLL_INTERVAL_MS)
        const res = await GetTaskResult(taskID)
        status = String(res?.status ?? '')
        result = String(res?.result ?? '')
        totalTokens = Number(res?.total_tokens ?? 0)
        promptTokens = Number(res?.prompt_tokens ?? 0)
        completionTokens = Number(res?.completion_tokens ?? 0)
        cachedTokens = Number(res?.cached_tokens ?? 0)
        updateRun(sessionID, totalTokens)
        if (TERMINAL_STATUSES.includes(status)) break
      }

      const content =
        result.trim() ||
        (status === 'failed'
          ? '任务执行失败，未返回结果。'
          : status
            ? `任务状态: ${status}，暂无结果。`
            : '等待结果超时。')

      // Only append to the live view if the target session is still the one on
      // screen; otherwise the answer is already persisted as a turn and will
      // reappear when the user switches back.
      if (useSessionStore.getState().currentSessionId === sessionID) {
        addMessage({
          id: `assistant-${taskID}`,
          role: 'assistant',
          content,
          meta: {
            elapsedSec: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
            promptTokens,
            completionTokens,
            cachedTokens,
            totalTokens,
          },
        })
      }
    } catch (err) {
      if (useSessionStore.getState().currentSessionId === sessionID) {
        addMessage({
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          content: `发送失败: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    } finally {
      finishRun(sessionID)
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
          messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
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
            className="interactive flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90 disabled:opacity-50"
            onClick={sendMessage}
            disabled={sending}
            aria-label={sending ? '发送中' : '发送消息'}
          >
            {sending ? <SpinnerIcon /> : <SendIcon />}
            <span>{sending ? '发送中' : '发送'}</span>
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
        </div>
      </div>
    </div>
  )
}
