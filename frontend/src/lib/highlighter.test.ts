import { describe, it, expect } from 'vitest'
import { highlightToHtml } from './highlighter'

describe('highlightToHtml', () => {
  it('returns shiki pre with colored spans for known lang', () => {
    const html = highlightToHtml('const x: number = 1', 'typescript')
    expect(html).toContain('<pre')
    expect(html).toContain('shiki')
    expect(html).toMatch(/style="[^"]*color/)
  })
  it('falls back to plain text for unknown lang (no throw)', () => {
    const html = highlightToHtml('随便文本', 'no-such-lang')
    expect(html).toContain('<pre')
  })
})
