import { describe, it, expect } from 'vitest'

// 这条测试钉住的是一个**容易被当成多余而删掉**的设置。
//
// vitest 默认按 CPU 数开子进程（开发这台机器 28 个），而那样大约六成的运行会有一个
// 子进程原生崩掉："Worker exited unexpectedly"——那个文件里的用例一条都没跑，汇总行
// 却照样是 all passed，只是文件数从 50 变成 49。一次少跑十几个用例的绿灯，比一条
// 红线危险得多。
//
// 读配置文件的**文本**而不是 import 它：在 jsdom 环境里 import vite.config.ts 会把
// vite 自己的运行时拖进来并炸在 TextEncoder 上。这里要断言的只是「那个上限还在」，
// 文本足够。
//
// 用 Vite 的 ?raw 而不是 node:fs：这个 tsconfig 没有 node 的类型，引 node:fs 会让
// tsc --noEmit 红——一条为了防止「测试没跑」而加的测试，自己把类型检查搞红是说不
// 过去的。
describe('vitest worker budget', () => {
  it('caps the number of parallel test workers', async () => {
    const source = (await import('../../vite.config.ts?raw')).default
    const match = source.match(/maxWorkers:\s*(\d+)/)

    expect(match, 'vite.config.ts no longer caps maxWorkers; unbounded workers crash ~60% of runs').not.toBeNull()
    expect(Number(match?.[1])).toBeLessThanOrEqual(4)
  })
})
