import { describe, it, expect } from 'vitest'
import { CONFIG_SECTIONS } from './config'

const allFields = CONFIG_SECTIONS.flatMap((s) => s.fields)
const paths = allFields.map((f) => f.path)

describe('CONFIG_SECTIONS', () => {
  it('covers all 14 config sections', () => {
    const keys = new Set(CONFIG_SECTIONS.map((s) => s.key))
    for (const k of [
      'maas', 'runtime', 'session', 'tui', 'context_files',
      'server', 'service', 'tasks', 'skills', 'web', 'evolution',
      'storage', 'workspace', 'agents',
    ]) {
      expect(keys.has(k)).toBe(true)
    }
  })

  it('marks every path/dir field readonly', () => {
    const mustBeReadonly = [
      'storage.driver', 'storage.path', 'server.listen_addr',
      'context_files.root', 'context_files.soul_path', 'context_files.tools_path',
      'context_files.user_path', 'context_files.memory_path',
      'workspace.docs_root', 'workspace.memory_root',
      'tasks.index_path', 'tasks.root', 'tasks.archive_root', 'skills.install_root',
    ]
    for (const p of mustBeReadonly) {
      const f = allFields.find((x) => x.path === p)
      expect(f, `missing field ${p}`).toBeTruthy()
      expect(f!.widget, `${p} should be readonly`).toBe('readonly')
    }
  })

  it('marks secret fields', () => {
    for (const p of ['maas.api_key', 'server.admin_token']) {
      expect(allFields.find((x) => x.path === p)?.widget).toBe('secret')
    }
  })

  it('exposes the sub-agent map as an editable widget, not readonly', () => {
    // agents is user-managed content (name -> sub-config path), editable from
    // the UI — it is deliberately NOT part of the readonly danger-path set.
    const agents = allFields.find((x) => x.path === 'agents')
    expect(agents?.widget).toBe('agents')
    expect(CONFIG_SECTIONS.find((s) => s.key === 'agents')?.advanced).toBe(false)
  })

  it('has no duplicate paths', () => {
    expect(new Set(paths).size).toBe(paths.length)
  })
})
