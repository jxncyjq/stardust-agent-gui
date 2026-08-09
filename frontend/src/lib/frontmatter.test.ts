import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from './frontmatter'

describe('parseFrontmatter', () => {
  it('splits frontmatter props and body', () => {
    const src = '---\nid: "x-1"\ntitle: 标题\ntags: [a, "b c"]\n---\n# 正文\nhello'
    const r = parseFrontmatter(src)
    expect(r.props).toEqual([
      { key: 'id', value: 'x-1' },
      { key: 'title', value: '标题' },
      { key: 'tags', value: 'a, b c' },
    ])
    expect(r.body).toBe('# 正文\nhello')
  })
  it('returns empty props and full body when no frontmatter', () => {
    const r = parseFrontmatter('# just body')
    expect(r.props).toEqual([])
    expect(r.body).toBe('# just body')
  })
  it('keeps nested/block values as raw string', () => {
    const r = parseFrontmatter('---\nrelated:\n  - a\n  - b\nid: 1\n---\nx')
    expect(r.props.find((p) => p.key === 'id')?.value).toBe('1')
  })
})
