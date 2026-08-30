import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
describe('vitest worker budget', () => {
  it('caps the number of parallel test workers', () => {
    const source = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf8')
    const match = source.match(/maxWorkers:\s*(\d+)/)

    expect(match, 'vite.config.ts no longer caps maxWorkers; unbounded workers crash ~60% of runs').not.toBeNull()
    expect(Number(match?.[1])).toBeLessThanOrEqual(4)
  })
})
