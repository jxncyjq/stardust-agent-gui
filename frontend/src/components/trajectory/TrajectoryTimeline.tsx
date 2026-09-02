import type { SessionEvent } from '../../stores/trajectoryStore'

interface TrajectoryTimelineProps {
  events: SessionEvent[]
}

interface Band {
  key: string
  label: string
  tickClass: string
  matches: (type: string) => boolean
}

/**
 * BANDS 是顶部的三条密度带。它只是**取景框**，不是完整视图：不落在任何一条带子里的
 * 事件（turn/* 、step/* 、以及将来新增的类型）并没有被丢掉——TrajectoryTable 逐条渲染
 * 它们。密度带回答的是「这段轨迹里输入/模型/工具各占多少」，不是「有哪些事件」。
 */
const BANDS: Band[] = [
  {
    key: 'input',
    label: 'Input',
    tickClass: 'bg-primary/60',
    matches: (t) => t === 'user/message',
  },
  {
    key: 'model',
    label: 'Model',
    tickClass: 'bg-emerald-500/60',
    matches: (t) => t === 'assistant/message',
  },
  {
    key: 'tools',
    label: 'Tools',
    tickClass: 'bg-amber-500/60',
    // 一次工具往返是「调用 + 结果」两条事件，两条都算进工具密度。
    matches: (t) => t === 'tool/call' || t === 'tool/result',
  },
]

/**
 * TrajectoryTimeline 画三条密度带：每条带子上，属于它的事件各占一个刻度，按 seq 顺序
 * 排开。纯展示，数据从 props 来。
 */
export function TrajectoryTimeline({ events }: TrajectoryTimelineProps) {
  return (
    <div className="flex flex-col gap-1 border-b border-border px-2 py-1.5">
      {BANDS.map((band) => {
        const hits = events.filter((e) => band.matches(e.type))
        return (
          <div key={band.key} data-band={band.key} className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-[10px] text-muted-foreground">{band.label}</span>
            <div className="flex min-h-3 flex-1 items-center gap-px overflow-hidden">
              {hits.map((e) => (
                <span
                  key={e.seq}
                  data-tick={e.seq}
                  title={`#${e.seq} ${e.type}`}
                  className={`h-3 w-1 shrink-0 rounded-sm ${band.tickClass}`}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
