import { create } from 'zustand'

// maxInstallLines 限住安装日志的长度。一次安装的输出行数没有上限（脚本在下 150MB 的
// 过程里会一直写），无界数组会一直涨；保留最近这些行足够看清它卡在哪一步。
export const maxInstallLines = 200

// 'probe-failed' 与 'install-failed' 必须分开：前者是「我没问出来这次安装有没有自带
// 浏览器」（什么都没装过），后者是「装了但失败了」。混成一个态时，一次探测失败会被
// 渲染成「安装内置浏览器失败」，而给出的恢复动作是真的发起一次 150MB 安装——两句话
// 都是错的。
export type ChromiumStatus =
  | 'unknown'
  | 'absent'
  | 'installed'
  | 'installing'
  | 'probe-failed'
  | 'install-failed'

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
  failProbe: (message: string) => void
}

export const useChromiumStore = create<ChromiumState>((set) => ({
  status: 'unknown',
  path: '',
  lines: [],
  error: null,
  // 一次成功的探测就是重新确认了事实，上一次的红字不该跟着留下来遮住它。
  setPresence: (path) => set({ status: path === '' ? 'absent' : 'installed', path, error: null }),
  // 清掉上一次的输出与错误：一条过期的红字会一直遮住这一次的真实状态。
  start: () => set({ status: 'installing', lines: [], error: null }),
  appendLine: (line) => set((s) => ({ lines: [...s.lines, line].slice(-maxInstallLines) })),
  succeed: (path) => set({ status: 'installed', path, error: null }),
  // path 跟着作废：重装是先删后装，失败之后那个旧路径上可能已经什么都没有了。留着它
  // 会让 path 与 status 讲两个故事，而「重试」正要靠「现在到底有没有」来选入口。
  fail: (message) => set({ status: 'install-failed', path: '', error: message }),
  failProbe: (message) => set({ status: 'probe-failed', path: '', error: message }),
}))
