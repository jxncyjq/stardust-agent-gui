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
    useChromiumStore.setState({ status: 'install-failed', lines: ['旧的一行'], error: '上次的失败' })
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
    expect(useChromiumStore.getState().status).toBe('install-failed')
    expect(useChromiumStore.getState().error).toBe('boom')
  })

  // 重装是先删后装：失败之后那个旧路径上可能已经什么都没有了。留着它会让 path 与
  // status 讲两个故事，而「重试」正要靠「现在到底有没有」来选入口。
  it('fail 之后 path 跟着作废，不再声称那里有一个浏览器', () => {
    useChromiumStore.setState({ status: 'installed', path: '/opt/app/chrome' })
    useChromiumStore.getState().start()
    useChromiumStore.getState().fail('下到一半断了')
    expect(useChromiumStore.getState().path).toBe('')
  })

  // 「没问出来」与「装失败了」是两件事：前者什么都没装过。说成安装失败会让用户以为
  // 刚刚发生过一次失败的安装，而恢复动作也会接到错误的入口上。
  it('failProbe 与 fail 是两个状态', () => {
    useChromiumStore.getState().failProbe('serve is down')
    expect(useChromiumStore.getState().status).toBe('probe-failed')
    expect(useChromiumStore.getState().error).toBe('serve is down')
  })

  // 重新探测就是重新确认事实，上一次的红字不该跟着留下来。
  it('setPresence 清掉上一次的错误', () => {
    useChromiumStore.getState().failProbe('serve is down')
    useChromiumStore.getState().setPresence('/opt/app/chrome')
    expect(useChromiumStore.getState().status).toBe('installed')
    expect(useChromiumStore.getState().error).toBeNull()
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
