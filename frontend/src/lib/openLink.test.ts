import { describe, it, expect, vi, beforeEach } from 'vitest'

const runtimeMocks = vi.hoisted(() => ({ BrowserOpenURL: vi.fn() }))
vi.mock('../../wailsjs/runtime/runtime', () => runtimeMocks)

import { openLink } from './openLink'

describe('openLink', () => {
  beforeEach(() => runtimeMocks.BrowserOpenURL.mockClear())

  it('opens http urls in the system browser', () => {
    openLink('http://example.com/a')
    expect(runtimeMocks.BrowserOpenURL).toHaveBeenCalledWith('http://example.com/a')
  })

  it('opens https urls in the system browser', () => {
    openLink('https://example.com')
    expect(runtimeMocks.BrowserOpenURL).toHaveBeenCalledWith('https://example.com')
  })

  it('ignores javascript: urls', () => {
    openLink('javascript:alert(1)')
    expect(runtimeMocks.BrowserOpenURL).not.toHaveBeenCalled()
  })

  it('ignores file: urls', () => {
    openLink('file:///etc/passwd')
    expect(runtimeMocks.BrowserOpenURL).not.toHaveBeenCalled()
  })

  it('ignores malformed input', () => {
    openLink('not a url')
    expect(runtimeMocks.BrowserOpenURL).not.toHaveBeenCalled()
  })
})
