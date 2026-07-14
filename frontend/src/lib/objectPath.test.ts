import { describe, it, expect } from 'vitest'
import { getPath, setPath } from './objectPath'

describe('objectPath', () => {
  it('reads nested values', () => {
    const o = { a: { b: { c: 5 } } }
    expect(getPath(o, 'a.b.c')).toBe(5)
    expect(getPath(o, 'a.b.x')).toBeUndefined()
    expect(getPath(o, 'z.y')).toBeUndefined()
  })

  it('sets nested values immutably', () => {
    const o = { a: { b: { c: 1 } }, keep: 9 }
    const next = setPath(o, 'a.b.c', 2)
    expect(next.a.b.c).toBe(2)
    expect(next.keep).toBe(9)
    expect(o.a.b.c).toBe(1) // original untouched
    expect(next).not.toBe(o)
    expect(next.a).not.toBe(o.a)
  })

  it('creates missing intermediate objects', () => {
    const next = setPath({} as any, 'x.y.z', 7)
    expect(next.x.y.z).toBe(7)
  })
})
