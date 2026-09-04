import { useState } from 'react'
import {
  BundledChromiumPath,
  InstallBundledChromium,
  ReinstallBundledChromium,
} from '../../../wailsjs/go/main/App'
import { confirmInstalled } from '../../hooks/useChromiumInstall'
import { useChromiumStore } from '../../stores/chromiumStore'

// BrowserPage 是设置里的「浏览器」页：内置 Chromium 装没装、装在哪、以及**由人主动
// 发起**的安装。
//
// 安装执行的是从网上取回来的代码（校验摘要后才执行，见 chromium.Install），所以它
// 永远是一个人点下去的动作，不在启动时自己跑，也不弹窗问。
//
// 这一页自己不持有安装状态：状态在 chromiumStore，事件监听在 App 顶层
// （useChromiumInstall）。所以关掉设置、切走 tab 都不影响正在进行的安装，回来还看得到
// 进度——这一页 unmount 只是不再渲染而已。
export function BrowserPage() {
  const status = useChromiumStore((s) => s.status)
  const path = useChromiumStore((s) => s.path)
  const lines = useChromiumStore((s) => s.lines)
  const error = useChromiumStore((s) => s.error)
  const setPresence = useChromiumStore((s) => s.setPresence)
  const start = useChromiumStore((s) => s.start)
  const fail = useChromiumStore((s) => s.fail)
  const failProbe = useChromiumStore((s) => s.failProbe)
  const [confirming, setConfirming] = useState(false)

  const install = (reinstall: boolean) => {
    setConfirming(false)
    start()
    const call = reinstall ? ReinstallBundledChromium : InstallBundledChromium
    // 两个方向都要有第二条路——事件掉了一次不该让界面永远停在「安装中」：
    // 失败方向靠绑定 reject，成功方向靠 resolve 之后自己复核一次路径。
    // confirmInstalled 与事件处理器是同一个函数，幂等，谁先到都对。
    void call()
      .then(() => confirmInstalled())
      .catch((err: unknown) => fail(String(err)))
  }

  // probe 重新问一次「现在到底有没有」。它是失败态脱身的唯一出口：status 一旦进了
  // 失败态，没有别的动作能把它送回 installed / absent。
  // 返回探测到的路径；探测本身失败时返回 null（此时 store 已落到 probe-failed）。
  const probe = async (): Promise<string | null> => {
    try {
      const found = await BundledChromiumPath()
      setPresence(found)
      return found
    } catch (err: unknown) {
      failProbe(String(err))
      return null
    }
  }

  // 安装失败之后的「重试」不能直接调 InstallBundledChromium：那个入口已装即拒，而这次
  // 失败很可能发生在脚本跑起来**之前**（取脚本时网络抖动、摘要不符），机器上那个旧
  // 浏览器还好端端地在。照直重试的结果是必然再被拒一次，错误换成一句用户完全看不懂的
  // 「已经有浏览器了」；而「重新安装」只在 installed 态出现，那个态已经回不去了。
  // 所以先重新探测，再按探测到的事实选入口。
  const retry = async () => {
    const found = await probe()
    if (found === null) return
    if (found !== '') {
      // 还有一个能用的：重装先删后装的代价照样要在点下去之前说清楚。
      setConfirming(true)
      return
    }
    install(false)
  }

  const buttonClass = 'interactive text-xs px-2 py-1 rounded'
  const disabledClass = `${buttonClass} border border-input opacity-50`
  const secondaryClass = `${buttonClass} border border-input hover:bg-muted text-muted-foreground`
  const primaryClass = `${buttonClass} bg-primary text-primary-foreground hover:opacity-90`

  // 每个状态各给一个确定的动作。用 switch 而不是三元链，是为了让「新加了一个状态却
  // 忘了给动作」在编译期就被 never 抓住——那种漏法的表现是界面上什么都不显示。
  const actionButton = () => {
    switch (status) {
      case 'installing':
        return (
          <button type="button" disabled className={disabledClass}>
            安装中…
          </button>
        )
      case 'unknown':
        // 还没问过后端，不能给一个必然失败的动作：这台机器可能本来就装好了浏览器，
        // 点下去会撞上 Go 侧「已经有浏览器」的拒绝，把好端端的状态渲染成「安装失败」。
        return (
          <button type="button" disabled className={disabledClass}>
            检查中…
          </button>
        )
      case 'installed':
        return (
          <button type="button" className={secondaryClass} onClick={() => setConfirming(true)}>
            重新安装
          </button>
        )
      case 'probe-failed':
        // 没问出来就只重新问一次，不去装：这条路上什么都还没装过。
        return (
          <button type="button" className={primaryClass} onClick={() => void probe()}>
            重新检查
          </button>
        )
      case 'install-failed':
        return (
          <button type="button" className={primaryClass} onClick={() => void retry()}>
            重试
          </button>
        )
      case 'absent':
        return (
          <button type="button" className={primaryClass} onClick={() => install(false)}>
            安装内置浏览器
          </button>
        )
      default: {
        const missing: never = status
        throw new Error(`没有为 chromium 状态 ${String(missing)} 给出动作`)
      }
    }
  }

  return (
    <div className="py-4 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold">内置浏览器</span>
        <span className="text-[10px] text-muted-foreground">
          Agent 用它来打开网页。安装会从 GitHub 取回官方脚本、校验摘要后执行，整个过程要几分钟。
        </span>
      </div>

      {status === 'unknown' && (
        <p className="text-xs text-muted-foreground">正在检查这次安装有没有自带浏览器…</p>
      )}

      {status === 'absent' && (
        <p className="text-xs text-muted-foreground">
          这次安装没有自带浏览器，Agent 会用系统上装着的那个。
        </p>
      )}

      {status === 'installed' && <p className="text-xs text-muted-foreground break-all">{path}</p>}

      {(status === 'install-failed' || status === 'probe-failed') && (
        <div className="flex flex-col gap-0.5">
          {/* 「没问出来」与「装失败了」说的是两件事，不能共用一句话：后者意味着刚刚
              真的装过一次，前者什么都没发生。 */}
          <p className="text-xs text-destructive">
            {status === 'install-failed'
              ? '安装内置浏览器失败。'
              : '没能确认这次安装有没有自带浏览器。'}
          </p>
          <details className="text-[10px] text-muted-foreground">
            <summary className="interactive cursor-pointer select-none">显示详细错误</summary>
            <pre className="whitespace-pre-wrap break-all mt-0.5">{error}</pre>
          </details>
        </div>
      )}

      {lines.length > 0 && (
        <pre className="max-h-48 overflow-y-auto rounded border border-border bg-muted/40 p-2 text-[10px] whitespace-pre-wrap break-all">
          {lines.join('\n')}
        </pre>
      )}

      <div>{actionButton()}</div>

      {confirming && (
        // 先删后装的代价要在点下去**之前**说清楚：安装脚本会先清空目标目录，下载中断
        // 就是旧的没了、新的没装上。用户此刻拥有的是一个能用的浏览器。
        <div role="dialog" aria-label="重新安装内置浏览器" className="rounded border border-border p-2 flex flex-col gap-2">
          <p className="text-xs">
            重新安装会先删除现在这个，再下载新的。下载中途失败，这台机器上就既没有旧的、
            也没有新的，要再装一次才能恢复。
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="interactive text-xs px-2 py-1 rounded border border-input hover:bg-muted"
              onClick={() => setConfirming(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="interactive text-xs px-2 py-1 rounded bg-destructive text-destructive-foreground hover:opacity-90"
              onClick={() => install(true)}
            >
              确认重新安装
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
