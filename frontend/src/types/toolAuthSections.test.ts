import { describe, it, expect } from 'vitest'
import { AGENT_SECTIONS } from './agentConfig'
import { CONFIG_SECTIONS } from './config'

describe('Tool Authorization Sections', () => {
  it('sub-agent sections include a disabled_tools tool-checklist', () => {
    const field = AGENT_SECTIONS.flatMap((s) => s.fields).find((f) => f.path === 'disabled_tools')
    expect(field?.widget).toBe('tool-checklist')
  })

  it('main config runtime section includes runtime.disabled_tools tool-checklist', () => {
    const field = CONFIG_SECTIONS.flatMap((s) => s.fields).find((f) => f.path === 'runtime.disabled_tools')
    expect(field?.widget).toBe('tool-checklist')
  })
})
