import { useEffect } from 'react'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import { BundledChromiumPath } from '../../wailsjs/go/main/App'
import { useChromiumStore } from '../stores/chromiumStore'

// 这两个前缀是 Go 侧 runChromiumInstall 收尾时**自己发出**的两行。认它们不等于解析
// 脚本输出：脚本自己写什么这里一概不看。
//
// 它们是 Go 与前端之间**唯一的**终态信号，两边各写一份字面量：对面是 app_chromium.go
// 里的同名常量 installFinishedPrefix / installFailedPrefix，由
// TestTheInstallMarkersTheFrontendMatchesOnDoNotDrift 逐字钉住。**改这里就必须一并改
// 那边**，否则两边测试都绿而真机上装完之后界面永远停在「安装中…」。
const installFinishedPrefix = '安装完成：'
const installFailedPrefix = '安装失败：'

// confirmInstalled 在「装完了」之后回头问一次真实路径，并据此写 store。
//
// 不采信完成行里带的那个路径：脚本的落点与运行时的查找位置各写各的（Go 侧在
// chromium.Install 末尾对同一件事也是自己再查一遍）。
//
// **两条路都调它**——事件里的完成行，以及绑定 promise 的 resolve。所以它必须幂等：
// 谁先到都把 store 带到同一个终态，后到的那次只是再确认一遍。事件掉一次，成功方向
// 也就不会永远停在「安装中」。
//
// abandoned 让调用方在自己已经卸载之后不要再写 store。
export async function confirmInstalled(abandoned: () => boolean = () => false): Promise<void> {
  try {
    const path = await BundledChromiumPath()
    if (abandoned()) return
    if (path === '') {
      useChromiumStore
        .getState()
        .fail('安装脚本说装完了，但这个应用在它查找的任何位置都看不到浏览器')
      return
    }
    useChromiumStore.getState().succeed(path)
  } catch (err: unknown) {
    if (abandoned()) return
    useChromiumStore.getState().fail(String(err))
  }
}

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
        // 正在装的时候不写：安装中途磁盘上什么都没有是正常的（脚本先删后装），一次
        // 探测结果会把界面从「安装中」打回「没有浏览器」。其余状态都可以被一次新的
        // 探测纠正——失败之后能重新问一次，正是脱身的唯一出口。
        if (useChromiumStore.getState().status !== 'installing') {
          useChromiumStore.getState().setPresence(path)
        }
      })
      .catch((err: unknown) => {
        // 探测失败 ≠ 安装失败：到这里什么都还没装过。
        if (!cancelled) useChromiumStore.getState().failProbe(String(err))
      })

    const handle = (line: string) => {
      const store = useChromiumStore.getState()
      store.appendLine(line)
      if (line.startsWith(installFailedPrefix)) {
        store.fail(line.slice(installFailedPrefix.length))
        return
      }
      if (line.startsWith(installFinishedPrefix)) {
        void confirmInstalled(() => cancelled)
      }
    }
    EventsOn('chromium:install', handle)
    return () => {
      cancelled = true
      // EventsOff 按事件名摘监听，摘掉的是 'chromium:install' 名下的**全部**订阅，
      // 不只是这里注册的那个（Wails 的语义就是如此，本仓其它 hook 也是这么写的）。
      // 成立的前提是：这个事件全仓只有这一个订阅者——本 hook，挂在 App 顶层。
      // 给它加第二个消费者的人必须连这里一起改，否则那个消费者会在本 hook 卸载时被
      // 静默摘掉，症状是「它有时候收不到事件」。
      EventsOff('chromium:install')
    }
  }, [])
}
