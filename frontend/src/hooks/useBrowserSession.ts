import { useEffect } from 'react'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import { useBrowserStore } from '../stores/browserStore'

// useBrowserSession 监听后端 browser:session 生命周期事件（经 Go sse_bridge 转发），
// 据此设置/清空当前浏览器视图的 sessionId。挂在 App 顶层（与 useAgentEvents 并列）。
export function useBrowserSession() {
  const setSession = useBrowserStore((s) => s.setSession)
  useEffect(() => {
    const handle = (payload: { type: string; data: string }) => {
      let parsed: { session_id?: string }
      try {
        parsed = JSON.parse(payload.data)
      } catch (err) {
        console.error('browser:session payload not JSON:', payload, err)
        return
      }
      if (payload.type === 'browser:session_opened' && parsed.session_id) {
        setSession(parsed.session_id)
      } else if (payload.type === 'browser:session_closed') {
        // 只在关的是当前会话时清空
        if (useBrowserStore.getState().sessionId === parsed.session_id) setSession(null)
      }
    }
    EventsOn('browser:session', handle)
    return () => EventsOff('browser:session')
  }, [setSession])
}
