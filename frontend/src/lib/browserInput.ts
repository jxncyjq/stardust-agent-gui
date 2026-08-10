// browserInput 负责接管模式下把 DOM 鼠标/键盘事件映射为后端归一化 InputEvent，
// 并经 fetch+bearer POST 到会话端点。坐标只发 0..1，后端 × 视口 px。

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

// postInput 注入一批事件；非 2xx 抛错（fail-loud，让调用方提示注入失败）。
export async function postInput(
  baseURL: string,
  token: string,
  sessionId: string,
  events: InputEvent[],
): Promise<void> {
  await postJSON(`${baseURL}/v1/browser/sessions/${sessionId}/input`, token, { events })
}

// postTakeover 置/清接管标志。
export async function postTakeover(
  baseURL: string,
  token: string,
  sessionId: string,
  enabled: boolean,
): Promise<void> {
  await postJSON(`${baseURL}/v1/browser/sessions/${sessionId}/takeover`, token, { enabled })
}

async function postJSON(url: string, token: string, body: unknown): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) {
    throw new Error(`browser POST ${url}: HTTP ${res.status}`)
  }
}
