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
  /**
   * error 是「这批数据没能取到」的说明，null 表示取数一切正常。
   *
   * 它存在的唯一理由：**空的 events 有两种截然不同的含义**——这条会话真的还没有
   * 事件，或者取数失败了（会话不存在、绑定报错、响应是坏数据）。绑定为此专门用
   * `apiGetStatusChecked` 把 404 与空列表分开，若 store 只留一个空数组，这个区分
   * 就在最后一层被抹掉，界面会把失败说成「这条会话还没有轨迹」——正是 fail-loud
   * 铁律禁止的「零值假装正常」。
   */
  error: string | null
  loadPage: (events: SessionEvent[], nextSeq: number) => void
  appendFromFrame: (sessionID: string, seq: number) => void
  /** setError 记下取数失败的说明，供界面显示；它不清空已加载的事件（拿到手的仍然有效）。 */
  setError: (message: string) => void
  reset: () => void
}

/** groupByTurn 把事件按 data.turn 分组，组内保持 seq 顺序。 */
function groupByTurn(events: SessionEvent[]): TrajectoryTurnGroup[] {
  const groups = new Map<number, SessionEvent[]>()
  for (const e of events) {
    // turn 是事件载荷的必给字段：server 的 eventRecorder 八个 record* 方法**全部
    // 无条件写它**（legionAgent `internal/runtime/eventlog.go`，2026-09-04 现核），
    // 每会话单调。所以它缺席是数据损坏，不是「可选字段没给」。
    //
    // 这里不引用 spec 的节号：那份 spec 在 legionAgent 仓，本仓的人翻不到，一个
    // 找不到出处的引用比没有引用更费时间。要核就核上面那个文件。
    //
    // 缺席时前端仍不该白屏——归到 -1 组并让它显式地显示出来。
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
  error: null,

  loadPage: (incoming, nextSeq) => {
    const events = mergeBySeq(get().events, incoming)
    // 补完之后重新判定缺口：seq 从 0 起连续（P1 的不变量），所以
    // 「最后一条的 seq + 1 === 条数」等价于「没有洞」。
    const contiguous = events.length === 0 || events[events.length - 1].seq + 1 === events.length
    // 这一页真的到手了，上一次失败的说明就不该继续挂在界面上。
    set({ events, turns: groupByTurn(events), nextSeq, gapDetected: !contiguous, error: null })
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

  setError: (message) => set({ error: message }),

  reset: () => set({ events: [], turns: [], nextSeq: 0, gapDetected: false, error: null }),
}))
