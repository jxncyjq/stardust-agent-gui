import { useCallback, useEffect, useState } from 'react'
import { BrowserNavigate, BrowserSessionInfo } from '../../wailsjs/go/main/App'

interface BrowserToolbarProps {
  sessionId: string
  takeover: boolean
  connected: boolean
}

interface SessionInfo {
  url: string
  takeover: boolean
  has_page: boolean
}

const BTN =
  'interactive rounded border border-border px-2 py-0.5 text-xs text-muted-foreground ' +
  'hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:pointer-events-none'

// BrowserToolbar 把「现在在哪」与「回上一页」交回给人。
//
// 在它之前，浏览器视图只是一个能点击的录像：界面上答不出当前地址（观测事件里没有
// URL），而后退/刷新/输入地址都得让 Agent 去做。
//
// 控件在**未接管时禁用**而不是让它 409：后端只在接管中允许人工导航（否则人和
// Agent 会互相把页面开走），而一个点了就报错的按钮比一个明确不可点的按钮更难理解。
export function BrowserToolbar({ sessionId, takeover, connected }: BrowserToolbarProps) {
  const [info, setInfo] = useState<SessionInfo | null>(null)
  const [address, setAddress] = useState('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(() => {
    if (!sessionId) return
    void BrowserSessionInfo(sessionId)
      .then((raw: string) => {
        const parsed = JSON.parse(raw) as SessionInfo
        setInfo(parsed)
        // 用户正在输入时不覆盖地址栏：把人正在敲的地址换成后端的当前地址，是最
        // 让人恼火的那类「界面自己动了」。
        if (!editing) setAddress(parsed.url)
      })
      .catch((err: unknown) => setError(String(err)))
  }, [sessionId, editing])

  // 会话变了、接管状态变了都重新读一次：那两件事都可能改变地址与页面存在与否。
  useEffect(refresh, [refresh, takeover])

  const navigate = (url: string, action: string) => {
    // 先清掉上一次的错误：一条过期的红字会一直遮住服务端的真实状态（GUI 走查里
    // 记过的教训）。
    setError('')
    void BrowserNavigate(sessionId, url, action)
      .then(() => refresh())
      .catch((err: unknown) => setError(String(err)))
  }

  const disabled = !takeover
  const sleeping = info !== null && !info.has_page

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <button type="button" className={BTN} aria-label="后退" disabled={disabled}
          onClick={() => navigate('', 'back')}>←</button>
        <button type="button" className={BTN} aria-label="前进" disabled={disabled}
          onClick={() => navigate('', 'forward')}>→</button>
        <button type="button" className={BTN} aria-label="刷新" disabled={disabled}
          onClick={() => navigate('', 'reload')}>⟳</button>
        <input
          type="text"
          aria-label="地址"
          value={address}
          disabled={disabled}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            navigate(address.trim(), '')
          }}
          placeholder={disabled ? '接管后可手动输入地址' : '输入地址后回车'}
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-0.5 text-xs
            text-foreground disabled:opacity-50"
        />
        <span className={connected ? 'text-green-500' : 'text-amber-500'} aria-hidden="true">●</span>
      </div>
      {sleeping && (
        <div className="text-xs text-muted-foreground">
          会话已休眠（页面被回收，下一次动作会重建）
        </div>
      )}
      {error !== '' && (
        <div className="rounded bg-destructive/15 px-2 py-1 text-xs text-destructive">{error}</div>
      )}
    </div>
  )
}
