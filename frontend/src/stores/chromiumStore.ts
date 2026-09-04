import { create } from 'zustand'

// maxInstallLines 限住安装日志的长度。一次安装的输出行数没有上限（脚本在下 150MB 的
// 过程里会一直写），无界数组会一直涨；保留最近这些行足够看清它卡在哪一步。
export const maxInstallLines = 200

export type ChromiumStatus = 'unknown' | 'absent' | 'installed' | 'installing' | 'failed'

interface ChromiumState {
  // status 是显式状态机，而不是从 path 是否为空推导出来的：「刚装完」与「本来就随包
  // 带着」在界面上要说的话不同，而 path 非空对两者都成立；'unknown' 也必须与 'absent'
  // 分开——还没问过后端，和问过之后确认没有，是两件事。
  status: ChromiumStatus
  path: string
  lines: string[]
  error: string | null
  setPresence: (path: string) => void
  start: () => void
  appendLine: (line: string) => void
  succeed: (path: string) => void
  fail: (message: string) => void
}

export const useChromiumStore = create<ChromiumState>((set) => ({
  status: 'unknown',
  path: '',
  lines: [],
  error: null,
  setPresence: (path) => set({ status: path === '' ? 'absent' : 'installed', path }),
  // 清掉上一次的输出与错误：一条过期的红字会一直遮住这一次的真实状态。
  start: () => set({ status: 'installing', lines: [], error: null }),
  appendLine: (line) => set((s) => ({ lines: [...s.lines, line].slice(-maxInstallLines) })),
  succeed: (path) => set({ status: 'installed', path, error: null }),
  fail: (message) => set({ status: 'failed', error: message }),
}))
