import { useEffect } from 'react'
import { GetSessionEvents } from '../../wailsjs/go/main/App'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import { useTrajectoryStore, type SessionEvent } from '../stores/trajectoryStore'

/** 一页拉多少条。spec §7 定了「虚拟滚动先不做，靠 limit 分页压住每屏事件数」。 */
const PAGE_LIMIT = 500

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

    const pull = async (fromSeq: number) => {
      try {
        const page = await GetSessionEvents(sessionID, fromSeq, PAGE_LIMIT)
        if (cancelled) return
        // events 为 null/缺席是「零事件」的合法表示（Go 的 nil slice 编成 null），
        // 但它是别的类型就是坏数据——照原样塞进 store 会让轨迹视图炸在渲染里。
        const events = (page?.events ?? []) as SessionEvent[]
        if (!Array.isArray(events)) {
          console.error(`会话 ${sessionID} 的事件页 events 不是数组:`, page)
          return
        }
        // next_seq 是端点契约里必给的续读点（截断时指向被截掉的第一条）。它缺席
        // 或不是数字就是坏数据，不能拿 fromSeq 顶上去接着跑——那样下一次续拉会从
        // 错的位置开始，静静地漏事件。
        const nextSeq = Number(page?.next_seq)
        if (!Number.isFinite(nextSeq)) {
          console.error(`会话 ${sessionID} 的事件页缺少 next_seq:`, page)
          return
        }
        useTrajectoryStore.getState().loadPage(events, nextSeq)
      } catch (err) {
        // 拉不到就是拉不到：记录并停在原地，让下一帧再触发一次。
        // 不要把它吞成「这条会话没有事件」——那是 fail-loud 铁律禁止的零值假装正常。
        // （绑定对 404 会抛错，正是为了让这里区分「会话不存在」与「空列表」。）
        console.error(`加载会话 ${sessionID} 的事件失败:`, err)
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
      // 见上方前提：全局 store 没有会话分区，跨会话的帧到此为止。
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
