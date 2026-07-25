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
})
