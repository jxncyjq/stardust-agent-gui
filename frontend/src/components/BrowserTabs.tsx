import { useCallback, useEffect, useState } from 'react'
import { BrowserSessions } from '../../wailsjs/go/main/App'

interface BrowserTabsProps {
  chatSessionId: string
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
}

interface BrowserSessionInfo {
  session_id: string
  url: string
  takeover: boolean
  has_page: boolean
}

// tabLabel 用**站点**给标签命名，而不是 session id。
//
// 用户记得住「刚才那个查天气的页面」，记不住 sess-3。URL 解析不出来时退回原样显示，
// 那也比一个 id 强。
function tabLabel(session: BrowserSessionInfo): string {
  if (session.url === '') return session.session_id
  try {
    return new URL(session.url).host || session.url
  } catch {
    return session.url
  }
}

// BrowserTabs 是一个对话里多个浏览器会话之间的切换。
//
// 在它之前，视图只认 SSE 报的**最后一个**会话：Agent 查完 A 站再查 B 站，A 站那个
// 会话就没有任何入口了——用户看不见，也回不去。
//
// 少于两个会话时它整个不渲染：一个标签的标签条只是噪声，地址栏已经说明了在哪。
export function BrowserTabs({ chatSessionId, activeSessionId, onSelect }: BrowserTabsProps) {
  const [sessions, setSessions] = useState<BrowserSessionInfo[]>([])
  const [error, setError] = useState('')

  const refresh = useCallback(() => {
    if (chatSessionId === '') return
    void BrowserSessions(chatSessionId)
      .then((raw: string) => {
        setError('')
        setSessions((JSON.parse(raw) as { sessions?: BrowserSessionInfo[] }).sessions ?? [])
      })
      // 读不到就说出来。空着不显示等于告诉用户「没有别的会话」，而真相是我们不知道
      // ——那两件事在界面上必须能分开。
      .catch((err: unknown) => setError(String(err)))
  }, [chatSessionId])

  // activeSessionId 变化时重读：Agent 新开一个会话时 SSE 会把它设成当前的，那正是
  // 标签条需要多出一格的时刻。
  useEffect(refresh, [refresh, activeSessionId])

  if (error !== '') {
    return <div className="rounded bg-destructive/15 px-2 py-1 text-xs text-destructive">{error}</div>
  }
  if (sessions.length < 2) return null

  return (
    <div role="tablist" className="flex items-center gap-1 overflow-x-auto">
      {sessions.map((session) => {
        const selected = session.session_id === activeSessionId
        return (
          <button
            key={session.session_id}
            type="button"
            role="tab"
            aria-selected={selected}
            title={session.url || session.session_id}
            onClick={() => onSelect(session.session_id)}
            className={
              'interactive shrink-0 rounded border px-2 py-0.5 text-xs ' +
              (selected
                ? 'border-primary text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted')
            }
          >
            {tabLabel(session)}
            {/* 休眠的会话标出来：它的页面已被 TTL 回收，点进去会重建——那有延迟，
                用户该先知道。 */}
            {!session.has_page && <span className="ml-1 opacity-60">·休眠</span>}
            {session.takeover && <span className="ml-1 text-amber-500">·接管中</span>}
          </button>
        )
      })}
    </div>
  )
}
