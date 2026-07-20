import { describe, it, expect } from 'vitest'
import { mapSession, groupSessions } from './Sidebar'

// The sidebar groups by project only. A session's agent_id is frozen at
// creation while the answering agent is picked per submission, so an agent
// level here would display a value that contradicts what actually ran — it is
// labelled on each assistant message instead.
describe('groupSessions', () => {
  it('groups by project without an agent level', () => {
    const tree = groupSessions([
      { id: 's1', project: 'p', agent: 'default-agent', title: 't1', archived: false, updatedAt: '' },
      { id: 's2', project: 'p', agent: 'researcher', title: 't2', archived: false, updatedAt: '' },
    ])

    expect([...tree.keys()]).toEqual(['p'])
    // Both sessions sit directly under the project regardless of their agent.
    expect(tree.get('p')?.map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('falls back to 默认任务 for sessions without a project', () => {
    const tree = groupSessions([
      { id: 's1', project: '', agent: 'researcher', title: 't1', archived: false, updatedAt: '' },
    ])

    expect(tree.get('默认任务')?.map((s) => s.id)).toEqual(['s1'])
  })
})

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
