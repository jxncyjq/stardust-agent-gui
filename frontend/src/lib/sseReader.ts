export interface SSEEvent {
  event: string
  id?: string
  data: string
}

// readSSE 用 fetch+ReadableStream 消费一条 SSE 流（带可选 bearer 与 Last-Event-ID），
// 逐事件回调。手解析 SSE：event:/id:/data: 行，空行分隔一条事件。EventSource 不能设
// header，故用此方式带 Authorization（token 不进 URL）。
export async function readSSE(
  url: string,
  token: string,
  lastEventId: number,
  onEvent: (e: SSEEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = { Accept: 'text/event-stream' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (lastEventId > 0) headers['Last-Event-ID'] = String(lastEventId)

  const res = await fetch(url, { headers, signal })
  if (!res.ok || !res.body) {
    throw new Error(`browser stream ${url}: HTTP ${res.status}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      const ev = parseFrame(raw)
      if (ev) onEvent(ev)
    }
  }
  // 流关闭后 flush 多字节残余，再解析最后一条无尾随空行的帧，避免丢弃。
  buf += decoder.decode()
  if (buf.trim() !== '') {
    const ev = parseFrame(buf)
    if (ev) onEvent(ev)
  }
}

function parseFrame(raw: string): SSEEvent | null {
  let event = 'message'
  let id: string | undefined
  const dataLines: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('id:')) id = line.slice(3).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (dataLines.length === 0 && event === 'message') return null
  return { event, id, data: dataLines.join('\n') }
}
