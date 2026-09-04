import { useState } from 'react'
import { InstallBundledChromium, ReinstallBundledChromium } from '../../../wailsjs/go/main/App'
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
  const start = useChromiumStore((s) => s.start)
  const fail = useChromiumStore((s) => s.fail)
  const [confirming, setConfirming] = useState(false)

  const install = (reinstall: boolean) => {
    setConfirming(false)
    start()
    const call = reinstall ? ReinstallBundledChromium : InstallBundledChromium
    // 绑定 reject 也要落到 store：Go 侧失败时也会发一行「安装失败：…」，但两条路都要
    // 能把界面带到 failed——事件掉了一次不该让界面永远停在「安装中」。
    void call().catch((err: unknown) => fail(String(err)))
  }

  return (
    <div className="py-4 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold">内置浏览器</span>
        <span className="text-[10px] text-muted-foreground">
          Agent 用它来打开网页。安装会从 GitHub 取回官方脚本、校验摘要后执行，整个过程要几分钟。
        </span>
      </div>

      {status === 'absent' && (
        <p className="text-xs text-muted-foreground">
          这次安装没有自带浏览器，Agent 会用系统上装着的那个。
        </p>
      )}

      {status === 'installed' && <p className="text-xs text-muted-foreground break-all">{path}</p>}

      {status === 'failed' && (
        <div className="flex flex-col gap-0.5">
          <p className="text-xs text-destructive">安装内置浏览器失败。</p>
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

      <div>
        {status === 'installing' ? (
          <button type="button" disabled className="interactive text-xs px-2 py-1 rounded border border-input opacity-50">
            安装中…
          </button>
        ) : status === 'installed' ? (
          <button
            type="button"
            className="interactive text-xs px-2 py-1 rounded border border-input hover:bg-muted text-muted-foreground"
            onClick={() => setConfirming(true)}
          >
            重新安装
          </button>
        ) : (
          <button
            type="button"
            className="interactive text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
            onClick={() => install(false)}
          >
            {status === 'failed' ? '重试' : '安装内置浏览器'}
          </button>
        )}
      </div>

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
