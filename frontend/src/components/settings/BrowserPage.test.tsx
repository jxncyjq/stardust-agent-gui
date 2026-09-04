import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  BundledChromiumPath: vi.fn(),
  InstallBundledChromium: vi.fn(),
  ReinstallBundledChromium: vi.fn(),
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}))
vi.mock('../../../wailsjs/go/main/App', () => ({
  BundledChromiumPath: mocks.BundledChromiumPath,
  InstallBundledChromium: mocks.InstallBundledChromium,
  ReinstallBundledChromium: mocks.ReinstallBundledChromium,
}))
// BrowserPage 用 useChromiumInstall 里的 confirmInstalled（成功方向的复核与事件处理器
// 共用同一套逻辑），那个模块在顶层 import 了 Wails 的 runtime。
vi.mock('../../../wailsjs/runtime/runtime', () => ({ EventsOn: mocks.EventsOn, EventsOff: mocks.EventsOff }))

import { BrowserPage } from './BrowserPage'
import { useChromiumStore } from '../../stores/chromiumStore'

describe('BrowserPage', () => {
  beforeEach(() => {
    mocks.BundledChromiumPath.mockReset().mockResolvedValue('')
    mocks.InstallBundledChromium.mockReset().mockResolvedValue(undefined)
    mocks.ReinstallBundledChromium.mockReset().mockResolvedValue(undefined)
    useChromiumStore.setState({ status: 'unknown', path: '', lines: [], error: null })
  })

  // 'unknown' 是「还没问过后端」，'absent' 是「问过之后确认没有」——两者不能给用户
  // 同一个界面：unknown 下点「安装」必然撞上 Go 侧「已经有浏览器」的拒绝，把好端端的
  // 机器渲染成「安装失败」。
  it('还没问过后端时不给出必然失败的安装按钮，只说明正在检查', () => {
    render(<BrowserPage />)
    expect(screen.queryByRole('button', { name: '安装内置浏览器' })).not.toBeInTheDocument()
    expect(screen.getByText(/正在检查/)).toBeInTheDocument()
  })

  it('没有浏览器时给安装入口，并说明现在用的是系统浏览器', () => {
    useChromiumStore.setState({ status: 'absent' })
    render(<BrowserPage />)
    expect(screen.getByText(/系统上装着的/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '安装内置浏览器' })).toBeEnabled()
  })

  it('安装中显示逐行输出，且按钮不可再点', () => {
    useChromiumStore.setState({ status: 'installing', lines: ['正在下载…', '解压中…'] })
    render(<BrowserPage />)
    expect(screen.getByText(/正在下载…/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /安装中/ })).toBeDisabled()
  })

  // 重装是先删后装：下载中断就是旧的没了、新的没装上。这个代价必须在点下去之前说出来。
  it('已装时点重新安装先确认，取消则一次绑定都不调', async () => {
    useChromiumStore.setState({ status: 'installed', path: '/opt/app/chrome' })
    render(<BrowserPage />)
    expect(screen.getByText('/opt/app/chrome')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新安装' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/先删除现在这个/)).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.ReinstallBundledChromium).not.toHaveBeenCalled()
  })

  it('确认之后才调 ReinstallBundledChromium', async () => {
    useChromiumStore.setState({ status: 'installed', path: '/opt/app/chrome' })
    render(<BrowserPage />)
    fireEvent.click(screen.getByRole('button', { name: '重新安装' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认重新安装' }))
    await waitFor(() => expect(mocks.ReinstallBundledChromium).toHaveBeenCalledTimes(1))
  })

  // 失败原文可能是整个脚本输出。按本仓 #48 的规矩：人话一句 + 折叠原文，不裸铺。
  it('失败时人话在外、原文折叠在 details 里', () => {
    useChromiumStore.setState({
      status: 'install-failed',
      error: 'run the install script: exit status 1 ' + 'x'.repeat(400),
    })
    render(<BrowserPage />)
    expect(screen.getByText('安装内置浏览器失败。')).toBeInTheDocument()
    expect(screen.getByText(/exit status 1/).closest('details')).not.toBeNull()
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled()
  })

  // 绑定 reject 也要把界面带到失败态：事件掉了一次，不该让它永远停在「安装中」。
  it('绑定 reject 时也落到 install-failed', async () => {
    useChromiumStore.setState({ status: 'absent' })
    mocks.InstallBundledChromium.mockRejectedValue('serve is down')
    render(<BrowserPage />)
    fireEvent.click(screen.getByRole('button', { name: '安装内置浏览器' }))
    await waitFor(() => expect(useChromiumStore.getState().status).toBe('install-failed'))
  })

  // I-2：成功方向此前只有事件一条路——绑定 resolve 时什么都不做。同一次事件丢失，
  // 在成功方向上得到的正是「永远停在安装中」，而注释还写着两条路都有兜底。
  it('绑定 resolve 之后自己复核一次路径：完成事件没到也不会停在「安装中」', async () => {
    useChromiumStore.setState({ status: 'absent' })
    mocks.BundledChromiumPath.mockResolvedValue('/opt/app/chrome')
    render(<BrowserPage />)
    fireEvent.click(screen.getByRole('button', { name: '安装内置浏览器' }))
    await waitFor(() => expect(useChromiumStore.getState().status).toBe('installed'))
    expect(useChromiumStore.getState().path).toBe('/opt/app/chrome')
  })

  // C-2 场景 A：重装在脚本跑起来之前就失败了（取脚本网络抖动、摘要不符），机器上那个
  // 旧浏览器还好端端地在。直接重试会走 InstallBundledChromium——那个已装即拒的入口，
  // 于是必然再失败一次，错误换成一句用户完全看不懂的「已经有浏览器了」；而「重新安装」
  // 只在 installed 态出现，那个态已经回不去了。
  it('重试先重新探测：还有浏览器就走确认框，不去撞那个必然被拒的入口', async () => {
    useChromiumStore.setState({ status: 'install-failed', error: '取脚本时网络抖动' })
    mocks.BundledChromiumPath.mockResolvedValue('/opt/app/chrome')
    render(<BrowserPage />)

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(mocks.InstallBundledChromium).not.toHaveBeenCalled()
    expect(useChromiumStore.getState().status).toBe('installed')
  })

  it('重试先重新探测：确实没有浏览器就直接装', async () => {
    useChromiumStore.setState({ status: 'install-failed', error: 'exit status 1' })
    mocks.BundledChromiumPath.mockResolvedValue('')
    render(<BrowserPage />)

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(mocks.InstallBundledChromium).toHaveBeenCalledTimes(1))
  })

  // C-2 场景 B：首屏没问出来被渲染成「安装内置浏览器失败」，可什么都没装过；而给出的
  // 「重试」会真的发起一次 150MB 安装。
  it('探测失败说的是「没问出来」，给的动作是重新检查而不是重试安装', async () => {
    useChromiumStore.setState({ status: 'probe-failed', error: 'serve is down' })
    mocks.BundledChromiumPath.mockResolvedValue('')
    render(<BrowserPage />)

    expect(screen.getByText(/没能确认/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新检查' }))
    await waitFor(() => expect(useChromiumStore.getState().status).toBe('absent'))
    expect(mocks.InstallBundledChromium).not.toHaveBeenCalled()
  })

  // failed 曾是吸收态：没有任何 action 能把 status 送回 installed / absent，于是重装
  // 失败一次，这台机器在本次会话里就再也无法重装，只能退出重开应用。
  it('探测失败之后还能回到 installed：失败不再是走不出去的态', async () => {
    useChromiumStore.setState({ status: 'probe-failed', error: 'serve is down' })
    mocks.BundledChromiumPath.mockResolvedValue('/opt/app/chrome')
    render(<BrowserPage />)

    fireEvent.click(screen.getByRole('button', { name: '重新检查' }))
    await waitFor(() => expect(useChromiumStore.getState().status).toBe('installed'))
    expect(screen.getByRole('button', { name: '重新安装' })).toBeEnabled()
  })
})
