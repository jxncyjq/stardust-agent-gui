import { useEffect, useRef, useCallback } from 'react'
import { useBrowserStore } from '../stores/browserStore'
import { useBrowserStream } from '../hooks/useBrowserStream'
import { mapToNormalizedContained, Throttler, postInput, postTakeover, type InputEvent } from '../lib/browserInput'
import { BrowserSetViewport } from '../../wailsjs/go/main/App'

// BrowserView：只读展示 Agent 浏览过程；接管开时 canvas 捕获鼠标/键盘注入 Agent 会话。
export function BrowserView() {
  const sessionId = useBrowserStore((s) => s.sessionId)
  const frameDataUri = useBrowserStore((s) => s.frameDataUri)
  const elements = useBrowserStore((s) => s.elements)
  const progress = useBrowserStore((s) => s.progress)
  const connected = useBrowserStore((s) => s.connected)
  const takeover = useBrowserStore((s) => s.takeover)
  const setTakeover = useBrowserStore((s) => s.setTakeover)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const moveThrottle = useRef(new Throttler(25)) // ~40fps 合并 mousemove

  useBrowserStream(sessionId)

  // 视口同步：把面板像素尺寸推给后端，后端据此设浏览器视口，使帧宽高比与面板一致、
  // 填满无 letterbox。挂载即同步一次，之后按 ResizeObserver 防抖（200ms）跟随面板缩放。
  useEffect(() => {
    if (!sessionId) return
    const el = containerRef.current
    if (!el) return
    let timer: number | undefined
    const push = () => {
      const w = Math.round(el.clientWidth)
      const h = Math.round(el.clientHeight)
      if (w <= 0 || h <= 0) return // 面板尚未布局，跳过（下次 resize 会补）
      BrowserSetViewport(sessionId, w, h).catch((err) =>
        console.error('browser viewport sync failed', err),
      )
    }
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = window.setTimeout(push, 200)
    }
    push() // 初次同步
    let ro: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(schedule)
      ro.observe(el)
    }
    return () => {
      if (timer) clearTimeout(timer)
      ro?.disconnect()
    }
  }, [sessionId])

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

  // send 把一批事件经 Go binding POST 到后端（避 webview CORS 预检）；失败响亮报（不静默）。
  const send = useCallback(async (events: InputEvent[]) => {
    if (!sessionId) return
    try {
      await postInput(sessionId, events)
    } catch (err) {
      console.error('browser takeover: inject failed', err)
    }
  }, [sessionId])

  const toggleTakeover = useCallback(async () => {
    if (!sessionId) return
    const next = !takeover
    try {
      await postTakeover(sessionId, next)
      setTakeover(next)
    } catch (err) {
      console.error('browser takeover: toggle failed', err)
    }
  }, [sessionId, takeover, setTakeover])

  const norm = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current!
    // Map against the letterboxed image rect (object-contain), not the raw box,
    // so clicks land on the real page pixel. canvas.width/height is the frame's
    // native size; the CSS box is w-full/h-full and usually a different aspect.
    return mapToNormalizedContained(
      canvas.getBoundingClientRect(),
      canvas.width,
      canvas.height,
      e.clientX,
      e.clientY,
    )
  }

  const onMouseMove = (e: React.MouseEvent) => {
    if (!takeover) return
    if (!moveThrottle.current.ready(e.timeStamp)) return
    const { x, y } = norm(e)
    void send([{ type: 'mousemove', x, y }])
  }
  const onMouseDown = (e: React.MouseEvent) => {
    if (!takeover) return
    const { x, y } = norm(e)
    void send([{ type: 'mousedown', x, y, button: mouseButtonName(e.button) }])
  }
  const onMouseUp = (e: React.MouseEvent) => {
    if (!takeover) return
    const { x, y } = norm(e)
    void send([{ type: 'mouseup', x, y, button: mouseButtonName(e.button) }])
  }
  const onClick = (e: React.MouseEvent) => {
    if (!takeover) return
    const { x, y } = norm(e)
    void send([{ type: 'click', x, y, button: mouseButtonName(e.button) }])
  }
  const onWheel = (e: React.WheelEvent) => {
    if (!takeover) return
    const { x, y } = norm(e)
    void send([{ type: 'wheel', x, y, deltaX: e.deltaX, deltaY: e.deltaY }])
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!takeover) return
    e.preventDefault()
    if (e.key.length === 1) void send([{ type: 'char', text: e.key }])
    else void send([{ type: 'keydown', key: e.key }])
  }
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (!takeover) return
    if (e.key.length !== 1) void send([{ type: 'keyup', key: e.key }])
  }

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
          <span className="text-muted-foreground">· {progress.action}:{progress.status}</span>
        )}
        <button
          onClick={toggleTakeover}
          className="ml-auto rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
        >
          {takeover ? '退出接管' : '接管'}
        </button>
      </div>
      {takeover && (
        <div className="rounded bg-amber-500/20 px-2 py-1 text-center text-xs font-medium text-amber-600">
          接管中 · 你的鼠标/键盘正操作 Agent 的浏览器会话
        </div>
      )}
      <div ref={containerRef} className="flex-1 overflow-hidden rounded border border-border bg-muted">
        <canvas
          ref={canvasRef}
          tabIndex={takeover ? 0 : -1}
          className="h-full w-full object-contain"
          style={{ pointerEvents: takeover ? 'auto' : 'none', cursor: takeover ? 'crosshair' : 'default' }}
          onMouseMove={onMouseMove}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onClick={onClick}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
        />
      </div>
      <details className="max-h-40 overflow-auto rounded border border-border p-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground">观测树（{elements.length}）</summary>
        <ul className="mt-1 space-y-0.5 font-mono">
          {elements.map((e) => (
            <li key={e.ref} className="text-foreground">[{e.ref}] &lt;{e.role}&gt; {e.name}</li>
          ))}
        </ul>
      </details>
    </div>
  )
}

// mouseButtonName 把 DOM MouseEvent.button (0/1/2) 映射到后端 button 名。
function mouseButtonName(button: number): string {
  switch (button) {
    case 1: return 'middle'
    case 2: return 'right'
    default: return 'left'
  }
}
