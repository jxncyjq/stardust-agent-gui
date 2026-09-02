import type { TrajectoryTurnGroup } from '../../stores/trajectoryStore'
import { TrajectoryTurn } from './TrajectoryTurn'

interface TrajectoryTableProps {
  turns: TrajectoryTurnGroup[]
  sessionID: string
}

/**
 * TrajectoryTable 按 props 给的顺序渲染每个轮次分组（排序是 store 的事，这里不重排——
 * 重排一次等于把 store 的分组契约复制一份，两份迟早会不一致）。
 *
 * 空列表说明「这条会话还没有轨迹」，而不是留一片空白：空白既可能是没事件，也可能是
 * 取数挂了，看的人分不出来。
 */
export function TrajectoryTable({ turns, sessionID }: TrajectoryTableProps) {
  if (turns.length === 0) {
    return <p className="p-2 text-xs text-muted-foreground">这条会话还没有轨迹。</p>
  }
  return (
    <div className="flex flex-col divide-y divide-border">
      {turns.map((g) => (
        <TrajectoryTurn key={g.turn} group={g} sessionID={sessionID} />
      ))}
    </div>
  )
}
