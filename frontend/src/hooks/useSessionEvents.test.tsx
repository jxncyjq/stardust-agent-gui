import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  GetSessionEvents: vi.fn(),
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}))

vi.mock('../../wailsjs/go/main/App', () => ({ GetSessionEvents: mocks.GetSessionEvents }))
vi.mock('../../wailsjs/runtime/runtime', () => ({ EventsOn: mocks.EventsOn, EventsOff: mocks.EventsOff }))

import { useSessionEvents } from './useSessionEvents'
import { useTrajectoryStore } from '../stores/trajectoryStore'

const page = (events: unknown[], nextSeq: number) => ({ events, next_seq: nextSeq })

/** 取出 hook 注册在专用频道上的处理函数；订错频道时这里就是 undefined。 */
const frameHandler = () =>
  mocks.EventsOn.mock.calls.find((c) => c[0] === 'agent:session_event')?.[1] as
    | ((p: { type: string; data: string }) => void)
    | undefined

beforeEach(() => {
  vi.clearAllMocks()
  useTrajectoryStore.getState().reset()
  mocks.GetSessionEvents.mockResolvedValue(page([], 0))
})

describe('首屏', () => {
  it('挂载时按会话号拉一次事件', async () => {
    mocks.GetSessionEvents.mockResolvedValue(
      page([{ seq: 0, type: 'turn/start', time: 't', data: { turn: 0 } }], 1),
    )

    renderHook(() => useSessionEvents('sess-1'))

    await waitFor(() => expect(mocks.GetSessionEvents).toHaveBeenCalledWith('sess-1', 0, expect.any(Number)))
    await waitFor(() => expect(useTrajectoryStore.getState().events).toHaveLength(1))
  })

  it('没有会话号时不发请求', () => {
    renderHook(() => useSessionEvents(null))
    expect(mocks.GetSessionEvents).not.toHaveBeenCalled()
  })

  // trajectoryStore 是全局单例、不按 session 分区（见实现里的前提注释）。
  // 换会话时若不清空，上一条会话的事件会跟新会话的混在同一个 turns 列表里。
  it('换会话时先清空再按新会话号拉', async () => {
    mocks.GetSessionEvents.mockResolvedValue(
      page([{ seq: 0, type: 'turn/start', time: 't', data: { turn: 0 } }], 1),
    )
    const { rerender } = renderHook(({ id }: { id: string }) => useSessionEvents(id), {
      initialProps: { id: 'sess-1' },
    })
    await waitFor(() => expect(useTrajectoryStore.getState().events).toHaveLength(1))

    mocks.GetSessionEvents.mockClear()
    // 新会话第一页是空的：若没有 reset，旧会话那条会残留下来。
    mocks.GetSessionEvents.mockResolvedValue(page([], 0))
    rerender({ id: 'sess-2' })

    await waitFor(() => expect(mocks.GetSessionEvents).toHaveBeenCalledWith('sess-2', 0, expect.any(Number)))
    await waitFor(() => expect(useTrajectoryStore.getState().events).toHaveLength(0))
  })
})

describe('实时追加', () => {
  // 帧只做通知、不带内容（P4a 契约），所以收到帧要回端点拉。
  // 这条断言的是**接线**：帧来了，确实去拉了。
  //
  // 它同时是 store 那条「seq 正好接上就什么都不做」分支的守卫：seq=1 正好接上
  // 已有的 seq=0，appendFromFrame 不入列，事件能不能补上完全取决于 hook 拉不拉。
  it('收到 agent:session_event 帧后从断点续拉', async () => {
    mocks.GetSessionEvents.mockResolvedValue(
      page([{ seq: 0, type: 'turn/start', time: 't', data: { turn: 0 } }], 1),
    )
    renderHook(() => useSessionEvents('sess-1'))
    await waitFor(() => expect(useTrajectoryStore.getState().events).toHaveLength(1))

    const handler = frameHandler()
    expect(handler, 'hook 没有订阅 agent:session_event 专用频道').toBeTypeOf('function')

    mocks.GetSessionEvents.mockClear()
    mocks.GetSessionEvents.mockResolvedValue(
      page([{ seq: 1, type: 'user/message', time: 't', data: { turn: 0, content: '你好' } }], 2),
    )
    handler!({ type: 'session_event', data: JSON.stringify({ session_id: 'sess-1', seq: 1, event_type: 'user/message' }) })

    await waitFor(() => expect(mocks.GetSessionEvents).toHaveBeenCalledWith('sess-1', 1, expect.any(Number)))
    await waitFor(() => expect(useTrajectoryStore.getState().events).toHaveLength(2))
  })

  // 跳号（漏帧）同样是续拉——补的正是漏掉的那几条，而不是猜中间是什么。
  it('帧跳号时从断点补拉并把缺口补平', async () => {
    mocks.GetSessionEvents.mockResolvedValue(
      page([{ seq: 0, type: 'turn/start', time: 't', data: { turn: 0 } }], 1),
    )
    renderHook(() => useSessionEvents('sess-1'))
    await waitFor(() => expect(useTrajectoryStore.getState().events).toHaveLength(1))

    mocks.GetSessionEvents.mockClear()
    mocks.GetSessionEvents.mockResolvedValue(
      page(
        [
          { seq: 1, type: 'user/message', time: 't', data: { turn: 0 } },
          { seq: 2, type: 'assistant/message', time: 't', data: { turn: 0 } },
        ],
        3,
      ),
    )
    // seq=2 跳过了 seq=1：store 先标记 gapDetected，hook 从 nextSeq=1 补拉。
    frameHandler()!({ type: 'session_event', data: JSON.stringify({ session_id: 'sess-1', seq: 2 }) })

    await waitFor(() => expect(mocks.GetSessionEvents).toHaveBeenCalledWith('sess-1', 1, expect.any(Number)))
    await waitFor(() => expect(useTrajectoryStore.getState().events).toHaveLength(3))
    expect(useTrajectoryStore.getState().gapDetected).toBe(false)
  })

  // 别的会话的帧不该惊动这条会话的轨迹。
  it('忽略其它会话的帧', async () => {
    renderHook(() => useSessionEvents('sess-1'))
    await waitFor(() => expect(mocks.GetSessionEvents).toHaveBeenCalled())

    const handler = frameHandler()
    mocks.GetSessionEvents.mockClear()
    handler!({ type: 'session_event', data: JSON.stringify({ session_id: 'sess-别人', seq: 9, event_type: 'turn/start' }) })

    expect(mocks.GetSessionEvents).not.toHaveBeenCalled()
  })

  // session_id 缺席不是「别的会话」，是坏数据：不能悄悄当成跨会话帧丢掉。
  it('缺 session_id 的帧被记录且不触发 pull', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderHook(() => useSessionEvents('sess-1'))
    await waitFor(() => expect(mocks.GetSessionEvents).toHaveBeenCalled())

    mocks.GetSessionEvents.mockClear()
    frameHandler()!({ type: 'session_event', data: JSON.stringify({ seq: 3, event_type: 'tool/call' }) })

    expect(spy).toHaveBeenCalled()
    expect(mocks.GetSessionEvents).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  // 别的会话的帧也不许写进全局 store：seq 拿去跟本会话的尾部比会误报缺口。
  it('其它会话的帧不改动轨迹 store', async () => {
    mocks.GetSessionEvents.mockResolvedValue(
      page([{ seq: 0, type: 'turn/start', time: 't', data: { turn: 0 } }], 1),
    )
    renderHook(() => useSessionEvents('sess-1'))
    await waitFor(() => expect(useTrajectoryStore.getState().events).toHaveLength(1))

    frameHandler()!({ type: 'session_event', data: JSON.stringify({ session_id: 'sess-别人', seq: 99 }) })

    expect(useTrajectoryStore.getState().gapDetected).toBe(false)
  })

  // 载荷不是 JSON 是坏数据。不能当成空对象塞进去（fail-loud），
  // 也不能让整个面板崩掉。
  it('坏载荷被记录而不是崩溃', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderHook(() => useSessionEvents('sess-1'))
    await waitFor(() => expect(mocks.EventsOn).toHaveBeenCalled())

    const handler = frameHandler()
    expect(() => handler!({ type: 'session_event', data: '{不是 JSON' })).not.toThrow()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  // seq 缺席不是「可选」，是坏数据：不能拿 0 顶上去当续读点。
  it('缺 seq 的帧被记录而不是当成 0', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderHook(() => useSessionEvents('sess-1'))
    await waitFor(() => expect(mocks.GetSessionEvents).toHaveBeenCalled())

    mocks.GetSessionEvents.mockClear()
    frameHandler()!({ type: 'session_event', data: JSON.stringify({ session_id: 'sess-1' }) })

    expect(spy).toHaveBeenCalled()
    expect(mocks.GetSessionEvents).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('fail-loud', () => {
  // 拉取失败（例如 404：会话不存在）必须记录并停在原地，
  // 不许吞成「这条会话没有事件」——那是零值假装正常。
  it('拉取失败时记录错误且不把它当成空会话', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.GetSessionEvents.mockRejectedValue(new Error('status 404: session not found'))

    renderHook(() => useSessionEvents('sess-1'))

    await waitFor(() => expect(spy).toHaveBeenCalled())
    // 没有 loadPage：nextSeq 还停在 0，下一帧会再触发一次。
    expect(useTrajectoryStore.getState().nextSeq).toBe(0)
    // 失败还得写进 store，否则界面上只剩一个空列表，与「这条会话真的没有事件」
    // 长得一模一样。用户看得见的那一半由 TrajectoryView.test.tsx 钉住。
    expect(useTrajectoryStore.getState().error).toContain('404')
    spy.mockRestore()
  })

  // seq 是 store 的主键（去重、连续性判定、缺口标记全靠它）。条目缺 seq 时若照塞，
  // mergeBySeq 会把它们折叠到 undefined 一个键上、gapDetected 静静变 true——
  // 坏数据无声地改写 store 状态。
  it('事件条目缺 seq 时记录错误而不是塞进 store', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.GetSessionEvents.mockResolvedValue(
      page([{ type: 'turn/start', time: 't', data: { turn: 0 } }], 1),
    )

    renderHook(() => useSessionEvents('sess-1'))

    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(useTrajectoryStore.getState().events).toHaveLength(0)
    expect(useTrajectoryStore.getState().error).not.toBeNull()
    spy.mockRestore()
  })

  // next_seq 是端点契约里必给的字段（截断时指向被截掉的第一条）。它缺席是
  // 数据损坏，不能拿 fromSeq 顶上去接着跑。
  it('响应缺 next_seq 时记录错误而不是猜一个续读点', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.GetSessionEvents.mockResolvedValue({
      events: [{ seq: 0, type: 'turn/start', time: 't', data: { turn: 0 } }],
    })

    renderHook(() => useSessionEvents('sess-1'))

    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(useTrajectoryStore.getState().events).toHaveLength(0)
    spy.mockRestore()
  })

  // events 不是数组同样是坏数据：直接塞进 store 会让整个轨迹视图炸在渲染里。
  // 用可迭代但非数组的坏值（字符串）——不可迭代的坏值（如普通对象）没有守卫
  // 也会在 mergeBySeq 的 for-of 里抛出、被 catch 接住,那样测试就测不出守卫
  // 是否存在（见复审 I-2：删掉守卫这条测试照样绿）。
  it('events 不是数组时记录错误而不是塞进 store', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.GetSessionEvents.mockResolvedValue({ events: 'ab', next_seq: 1 })

    renderHook(() => useSessionEvents('sess-1'))

    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(useTrajectoryStore.getState().events).toHaveLength(0)
    spy.mockRestore()
  })

  // Go 的 nil slice 编成 JSON 是 null，这是「零事件」的合法表示，不是损坏。
  it('events 为 null 当成空页而不是报错', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.GetSessionEvents.mockResolvedValue({ events: null, next_seq: 0 })

    renderHook(() => useSessionEvents('sess-1'))

    await waitFor(() => expect(mocks.GetSessionEvents).toHaveBeenCalled())
    await waitFor(() => expect(useTrajectoryStore.getState().events).toHaveLength(0))
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('卸载', () => {
  it('卸载时退订', async () => {
    const { unmount } = renderHook(() => useSessionEvents('sess-1'))
    await waitFor(() => expect(mocks.EventsOn).toHaveBeenCalled())
    unmount()
    expect(mocks.EventsOff).toHaveBeenCalledWith('agent:session_event')
  })

  it('卸载后到达的响应不再写 store', async () => {
    let resolvePage: (p: unknown) => void = () => {}
    mocks.GetSessionEvents.mockReturnValue(
      new Promise((resolve) => {
        resolvePage = resolve
      }),
    )
    const { unmount } = renderHook(() => useSessionEvents('sess-1'))
    await waitFor(() => expect(mocks.GetSessionEvents).toHaveBeenCalled())
    unmount()

    resolvePage(page([{ seq: 0, type: 'turn/start', time: 't', data: { turn: 0 } }], 1))
    await Promise.resolve()
    await Promise.resolve()
    expect(useTrajectoryStore.getState().events).toHaveLength(0)
  })
})
