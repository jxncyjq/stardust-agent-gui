import { beforeEach, describe, expect, it } from 'vitest'
import { maxInstallLines, useChromiumStore } from './chromiumStore'

describe('chromiumStore', () => {
  beforeEach(() => {
    useChromiumStore.setState({ status: 'unknown', path: '', lines: [], error: null })
  })

  // status 是显式状态机，不从 path 推导：「刚装完」与「本来就随包带着」在界面上要说的
  // 话不同，而 path 非空对两者都成立。
  it('setPresence 按路径有无落到 installed / absent', () => {
    useChromiumStore.getState().setPresence('/opt/app/chrome')
    expect(useChromiumStore.getState().status).toBe('installed')
    expect(useChromiumStore.getState().path).toBe('/opt/app/chrome')

    useChromiumStore.getState().setPresence('')
    expect(useChromiumStore.getState().status).toBe('absent')
    expect(useChromiumStore.getState().path).toBe('')
  })

  // 上一次失败的红字不能挂在这一次安装上（BrowserToolbar 记过同样的教训：一条过期的
  // 错误会一直遮住真实状态）。
  it('start 清掉上一次的输出与错误', () => {
    useChromiumStore.setState({ status: 'failed', lines: ['旧的一行'], error: '上次的失败' })
    useChromiumStore.getState().start()
    expect(useChromiumStore.getState().status).toBe('installing')
    expect(useChromiumStore.getState().lines).toEqual([])
    expect(useChromiumStore.getState().error).toBeNull()
  })

  it('succeed / fail 落到对应状态', () => {
    useChromiumStore.getState().start()
    useChromiumStore.getState().succeed('/opt/app/chrome')
    expect(useChromiumStore.getState().status).toBe('installed')
    expect(useChromiumStore.getState().path).toBe('/opt/app/chrome')

    useChromiumStore.getState().start()
    useChromiumStore.getState().fail('boom')
    expect(useChromiumStore.getState().status).toBe('failed')
    expect(useChromiumStore.getState().error).toBe('boom')
  })

  // 一次安装的输出行数没有上限，无界数组会一直涨。
  it('lines 只保留最近 maxInstallLines 行', () => {
    useChromiumStore.getState().start()
    for (let i = 0; i < maxInstallLines + 50; i++) {
      useChromiumStore.getState().appendLine(`line-${i}`)
    }
    const lines = useChromiumStore.getState().lines
    expect(lines).toHaveLength(maxInstallLines)
    expect(lines[0]).toBe('line-50')
    expect(lines[lines.length - 1]).toBe(`line-${maxInstallLines + 49}`)
  })
})
