import { useEffect, useRef } from 'react'
import { useBrowserStore } from '../stores/browserStore'
import { useBrowserStream } from '../hooks/useBrowserStream'

// BrowserView 只读展示 Agent 的浏览过程：canvas 渲染 screencast 帧 + 观测树 + 进度。
// 用户点击不回传（spec §3.2 只读；接管模式 = Phase 7）。
export function BrowserView() {
  const sessionId = useBrowserStore((s) => s.sessionId)
  const frameDataUri = useBrowserStore((s) => s.frameDataUri)
  const elements = useBrowserStore((s) => s.elements)
  const progress = useBrowserStore((s) => s.progress)
  const connected = useBrowserStore((s) => s.connected)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useBrowserStream(sessionId)

  useEffect(() => {
    if (!frameDataUri || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      canvas.width = img.width
      canvas.height = img.height
      ctx.drawImage(img, 0, 0)
    }
    img.onerror = () => console.warn('browser view: frame decode failed')
    img.src = frameDataUri
    return () => { cancelled = true }
  }, [frameDataUri])

  if (!sessionId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Agent 未在浏览
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <div className="flex items-center gap-2 text-xs">
        <span className={connected ? 'text-green-500' : 'text-amber-500'}>●</span>
        <span className="text-muted-foreground">session {sessionId}</span>
        {progress && (
          <span className="text-muted-foreground">
            · {progress.action}:{progress.status}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-hidden rounded border border-border bg-muted">
        <canvas ref={canvasRef} className="h-full w-full object-contain" />
      </div>
      <details className="max-h-40 overflow-auto rounded border border-border p-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          观测树（{elements.length}）
        </summary>
        <ul className="mt-1 space-y-0.5 font-mono">
          {elements.map((e) => (
            <li key={e.ref} className="text-foreground">
              [{e.ref}] &lt;{e.role}&gt; {e.name}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
