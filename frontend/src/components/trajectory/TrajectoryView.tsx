import { useMemo, useState } from 'react'
import { useSessionEvents } from '../../hooks/useSessionEvents'
import { useTrajectoryStore, type SessionEvent } from '../../stores/trajectoryStore'
import { TrajectoryTable } from './TrajectoryTable'
import { TrajectoryTimeline } from './TrajectoryTimeline'
import { TrajectoryToolbar } from './TrajectoryToolbar'

interface TrajectoryViewProps {
  /** 当前会话；null（或空串）表示还没选会话。 */
  sessionID: string | null
}

/**
 * SEARCH_FIELDS 是事件里**看得见的正文**所在的约定字段：user/assistant 的 content、
 * tool/call 的 name 与 arguments、tool/result 的 preview。事件的 type 单独搜（它不在
 * data 里）。
 *
 * 只搜可见文本，是因为搜索的语义是「我刚在屏幕上看到的那一条」——把整条事件的
 * JSON 拿去 includes 会让 call_id、turn 号这类内部字段也命中，搜出来的行看不出
 * 为什么被搜到。
 */
const SEARCH_FIELDS = ['content', 'name', 'arguments', 'preview'] as const

/**
 * matchesQuery 判断一条事件是否命中搜索词（大小写不敏感）。
 *
 * 约定字段不是字符串时这里只是「不匹配」，不报错也不猜：坏数据的判定与显示是
 * TrajectoryCell 的职责（它渲染成 BAD 行），搜索框不该同时是第二个校验器——两处
 * 各判一次，迟早判得不一样。
 */
function matchesQuery(event: SessionEvent, needle: string): boolean {
  if (event.type.toLowerCase().includes(needle)) return true
  for (const field of SEARCH_FIELDS) {
    const value = event.data[field]
    if (typeof value === 'string' && value.toLowerCase().includes(needle)) return true
  }
  return false
}

/**
 * TrajectoryView 是轨迹的组装层：自己取数（useSessionEvents）、自己订阅（同上，它订的是
 * agent:session_event 专用频道）、自己持有搜索词，把数据分发给三个纯展示组件。
 *
 * **搜索是客户端的**（spec §7）：在**已加载的事件**里过滤，不发新请求。用户搜的是
 * 「我刚看到的这些」；「整个历史」是模型那边 server 侧 FTS5 的事，不在本期。
 *
 * **过滤后仍按 turn 分组**：过滤的是每个分组内部的事件、再丢掉空分组，而不是把命中的
 * 事件拍平成一个列表——拍平会丢掉「这一条属于哪一轮」，而那正是轨迹视图存在的理由。
 * 分组与排序仍是 store 的事，这里只做减法，不重新分组。
 *
 * 工具条与时间线拿的是**未过滤**的全量事件：Duration / Turns / Calls 和三条密度带回答
 * 的是「这条会话跑了多久、多少轮、多少次工具」，那是会话级的事实。让它们跟着搜索框跳，
 * 等于让同一行里的输入改写它自己旁边的统计——而且用首尾命中事件算出来的 Duration
 * 是「两次命中之间的间隔」，不是这条轨迹的时长。
 */
export function TrajectoryView({ sessionID }: TrajectoryViewProps) {
  // hook 必须无条件调用；sessionID 为空时由它内部短路（不发请求、不订阅）。
  useSessionEvents(sessionID)
  const events = useTrajectoryStore((s) => s.events)
  const turns = useTrajectoryStore((s) => s.turns)
  const gapDetected = useTrajectoryStore((s) => s.gapDetected)
  const [query, setQuery] = useState('')

  const needle = query.trim().toLowerCase()
  const filteredTurns = useMemo(() => {
    if (needle === '') return turns
    return turns
      .map((group) => ({ turn: group.turn, events: group.events.filter((e) => matchesQuery(e, needle)) }))
      .filter((group) => group.events.length > 0)
  }, [turns, needle])

  if (!sessionID) {
    return (
      <p className="p-3 text-xs text-muted-foreground">先选择一个会话，才能看它的轨迹。</p>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <TrajectoryToolbar
        events={events}
        turnCount={turns.length}
        query={query}
        onQueryChange={setQuery}
      />
      <TrajectoryTimeline events={events} />
      {/* 缺口是「帧漏了、正在从断点补拉」，说出来而不是让人对着一段莫名其妙的空白猜。 */}
      {gapDetected && (
        <p className="border-b border-border px-2 py-1 text-[10px] text-destructive">
          事件序号有缺口：有帧没送到，正在从断点补拉。
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {needle !== '' && filteredTurns.length === 0 ? (
          // 搜不到 ≠ 这条会话没有轨迹。用 TrajectoryTable 的空态文案会把前者说成后者。
          <p className="p-2 text-xs text-muted-foreground">没有匹配「{query}」的事件。</p>
        ) : (
          <TrajectoryTable turns={filteredTurns} sessionID={sessionID} />
        )}
      </div>
    </div>
  )
}
