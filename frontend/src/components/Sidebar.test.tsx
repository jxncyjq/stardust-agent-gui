import { describe, it, expect } from 'vitest'
import { mapSession } from './Sidebar'

// mapSession normalizes the raw Wails ListSessions() record into the Session
// shape the store expects. This covers the `mode` field added for the
// per-session mode selector (ModeSelector): the backend's AgentSession.Mode
// must survive the raw -> Session mapping unmodified.
describe('mapSession', () => {
  it('carries the backend mode field through', () => {
    const session = mapSession({ id: 's1', project: 'p', agent_id: 'a', title: 't', mode: 'plan' })
    expect(session?.mode).toBe('plan')
  })

  it('leaves mode undefined when the backend omits it', () => {
    const session = mapSession({ id: 's1', project: 'p', agent_id: 'a', title: 't' })
    expect(session?.mode).toBeUndefined()
  })

  it('drops sessions without an id regardless of mode', () => {
    expect(mapSession({ mode: 'auto' })).toBeNull()
  })

  it('carries the backend working_dir field through as workingDir', () => {
    const session = mapSession({ id: 's1', project: 'p', agent_id: 'a', title: 't', working_dir: '/repo' })
    expect(session?.workingDir).toBe('/repo')
  })

  it('leaves workingDir undefined when the backend omits working_dir', () => {
    const session = mapSession({ id: 's1', project: 'p', agent_id: 'a', title: 't' })
    expect(session?.workingDir).toBeUndefined()
  })
})
