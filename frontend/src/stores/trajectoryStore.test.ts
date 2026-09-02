import { beforeEach, describe, expect, it } from 'vitest'
import { useTrajectoryStore } from './trajectoryStore'

const ev = (seq: number, type: string, data: Record<string, unknown> = {}) => ({
  seq,
  type,
  time: '2026-09-02T00:00:00Z',
  data: { turn: 0, ...data },
})

beforeEach(() => {
  useTrajectoryStore.getState().reset()
})

describe('按 turn 分组', () => {
  it('把事件按 data.turn 分成组，组内保持 seq 顺序', () => {
    useTrajectoryStore.getState().loadPage(
      [
        ev(0, 'turn/start', { turn: 0 }),
        ev(1, 'user/message', { turn: 0, content: '第一轮' }),
        ev(2, 'turn/end', { turn: 0, reason: 'completed' }),
        ev(3, 'turn/start', { turn: 1 }),
        ev(4, 'user/message', { turn: 1, content: '第二轮' }),
      ],
      5,
    )

    const turns = useTrajectoryStore.getState().turns
    expect(turns).toHaveLength(2)
    expect(turns[0].turn).toBe(0)
    expect(turns[0].events.map((e) => e.seq)).toEqual([0, 1, 2])
    expect(turns[1].turn).toBe(1)
    expect(turns[1].events.map((e) => e.seq)).toEqual([3, 4])
  })
})

describe('漏帧判定', () => {
  // SSE 帧只做通知，不保证送达。前端靠 seq 连续性发现漏帧，漏了回端点补拉。
  // 这条断言的是「发现」——补拉的接线是 useSessionEvents 的事。
  it('帧的 seq 不接着已有的最后一条时，标记出现缺口', () => {
    const store = useTrajectoryStore.getState()
    store.loadPage([ev(0, 'turn/start'), ev(1, 'user/message')], 2)

    store.appendFromFrame('sess-1', 2)
    expect(useTrajectoryStore.getState().gapDetected).toBe(false)

    // seq 5 跳过了 2/3/4
    store.appendFromFrame('sess-1', 5)
    expect(useTrajectoryStore.getState().gapDetected).toBe(true)
  })

  it('缺口被补上之后清除标记', () => {
    const store = useTrajectoryStore.getState()
    store.loadPage([ev(0, 'turn/start')], 1)
    store.appendFromFrame('sess-1', 4)
    expect(useTrajectoryStore.getState().gapDetected).toBe(true)

    store.loadPage([ev(1, 'user/message'), ev(2, 'step/start'), ev(3, 'assistant/message'), ev(4, 'turn/end')], 5)
    expect(useTrajectoryStore.getState().gapDetected).toBe(false)
  })
})

describe('重复与乱序', () => {
  // 补拉与实时帧可能带来同一条 seq 两次。事件是 append-only 且 seq 唯一，
  // 所以重复的那条应当被丢弃而不是渲染两行。
  it('同一个 seq 只保留一条', () => {
    const store = useTrajectoryStore.getState()
    store.loadPage([ev(0, 'turn/start'), ev(1, 'user/message')], 2)
    store.loadPage([ev(1, 'user/message'), ev(2, 'step/start')], 3)

    expect(useTrajectoryStore.getState().events.map((e) => e.seq)).toEqual([0, 1, 2])
  })
})

describe('未知事件类型', () => {
  // server 侧的类型是闭集，但它会长。静默丢弃意味着 server 加了新类型后
  // 轨迹会悄悄少东西而没人发现——这个项目栽过五次的形状。
  it('保留未知类型的事件，不丢弃', () => {
    useTrajectoryStore.getState().loadPage([ev(0, 'turn/start'), ev(1, 'session/teleport')], 2)

    const events = useTrajectoryStore.getState().events
    expect(events.map((e) => e.type)).toContain('session/teleport')
  })

  it('turn 字段缺失（非法/损坏数据）的事件仍保留在分组结果中，不因分组丢弃', () => {
    // 覆盖「groupByTurn 里未知 turn 的事件直接 continue（丢弃）」这类变异：
    // 上面的「保留未知类型」只断言 events（mergeBySeq 产物），不经过 groupByTurn，
    // 无法抓住「分组阶段丢弃未知 turn 事件」这条路径。这里构造 turn 缺失的事件，
    // 直接对 turns（groupByTurn 的产物）断言。
    useTrajectoryStore.getState().loadPage(
      [ev(0, 'turn/start', { turn: 0 }), ev(1, 'session/teleport', { turn: undefined })],
      2,
    )

    const turns = useTrajectoryStore.getState().turns
    const allTurnEvents = turns.flatMap((t) => t.events)
    expect(allTurnEvents.map((e) => e.seq)).toEqual(expect.arrayContaining([0, 1]))
    expect(allTurnEvents.map((e) => e.type)).toContain('session/teleport')
    expect(allTurnEvents).toHaveLength(2)
  })
})
