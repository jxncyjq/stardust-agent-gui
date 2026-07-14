import { create } from 'zustand'

interface ServeState {
  running: boolean
  port: number
  setStatus: (running: boolean, port: number) => void
}

export const useServeStore = create<ServeState>((set) => ({
  running: false,
  port: 0,
  setStatus: (running, port) => set({ running, port }),
}))
