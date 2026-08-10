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
  setSession: (id) => set(id === null ? { sessionId: null, ...empty } : { sessionId: id, ...empty }),
  onFrame: (mime, b64) => set({ frameDataUri: `data:${mime};base64,${b64}` }),
  onObservation: (obs) => set({ elements: obs.elements ?? [], observationText: obs.text ?? '' }),
  onProgress: (p) => set({ progress: p }),
  setConnected: (c) => set({ connected: c }),
  setLastEventId: (id) => set({ lastEventId: id }),
  setTakeover: (v) => set({ takeover: v }),
  reset: () => set({ sessionId: null, ...empty }),
}))
