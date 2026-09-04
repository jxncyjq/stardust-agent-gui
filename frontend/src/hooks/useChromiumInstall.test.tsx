import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  BundledChromiumPath: vi.fn(),
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}))
vi.mock('../../wailsjs/go/main/App', () => ({ BundledChromiumPath: mocks.BundledChromiumPath }))
vi.mock('../../wailsjs/runtime/runtime', () => ({ EventsOn: mocks.EventsOn, EventsOff: mocks.EventsOff }))

import { useChromiumInstall } from './useChromiumInstall'
import { useChromiumStore } from '../stores/chromiumStore'

function Harness() {
  useChromiumInstall()
  return null
}

function installHandler(): (line: string) => void {
  const call = mocks.EventsOn.mock.calls.find((c) => c[0] === 'chromium:install')
  if (!call) throw new Error('没有订阅 chromium:install')
  return call[1] as (line: string) => void
}

describe('useChromiumInstall', () => {
  beforeEach(() => {
    mocks.BundledChromiumPath.mockReset().mockResolvedValue('')
    mocks.EventsOn.mockReset()
    mocks.EventsOff.mockReset()
    useChromiumStore.setState({ status: 'unknown', path: '', lines: [], error: null })
  })

  it('首屏问一次后端，把有没有浏览器写进 store', async () => {
    mocks.BundledChromiumPath.mockResolvedValue('/opt/app/chrome')
    render(<Harness />)
    await waitFor(() => expect(useChromiumStore.getState().status).toBe('installed'))
    expect(useChromiumStore.getState().path).toBe('/opt/app/chrome')
  })

  // 这条是整个设计的要害：安装要几分钟，用户会去干别的。监听挂在 App 顶层而不是设置
  // 面板里，所以设置面板从没挂载过也照样收得到——这里用「只渲染 Harness」代表那个场景。
  it('设置面板没开着的时候，安装输出照样进 store', async () => {
    render(<Harness />)
    await waitFor(() => expect(mocks.EventsOn).toHaveBeenCalledWith('chromium:install', expect.any(Function)))
    useChromiumStore.getState().start()
    installHandler()('正在下载 chromium…')
    expect(useChromiumStore.getState().lines).toEqual(['正在下载 chromium…'])
  })

  // 装完之后**由查找逻辑自己回答**它看不看得见，而不是相信脚本说的「装到了 X」：
  // 脚本的落点与运行时的查找位置各写各的（internal/chromium/install.go 已为 Go 侧
  // 立过同一条规矩）。
  it('收到完成行之后回头问一次真实路径', async () => {
    render(<Harness />)
    await waitFor(() => expect(mocks.EventsOn).toHaveBeenCalled())
    useChromiumStore.getState().start()
    mocks.BundledChromiumPath.mockResolvedValue('/opt/app/chrome')
    installHandler()('安装完成：/opt/app/chrome')
    await waitFor(() => expect(useChromiumStore.getState().status).toBe('installed'))
    expect(useChromiumStore.getState().path).toBe('/opt/app/chrome')
  })

  // 脚本说装完了、查找逻辑却看不到，是失败而不是成功：那正是「装到了 App 旁边而不是
  // App 里面」的形态，Go 侧对同一情形也是报错。
  it('完成行之后路径仍为空 → install-failed', async () => {
    render(<Harness />)
    await waitFor(() => expect(mocks.EventsOn).toHaveBeenCalled())
    useChromiumStore.getState().start()
    mocks.BundledChromiumPath.mockResolvedValue('')
    installHandler()('安装完成：')
    await waitFor(() => expect(useChromiumStore.getState().status).toBe('install-failed'))
  })

  it('失败行落成 failed，错误里不带那个前缀', async () => {
    render(<Harness />)
    await waitFor(() => expect(mocks.EventsOn).toHaveBeenCalled())
    useChromiumStore.getState().start()
    installHandler()('安装失败：run the install script: exit status 1')
    expect(useChromiumStore.getState().status).toBe('install-failed')
    expect(useChromiumStore.getState().error).toBe('run the install script: exit status 1')
  })

  // 首屏探测失败说的是「我没问出来」，不是「我装失败了」——什么都还没装过。两者混成
  // 一个状态时，用户看到的是「安装内置浏览器失败」，而给出的恢复动作是真的发起一次
  // 150MB 安装。
  it('首屏探测失败落到 probe-failed，不是 install-failed', async () => {
    mocks.BundledChromiumPath.mockRejectedValue('serve is down')
    render(<Harness />)
    await waitFor(() => expect(useChromiumStore.getState().status).toBe('probe-failed'))
    expect(useChromiumStore.getState().error).toContain('serve is down')
  })

  // 完成行触发的那次复核也要认 cancelled：首屏探测那次一直认，这次不认，等于这个标志
  // 只被遵守了一半。
  it('卸载之后，完成行触发的那次复核不再写 store', async () => {
    const { unmount } = render(<Harness />)
    await waitFor(() => expect(mocks.EventsOn).toHaveBeenCalled())
    const handle = installHandler()
    useChromiumStore.getState().start()

    let resolvePath: (path: string) => void = () => {}
    mocks.BundledChromiumPath.mockReturnValue(
      new Promise<string>((resolve) => {
        resolvePath = resolve
      }),
    )
    handle('安装完成：/opt/app/chrome')
    unmount()
    resolvePath('/opt/app/chrome')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useChromiumStore.getState().status).toBe('installing')
  })

  it('卸载时摘掉监听', async () => {
    const { unmount } = render(<Harness />)
    await waitFor(() => expect(mocks.EventsOn).toHaveBeenCalled())
    unmount()
    expect(mocks.EventsOff).toHaveBeenCalledWith('chromium:install')
  })
})
