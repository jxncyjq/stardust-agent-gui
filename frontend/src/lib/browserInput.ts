// browserInput 负责接管模式下把 DOM 鼠标/键盘事件映射为后端归一化 InputEvent，
// 并经 Go Wails binding POST 到会话端点（避开 webview 直发的 CORS 预检）。
// 坐标只发 0..1，后端 × 视口 px。
import { BrowserInput, BrowserTakeover } from '../../wailsjs/go/main/App'

export interface InputEvent {
  type: string
  x?: number
  y?: number
  button?: string
  deltaX?: number
  deltaY?: number
  key?: string
  text?: string
}

// mapToNormalized 用 canvas 显示矩形把 client 坐标换成 0..1（clamp 越界）。
export function mapToNormalized(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
  return {
    x: clamp((clientX - rect.left) / rect.width),
    y: clamp((clientY - rect.top) / rect.height),
  }
}

// Throttler 按最小间隔放行（用于合并高频 mousemove）。调用方传入单调 now(ms)。
export class Throttler {
  private last = -Infinity
  constructor(private intervalMs: number) {}
  ready(nowMs: number): boolean {
    if (nowMs - this.last >= this.intervalMs) {
      this.last = nowMs
      return true
    }
    return false
  }
}

// postInput/postTakeover forward through the Go Wails bindings, not a direct
// webview fetch. A cross-origin application/json POST from the webview to the
// random-port local serve triggers a CORS preflight the serve answers with 404
// (no OPTIONS handler), so the takeover button and input injection silently did
// nothing. The Go side (BrowserTakeover/BrowserInput) issues the POST with the
// loopback bearer token and no preflight. Both bindings reject on a non-2xx
// serve response, so failures still surface (fail-loud) to the caller.

// postInput 注入一批事件；binding 在后端非 2xx 时 reject（fail-loud）。
export async function postInput(sessionId: string, events: InputEvent[]): Promise<void> {
  await BrowserInput(sessionId, JSON.stringify(events))
}

// postTakeover 置/清接管标志。
export async function postTakeover(sessionId: string, enabled: boolean): Promise<void> {
  await BrowserTakeover(sessionId, enabled)
}
