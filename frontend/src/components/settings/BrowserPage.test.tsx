import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  InstallBundledChromium: vi.fn(),
  ReinstallBundledChromium: vi.fn(),
}))
vi.mock('../../../wailsjs/go/main/App', () => ({
  InstallBundledChromium: mocks.InstallBundledChromium,
  ReinstallBundledChromium: mocks.ReinstallBundledChromium,
}))

import { BrowserPage } from './BrowserPage'
import { useChromiumStore } from '../../stores/chromiumStore'

describe('BrowserPage', () => {
  beforeEach(() => {
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
      status: 'failed',
      error: 'run the install script: exit status 1 ' + 'x'.repeat(400),
    })
    render(<BrowserPage />)
    expect(screen.getByText('安装内置浏览器失败。')).toBeInTheDocument()
    expect(screen.getByText(/exit status 1/).closest('details')).not.toBeNull()
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled()
  })

  // 绑定 reject 也要把界面带到 failed：事件掉了一次，不该让它永远停在「安装中」。
  it('绑定 reject 时也落到 failed', async () => {
    useChromiumStore.setState({ status: 'absent' })
    mocks.InstallBundledChromium.mockRejectedValue('serve is down')
    render(<BrowserPage />)
    fireEvent.click(screen.getByRole('button', { name: '安装内置浏览器' }))
    await waitFor(() => expect(useChromiumStore.getState().status).toBe('failed'))
  })
})
