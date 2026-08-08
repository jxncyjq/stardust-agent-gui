import { useEffect } from 'react'
import { GetBrowserEndpoint } from '../../wailsjs/go/main/App'
import { useBrowserStore, type BrowserElement } from '../stores/browserStore'
import { readSSE } from '../lib/sseReader'

// useBrowserStream 在 sessionId 存在时连该会话的 SSE 流（fetch+bearer），把
// observation/frame/progress 事件写进 store；断线带 Last-Event-ID 重连（帧可丢、
// 状态由后端环形缓冲补发）。sessionId 变化/卸载时 abort。
export function useBrowserStream(sessionId: string | null) {
  const store = useBrowserStore
  useEffect(() => {
    if (!sessionId) return
    const ac = new AbortController()
    let stopped = false

    const run = async () => {
      while (!stopped) {
        try {
          const ep = await GetBrowserEndpoint()
          const url = `${ep.baseURL}/v1/browser/sessions/${sessionId}/stream`
          store.getState().setConnected(true)
          await readSSE(url, ep.token, store.getState().lastEventId, (e) => {
            if (e.id) {
              const n = Number(e.id)
              if (Number.isFinite(n)) store.getState().setLastEventId(n)
            }
            let payload: unknown
            try { payload = JSON.parse(e.data) } catch (err) { console.error('browser stream data not JSON:', e, err); return }
            if (e.event === 'frame') {
              const f = payload as { mime: string; b64: string }
              store.getState().onFrame(f.mime, f.b64)
            } else if (e.event === 'observation') {
              store.getState().onObservation(payload as { elements: BrowserElement[]; text: string })
            } else if (e.event === 'progress') {
              store.getState().onProgress(payload as { action: string; status: string; ref?: string })
            }
          }, ac.signal)
          // 正常返回（服务端 EOF 关闭流）也要退避再重连，否则零延迟狂刷端点。
          if (!stopped) await new Promise((r) => setTimeout(r, 2000))
        } catch (err) {
          if (stopped) break
          console.error('browser stream disconnected, retrying:', err)
          store.getState().setConnected(false)
          await new Promise((r) => setTimeout(r, 2000))
        }
      }
    }
    run()
    return () => { stopped = true; ac.abort(); store.getState().setConnected(false) }
  }, [sessionId, store])
}
