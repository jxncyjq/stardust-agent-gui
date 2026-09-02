import { useEffect } from 'react'
import { GetSessionEvents } from '../../wailsjs/go/main/App'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import { useTrajectoryStore, type SessionEvent } from '../stores/trajectoryStore'

/** 一页拉多少条。spec §7 定了「虚拟滚动先不做，靠 limit 分页压住每屏事件数」。 */
const PAGE_LIMIT = 500

/** 失败说明在界面上占的最大长度：错误体可能是整段 JSON，别让它把面板撑爆。 */
const REASON_MAX = 300

/** describeFailure 把抛出来的东西压成一句给人看的话（原样的对象在界面上是 [object Object]）。 */
function describeFailure(detail: unknown): string {
  const text =
    detail instanceof Error
      ? detail.message
      : typeof detail === 'string'
        ? detail
        : safeStringify(detail)
  return text.length > REASON_MAX ? `${text.slice(0, REASON_MAX)}…` : text
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * useSessionEvents 把一条会话的事件喂给轨迹 store。
 *
 * 首屏拉一次；之后订阅 agent:session_event 专用频道——**不订通用 agent:event**，
 * 那条频道每个流式 token 一条，会让轨迹在模型说话时被反复唤醒。
 *
 * 帧只做通知、不带事件内容（P4a 的契约），所以收到帧后从 store 的 nextSeq
 * 续拉。跳号时同样是续拉——补的正是漏掉的那几条，而不是猜。
 *
 * **前提：trajectoryStore 是全局单例、不按 session 分区**（`events`/`turns` 不带
 * 会话标识，`appendFromFrame` 的 sessionID 参数只作调用方的自证、store 内部忽略）。
 * 于是「只把当前会话的数据喂进去」这件事只能由调用方保证，本 hook 就是那个唯一的
 * 调用方，它守两条：
 *   1. 处理帧之前先比对 `session_id`，别的会话的帧一律丢弃（否则别人的 seq 会拿去
 *      跟本会话的尾部比，误报 gapDetected；或经 loadPage 把跨会话事件混进 turns）；
 *   2. sessionID 变化时先 `reset()` 再拉新会话的首屏，不让上一条会话的事件残留。
 * 若将来有第二个调用方（比如同时开两个轨迹面板），这个前提就不成立了，届时要给
 * store 加显式的 session 分区，而不是在这里再加一层过滤。
 */
export function useSessionEvents(sessionID: string | null) {
  useEffect(() => {
    if (!sessionID) return
    let cancelled = false

    /**
     * fail 是取数路径上**唯一**的失败出口：控制台留一份给排查者，store 留一份给用户。
     *
     * 只写 console.error 是不够的——Wails 生产构建里用户看不到 devtools 控制台，
     * 那份记录对他等于不存在，界面上剩下的只有一个空列表，与「这条会话真的没有事件」
     * 长得一模一样。绑定为区分 404 与空列表专门加了 apiGetStatusChecked，这里必须
     * 把那个区分一路带到界面上。
     */
    const fail = (what: string, detail: unknown) => {
      console.error(`${what}:`, detail)
      // 已经切走的会话不再改 store：新会话刚 reset 过，这里写进去就成了挂在别人
      // 头上的错误。日志仍然留着——失败不因为用户切走而消失。
      if (cancelled) return
      useTrajectoryStore.getState().setError(`${what}：${describeFailure(detail)}`)
    }

    const pull = async (fromSeq: number) => {
      try {
        const page = await GetSessionEvents(sessionID, fromSeq, PAGE_LIMIT)
        if (cancelled) return
        // events 为 null/缺席是「零事件」的合法表示（Go 的 nil slice 编成 null），
        // 但它是别的类型就是坏数据——照原样塞进 store 会让轨迹视图炸在渲染里。
        const events = (page?.events ?? []) as SessionEvent[]
        if (!Array.isArray(events)) {
          fail(`会话 ${sessionID} 的事件页 events 不是数组`, page)
          return
        }
        // 每条事件的 seq 是 store 的主键：分页去重、连续性判定、缺口标记全靠它。
        // 缺席或不是数字时 mergeBySeq 会把这些条目折叠到 undefined 一个键上、连续性
        // 判定得 NaN、gapDetected 静静变 true——坏数据无声地改写 store 状态。
        // server 侧 seq 是必给的 int64，所以这条路径现实中不可达；但只要将来多一个
        // 数据源（离线导入、别的端点），它就可达，而那时的症状会是「事件莫名消失」。
        if (events.some((e) => typeof e?.seq !== 'number' || !Number.isFinite(e.seq))) {
          fail(`会话 ${sessionID} 的事件页里有条目缺少 seq`, page)
          return
        }
        // next_seq 是端点契约里必给的续读点（截断时指向被截掉的第一条）。它缺席
        // 或不是数字就是坏数据，不能拿 fromSeq 顶上去接着跑——那样下一次续拉会从
        // 错的位置开始，静静地漏事件。
        const nextSeq = Number(page?.next_seq)
        if (!Number.isFinite(nextSeq)) {
          fail(`会话 ${sessionID} 的事件页缺少 next_seq`, page)
          return
        }
        useTrajectoryStore.getState().loadPage(events, nextSeq)
      } catch (err) {
        // 拉不到就是拉不到：记录、写进 store、停在原地，让下一帧再触发一次。
        // 不要把它吞成「这条会话没有事件」——那是 fail-loud 铁律禁止的零值假装正常。
        // （绑定对 404 会抛错，正是为了让这里区分「会话不存在」与「空列表」。）
        fail(`加载会话 ${sessionID} 的事件失败`, err)
      }
    }

    useTrajectoryStore.getState().reset()
    void pull(0)

    const onFrame = (payload: { type: string; data: string }) => {
      let parsed: { session_id?: string; seq?: number }
      try {
        parsed = JSON.parse(payload.data)
      } catch (err) {
        console.error('agent:session_event 载荷不是合法 JSON:', payload, err)
        return
      }
      // session_id 是端点契约必给字段，缺席/非字符串是坏数据，必须记录——
      // 否则服务端哪天改了字段名或漏发，轨迹会静静地不更新、不报任何错。
      if (typeof parsed.session_id !== 'string' || parsed.session_id === '') {
        console.error('agent:session_event 载荷缺少 session_id:', payload)
        return
      }
      // 见上方前提：全局 store 没有会话分区，跨会话的帧到此为止。别的会话的帧是
      // 正常流量，安静丢弃、不打日志——记了会刷屏。
      if (parsed.session_id !== sessionID) return
      const seq = Number(parsed.seq)
      if (!Number.isFinite(seq)) {
        console.error('agent:session_event 载荷缺少 seq:', payload)
        return
      }
      // appendFromFrame 只判缺口、不入列（帧不带内容），「seq 正好接上」那条分支
      // 什么都不做——事件能不能补上，全靠紧接着这次 pull。别把它删了。
      useTrajectoryStore.getState().appendFromFrame(sessionID, seq)
      void pull(useTrajectoryStore.getState().nextSeq)
    }

    EventsOn('agent:session_event', onFrame)
    return () => {
      cancelled = true
      EventsOff('agent:session_event')
    }
  }, [sessionID])
}
