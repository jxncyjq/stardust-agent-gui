import type { TrajectoryTurnGroup } from '../../stores/trajectoryStore'
import { TrajectoryCell } from './TrajectoryCell'

interface TrajectoryTurnProps {
  group: TrajectoryTurnGroup
  sessionID: string
}

/**
 * TrajectoryTurn 渲染一个轮次：左侧 "Turn N" 标记，右侧组内每条事件一行。
 *
 * turn 为负数是 store 给「事件缺 turn 字段」留的桶（groupByTurn 归到 -1）。那是数据
 * 损坏而不是可选，所以标签显式写成 "Turn ?" 并说明它坏在哪——渲染成一个看着正常的
 * "Turn -1" 等于把坏数据伪装成正常轮次。
 */
export function TrajectoryTurn({ group, sessionID }: TrajectoryTurnProps) {
  const orphan = group.turn < 0
  return (
    <div className="flex gap-2 py-1">
      <div className="w-20 shrink-0 pt-1">
        <span
          data-turn-label
          className={
            orphan
              ? 'font-mono text-[10px] text-destructive'
              : 'font-mono text-[10px] text-muted-foreground'
          }
        >
          {orphan ? 'Turn ?' : `Turn ${group.turn}`}
        </span>
        {orphan && <p className="mt-0.5 text-[10px] text-destructive">这些事件缺少 turn 字段</p>}
      </div>
      <div className="min-w-0 flex-1">
        {group.events.map((e) => (
          <TrajectoryCell key={e.seq} event={e} sessionID={sessionID} />
        ))}
      </div>
    </div>
  )
}
