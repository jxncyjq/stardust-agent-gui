import type { SessionEvent } from '../../stores/trajectoryStore'

interface TrajectoryToolbarProps {
  events: SessionEvent[]
  /** 轮次数由调用方给（store 的分组数），工具栏不自己分组。 */
  turnCount: number
  query: string
  onQueryChange: (q: string) => void
}

/** DURATION_PLACEHOLDER 是「没有事件所以没有时长」，与「算不出来」区分开。 */
const DURATION_PLACEHOLDER = '—'

/**
 * formatDuration 用首尾事件的时间差算时长。
 *
 * time 是端点契约里的必给字段，解析不出来就是坏数据：显式说「时间戳无效」，
 * 不许把 NaN 当 0 显示成「0.0s」——那是零值假装正常。
 */
function formatDuration(events: SessionEvent[]): string {
  if (events.length === 0) return DURATION_PLACEHOLDER
  const first = Date.parse(events[0].time)
  const last = Date.parse(events[events.length - 1].time)
  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    console.error('轨迹事件的 time 字段解析不出来:', events[0].time, events[events.length - 1].time)
    return '时间戳无效'
  }
  const ms = last - first
  if (ms < 0) {
    // seq 升序而时间倒流：不是「负时长」，是数据有问题。
    console.error('轨迹首尾事件的时间倒流:', events[0].time, events[events.length - 1].time)
    return '时间戳无效'
  }
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span data-testid={testId} className="font-mono text-xs text-foreground">
        {value}
      </span>
    </div>
  )
}

/**
 * TrajectoryToolbar 是轨迹视图顶部的一行：Duration / Turns / Calls + 搜索框。
 *
 * 纯展示：搜索词由调用方持有（受控 input），这里只把输入交出去——过滤发生在
 * 组装层，工具栏不该同时是数据源又是过滤器。
 */
export function TrajectoryToolbar({ events, turnCount, query, onQueryChange }: TrajectoryToolbarProps) {
  const callCount = events.filter((e) => e.type === 'tool/call').length
  return (
    <div className="flex items-center gap-4 border-b border-border px-2 py-1.5">
      <Stat label="Duration" value={formatDuration(events)} testId="trajectory-duration" />
      <Stat label="Turns" value={String(turnCount)} />
      <Stat label="Calls" value={String(callCount)} />
      <input
        type="search"
        aria-label="搜索轨迹"
        placeholder="搜索轨迹"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        className="ml-auto w-48 rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground placeholder:text-muted-foreground"
      />
    </div>
  )
}
