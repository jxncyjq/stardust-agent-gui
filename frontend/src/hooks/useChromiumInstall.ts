import { useEffect } from 'react'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import { BundledChromiumPath } from '../../wailsjs/go/main/App'
import { useChromiumStore } from '../stores/chromiumStore'

// 这两个前缀是 Go 侧 runChromiumInstall 收尾时**自己发出**的两行（app_chromium.go）。
// 认它们不等于解析脚本输出：脚本自己写什么这里一概不看。
const installFinishedPrefix = '安装完成：'
const installFailedPrefix = '安装失败：'

// useChromiumInstall 订阅内置浏览器的安装事件，并在首屏问一次「现在有没有」。
//
// **挂在 App 顶层**（与 useBrowserSession 并列），不挂在设置面板里：安装要几分钟，
// 用户多半会切走 tab 或干脆把设置关掉，而切 tab 会 unmount 设置页（SettingsModal 的
// 注释写明了这一点）。监听若在页面里，unmount 就等于把还在进行的安装的全部反馈丢掉
// ——Go 侧照装，界面再也收不到一行。
export function useChromiumInstall() {
  useEffect(() => {
    let cancelled = false
    void BundledChromiumPath()
      .then((path) => {
        if (cancelled) return
        // 只在还没开始装的时候写：首屏探测的结果不能覆盖正在进行的安装状态。
        if (useChromiumStore.getState().status === 'unknown') {
          useChromiumStore.getState().setPresence(path)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) useChromiumStore.getState().fail(String(err))
      })

    const handle = (line: string) => {
      const store = useChromiumStore.getState()
      store.appendLine(line)
      if (line.startsWith(installFailedPrefix)) {
        store.fail(line.slice(installFailedPrefix.length))
        return
      }
      if (line.startsWith(installFinishedPrefix)) {
        // 不采信这行里的路径，回头问查找逻辑：脚本的落点与运行时的查找位置各写各的。
        void BundledChromiumPath()
          .then((path) => {
            if (path === '') {
              useChromiumStore
                .getState()
                .fail('安装脚本说装完了，但这个应用在它查找的任何位置都看不到浏览器')
              return
            }
            useChromiumStore.getState().succeed(path)
          })
          .catch((err: unknown) => useChromiumStore.getState().fail(String(err)))
      }
    }
    EventsOn('chromium:install', handle)
    return () => {
      cancelled = true
      EventsOff('chromium:install')
    }
  }, [])
}
