import { create } from 'zustand'

export interface BrowserElement {
  ref: string
  role: string
  name: string
  value?: string
}

interface BrowserState {
  sessionId: string | null
  frameDataUri: string | null
  elements: BrowserElement[]
  observationText: string
  progress: { action: string; status: string; ref?: string } | null
  connected: boolean
  lastEventId: number
  takeover: boolean
  setSession: (id: string | null) => void
  onFrame: (mime: string, b64: string) => void
  onObservation: (obs: { elements: BrowserElement[]; text: string }) => void
  onProgress: (p: { action: string; status: string; ref?: string }) => void
  setConnected: (c: boolean) => void
  setLastEventId: (id: number) => void
  setTakeover: (v: boolean) => void
  reset: () => void
}

const empty = {
  frameDataUri: null, elements: [] as BrowserElement[], observationText: '',
  progress: null, connected: false, lastEventId: 0, takeover: false,
}

export const useBrowserStore = create<BrowserState>((set) => ({
  sessionId: null,
  ...empty,
  // setSession 切换当前浏览器会话并清空派生状态（帧/元素/连接/接管）。但当 id 与当前
  // 会话相同时保留状态：后端在同一 chat session 内复用同一个浏览器会话，会为每条新消息
  // 重发 session_opened(同 id)，若每次都重置就会把人工接管态在每条消息后清掉。
  setSession: (id) =>
    set((s) => {
      if (id === s.sessionId) return s
      return id === null ? { sessionId: null, ...empty } : { sessionId: id, ...empty }
    }),
  onFrame: (mime, b64) => set({ frameDataUri: `data:${mime};base64,${b64}` }),
  onObservation: (obs) => set({ elements: obs.elements ?? [], observationText: obs.text ?? '' }),
  onProgress: (p) => set({ progress: p }),
  setConnected: (c) => set({ connected: c }),
  setLastEventId: (id) => set({ lastEventId: id }),
  setTakeover: (v) => set({ takeover: v }),
  reset: () => set({ sessionId: null, ...empty }),
}))
