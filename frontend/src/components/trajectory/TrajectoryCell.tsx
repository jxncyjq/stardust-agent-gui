import { useState, type ReactNode } from 'react'
import { FetchPreviewFile } from '../../../wailsjs/go/main/App'
import { cn } from '../../lib/utils'
import type { SessionEvent } from '../../stores/trajectoryStore'

const BADGE = 'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono leading-4'
const ACTION_BTN =
  'interactive rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-background hover:text-foreground'

interface TrajectoryCellProps {
  event: SessionEvent
  /** 取全文时要用它定位会话；见 SpillLink。 */
  sessionID: string
}

/** str 取一个约定的字符串字段；不是字符串（含缺席）就返回 null 交给调用方 fail-loud。 */
function str(data: Record<string, unknown>, key: string): string | null {
  const v = data[key]
  return typeof v === 'string' ? v : null
}

/**
 * Row 是所有事件行共用的骨架：左徽章 + 右正文。
 * 徽章文本单独成一个文本节点，好让「USER」这类断言精确命中。
 */
function Row({ badge, badgeClass, children }: { badge: string; badgeClass: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 border-b border-border px-1 py-1 text-xs">
      <span className={cn(BADGE, badgeClass)}>{badge}</span>
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  )
}

/**
 * RawJSON 把整条事件折叠起来，**默认不渲染**内容——展开才渲染。
 * 不用 `hidden` 的 details 是因为那样原始 JSON 一直在 DOM 里，
 * 一条事件的类型名会同时出现在摘要行和 JSON 里，读起来（和查起来）都是重复的。
 */
function RawJSON({ event }: { event: SessionEvent }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-1">
      <button type="button" className={ACTION_BTN} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '收起原始 JSON' : '原始 JSON'}
      </button>
      {open && (
        <pre className="mt-1 max-h-64 overflow-auto rounded bg-background/60 p-1 font-mono text-[10px] text-muted-foreground">
          {JSON.stringify(event, null, 2)}
        </pre>
      )}
    </div>
  )
}

/**
 * Malformed 是 fail-loud 的显示面：约定字段缺席/类型不对不是「空」，是坏数据。
 * 渲染成醒目的一行 + 可展开的原始 JSON，而不是悄悄渲染成空白。
 */
function Malformed({ event, field }: { event: SessionEvent; field: string }) {
  return (
    <Row badge="BAD" badgeClass="bg-destructive/15 text-destructive">
      <p className="text-destructive">
        事件 #{event.seq}（{event.type}）的 {field} 字段缺失或类型不对
      </p>
      <RawJSON event={event} />
    </Row>
  )
}

type SpillState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'text'; text: string }
  | { phase: 'binary' }
  | { phase: 'unavailable' }
  | { phase: 'error'; message: string }

/** 404 的判别：Go 侧 FetchPreviewFile 把非 2xx 包成 `fetch preview %q: status %d`。 */
function isNotFound(message: string): boolean {
  return /status\s+404\b/.test(message)
}

/**
 * SpillLink 是被截断的工具结果的「查看全文」入口。
 *
 * **404 是合法结果，不是错误**：spill_locator 与 /v1/files 的两个根仅当会话绑定了
 * working_dir 时同源；未绑定的会话，定位符指向 ContextFiles.Root，而 /v1/files 对空
 * WorkingDir 直接 404——那个定位符本来就取不回来，server 侧有意不修（返回空串等于
 * 「有全文却说没有」）。所以 404 渲染成「全文不可得」的说明。
 *
 * 404 之外的失败仍然是真失败：显式报错 + console.error，不许跟「不可得」混为一谈，
 * 否则 server 真挂了也会显示成一句无害的说明。
 */
function SpillLink({ sessionID, locator }: { sessionID: string; locator: string }) {
  const [state, setState] = useState<SpillState>({ phase: 'idle' })

  const load = async () => {
    setState({ phase: 'loading' })
    try {
      const wf = await FetchPreviewFile(sessionID, locator)
      // 二进制没有文本可显示；说清楚，而不是渲染成一段空白。
      if (wf.kind === 'binary') {
        setState({ phase: 'binary' })
        return
      }
      setState({ phase: 'text', text: wf.text })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (isNotFound(message)) {
        setState({ phase: 'unavailable' })
        return
      }
      console.error(`取回 ${locator} 的全文失败:`, err)
      setState({ phase: 'error', message })
    }
  }

  return (
    <div className="mt-1">
      <button type="button" className={ACTION_BTN} disabled={state.phase === 'loading'} onClick={() => void load()}>
        {state.phase === 'loading' ? '取回中…' : '查看全文'}
      </button>
      {state.phase === 'text' && (
        <pre className="mt-1 max-h-64 overflow-auto rounded bg-background/60 p-1 font-mono text-[10px] text-foreground">
          {state.text}
        </pre>
      )}
      {state.phase === 'binary' && <p className="mt-1 text-[10px] text-muted-foreground">全文是二进制内容，无法在此显示。</p>}
      {state.phase === 'unavailable' && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          全文不可得：这条会话没有绑定工作目录，定位符指向的根与文件端点不同源。
        </p>
      )}
      {state.phase === 'error' && <p className="mt-1 text-[10px] text-destructive">取回全文失败：{state.message}</p>}
    </div>
  )
}

/** 已知的边界事件类型：它们只标出轨迹的骨架，正文很薄。 */
const BOUNDARY_TYPES = new Set(['turn/start', 'turn/end', 'step/start', 'step/end'])

/**
 * TrajectoryCell 渲染一条会话事件。纯展示：数据全从 props 来，不自己取数
 * （唯一的例外是「查看全文」——那是用户点出来的按需取数，不是首屏数据）。
 *
 * **未知类型不静默丢弃**：server 侧的事件类型是闭集但它会长；丢掉不认识的类型
 * 意味着 server 加了新类型之后轨迹会悄悄少东西而没人发现。不认识就渲染成一行
 * 并标出类型名，原始 JSON 折叠在里面。
 */
export function TrajectoryCell({ event, sessionID }: TrajectoryCellProps) {
  const { type, data } = event

  if (type === 'user/message') {
    const content = str(data, 'content')
    // user 的正文没有「合法为空」的场景（空的用户消息不会产生一轮），缺席即坏数据。
    if (content === null || content === '') return <Malformed event={event} field="content" />
    return (
      <Row badge="USER" badgeClass="bg-primary/15 text-primary">
        <p className="whitespace-pre-wrap">{content}</p>
      </Row>
    )
  }

  if (type === 'assistant/message') {
    const content = str(data, 'content')
    // 字段缺席是坏数据；字段在但为空串是**契约允许的**——P3 折叠之前的中间轮次
    // 正文就是空的。后者显示成明确的说明，不是一个看着像 bug 的空白行。
    if (content === null) return <Malformed event={event} field="content" />
    return (
      <Row badge="ASSISTANT" badgeClass="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        {content === '' ? (
          <p className="italic text-muted-foreground">（无正文）</p>
        ) : (
          <p className="whitespace-pre-wrap">{content}</p>
        )}
      </Row>
    )
  }

  if (type === 'tool/call') {
    const name = str(data, 'name')
    if (name === null || name === '') return <Malformed event={event} field="name" />
    // arguments 可以是空串（无参工具），但不能是别的类型。
    const args = str(data, 'arguments')
    if (args === null) return <Malformed event={event} field="arguments" />
    return (
      <Row badge="TOOL" badgeClass="bg-amber-500/15 text-amber-600 dark:text-amber-400">
        <p className="font-mono">{name}</p>
        {args === '' ? (
          <p className="text-[10px] text-muted-foreground">（无参数）</p>
        ) : (
          <code className="block overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
            {args}
          </code>
        )}
      </Row>
    )
  }

  if (type === 'tool/result') {
    const preview = str(data, 'preview')
    if (preview === null) return <Malformed event={event} field="preview" />
    const isError = data['is_error']
    if (typeof isError !== 'boolean') return <Malformed event={event} field="is_error" />
    // spill_locator 是契约里的可选项：结果没超长（或按渲染契约没落盘）时就是空串，
    // 那是「没有全文文件」，不是缺数据。字段整个缺席按同样的「没有全文」处理；但它
    // 在、却不是字符串，就是坏数据——不能悄悄当成「没有全文」，那会把一条取得回来的
    // 全文说成没有。
    const rawLocator = data['spill_locator']
    if (rawLocator !== undefined && typeof rawLocator !== 'string') {
      return <Malformed event={event} field="spill_locator" />
    }
    const locator = rawLocator ?? ''
    return (
      <Row
        badge="RESULT"
        badgeClass={isError ? 'bg-destructive/15 text-destructive' : 'bg-sky-500/15 text-sky-600 dark:text-sky-400'}
      >
        {isError && <span className="mr-1 rounded bg-destructive/15 px-1 text-[10px] text-destructive">出错</span>}
        <span className="whitespace-pre-wrap">{preview}</span>
        {locator !== '' && <SpillLink sessionID={sessionID} locator={locator} />}
      </Row>
    )
  }

  if (BOUNDARY_TYPES.has(type)) {
    // 边界行只给骨架：类型 + 原因（turn/end 的 reason 是可选的）。
    const reason = str(data, 'reason')
    return (
      <div className="flex items-center gap-2 border-b border-border px-1 py-0.5 text-[10px] text-muted-foreground">
        <span className="font-mono">{type}</span>
        {reason !== null && reason !== '' && <span>{reason}</span>}
      </div>
    )
  }

  return (
    <Row badge="?" badgeClass="bg-muted text-muted-foreground">
      <p>未知事件类型 {type}</p>
      <RawJSON event={event} />
    </Row>
  )
}
