import { create } from 'zustand'

export interface SessionEvent {
  seq: number
  type: string
  time: string
  data: Record<string, unknown>
}

export interface TrajectoryTurnGroup {
  turn: number
  events: SessionEvent[]
}

interface TrajectoryState {
  events: SessionEvent[]
  turns: TrajectoryTurnGroup[]
  /**
   * nextSeq 是服务端给的续读点。截断时它指向**被截掉的第一条**（P4a 的契约），
   * 所以前端据此翻页不会漏。
   */
  nextSeq: number
  /**
   * gapDetected 表示实时帧的 seq 跳过了若干条——SSE 帧只做通知、不保证送达，
   * 发现缺口就回端点从断点补拉，而不是猜中间是什么。
   */
  gapDetected: boolean
  loadPage: (events: SessionEvent[], nextSeq: number) => void
  appendFromFrame: (sessionID: string, seq: number) => void
  reset: () => void
}

/** groupByTurn 把事件按 data.turn 分组，组内保持 seq 顺序。 */
function groupByTurn(events: SessionEvent[]): TrajectoryTurnGroup[] {
  const groups = new Map<number, SessionEvent[]>()
  for (const e of events) {
    // turn 是事件载荷的约定字段（spec §4.1：turn 每会话单调）。它缺席是数据
    // 损坏而不是可选，但前端不该因此白屏——归到 -1 组并让它显式地显示出来。
    const turn = typeof e.data?.turn === 'number' ? e.data.turn : -1
    const bucket = groups.get(turn)
    if (bucket) bucket.push(e)
    else groups.set(turn, [e])
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, evs]) => ({ turn, events: evs }))
}

/** mergeBySeq 合并两批事件：seq 唯一，重复的丢弃，结果按 seq 升序。 */
function mergeBySeq(existing: SessionEvent[], incoming: SessionEvent[]): SessionEvent[] {
  const bySeq = new Map<number, SessionEvent>()
  for (const e of existing) bySeq.set(e.seq, e)
  for (const e of incoming) bySeq.set(e.seq, e)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

export const useTrajectoryStore = create<TrajectoryState>((set, get) => ({
  events: [],
  turns: [],
  nextSeq: 0,
  gapDetected: false,

  loadPage: (incoming, nextSeq) => {
    const events = mergeBySeq(get().events, incoming)
    // 补完之后重新判定缺口：seq 从 0 起连续（P1 的不变量），所以
    // 「最后一条的 seq + 1 === 条数」等价于「没有洞」。
    const contiguous = events.length === 0 || events[events.length - 1].seq + 1 === events.length
    set({ events, turns: groupByTurn(events), nextSeq, gapDetected: !contiguous })
  },

  appendFromFrame: (_sessionID, seq) => {
    const { events } = get()
    const expected = events.length === 0 ? 0 : events[events.length - 1].seq + 1
    if (seq > expected) {
      // 跳号了：帧漏了。标记出来，由 useSessionEvents 回端点补拉。
      set({ gapDetected: true })
      return
    }
    // seq <= expected：这一条要么已经有了（补拉先到），要么正好接上。
    // 帧本身不带事件内容（P4a 的契约：帧只做通知），所以这里不入列，
    // 由调用方拉取后经 loadPage 进来。
  },

  reset: () => set({ events: [], turns: [], nextSeq: 0, gapDetected: false }),
}))
