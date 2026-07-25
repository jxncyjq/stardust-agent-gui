import { describe, it, expect, beforeEach } from 'vitest'
import { useConfirmStore, confirm } from './confirmStore'

beforeEach(() => useConfirmStore.setState({ request: null }))

describe('confirmStore', () => {
  it('confirm() sets a request and resolves true when accepted', async () => {
    const p = confirm({ title: 't', message: 'm' })
    expect(useConfirmStore.getState().request?.title).toBe('t')
    useConfirmStore.getState().accept()
    await expect(p).resolves.toBe(true)
    expect(useConfirmStore.getState().request).toBeNull()
  })

  it('confirm() resolves false when cancelled', async () => {
    const p = confirm({ title: 't', message: 'm' })
    useConfirmStore.getState().cancel()
    await expect(p).resolves.toBe(false)
    expect(useConfirmStore.getState().request).toBeNull()
  })

  it('applies defaults for labels and danger', () => {
    confirm({ title: 't', message: 'm' })
    const r = useConfirmStore.getState().request!
    expect(r.confirmLabel).toBe('确认')
    expect(r.cancelLabel).toBe('取消')
    expect(r.danger).toBe(false)
  })

  it('a second confirm supersedes the first, resolving the first to false', async () => {
    const first = confirm({ title: 't1', message: 'm1' })
    const second = confirm({ title: 't2', message: 'm2' })
    // 第一个被顶掉 → resolve false，不泄漏
    await expect(first).resolves.toBe(false)
    // store 现在展示的是第二个
    expect(useConfirmStore.getState().request?.title).toBe('t2')
    // 第二个正常接受 → true
    useConfirmStore.getState().accept()
    await expect(second).resolves.toBe(true)
  })
})
