import { useEffect, useState } from 'react'
import {
  ListSessions,
  NewSession,
  RenameSession,
  DeleteSession,
  SetSessionArchived,
  RenameProject,
  DeleteProject,
  SetProjectArchived,
} from '../../wailsjs/go/main/App'
import { useSessionStore, type Session } from '../stores/sessionStore'
import { useUIStore } from '../stores/uiStore'
import { SettingsIcon, PlusIcon, ChevronDownIcon, ChevronRightIcon } from './icons'
import { cn } from '../lib/utils'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'

// mapSession normalizes the loosely-typed Wails binding result (Record<string,
// any> from the Go map) into the Session shape the store expects. Sessions
// without an id are dropped rather than rendered as broken rows.
export function mapSession(raw: any): Session | null {
  const id = String(raw?.id ?? '')
  if (!id) return null
  return {
    id,
    project: String(raw?.project ?? ''),
    agent: String(raw?.agent_id ?? ''),
    title: String(raw?.title ?? ''),
    archived: Boolean(raw?.archived ?? false),
    updatedAt: String(raw?.updated_at ?? ''),
    mode: raw?.mode != null ? String(raw.mode) : undefined,
    workingDir: raw?.working_dir != null ? String(raw.working_dir) : undefined,
  }
}

// groupSessions builds the two-level project -> agent -> sessions structure used
// for the sidebar tree.
function groupSessions(sessions: Session[]): Map<string, Map<string, Session[]>> {
  const byProject = new Map<string, Map<string, Session[]>>()
  for (const session of sessions) {
    const projectKey = session.project || '默认任务'
    const agentKey = session.agent || 'default-agent'
    let byAgent = byProject.get(projectKey)
    if (!byAgent) {
      byAgent = new Map<string, Session[]>()
      byProject.set(projectKey, byAgent)
    }
    const list = byAgent.get(agentKey) ?? []
    list.push(session)
    byAgent.set(agentKey, list)
  }
  return byProject
}

// menuTarget records what was right-clicked and where the menu should appear.
type MenuTarget =
  | { kind: 'session'; session: Session; x: number; y: number }
  | { kind: 'project'; project: string; archived: boolean; ids: string[]; x: number; y: number }

export function Sidebar() {
  const { sessions, currentSessionId, setSessions, setCurrentSession } = useSessionStore()
  const [creating, setCreating] = useState(false)
  const [projectInput, setProjectInput] = useState('')
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  // renaming holds the id ("session:<id>" or "project:<name>") currently being
  // renamed inline, plus the draft text.
  const [renaming, setRenaming] = useState<{ key: string; value: string } | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  async function loadSessions() {
    try {
      const result = await ListSessions()
      const mapped = (result || [])
        .map(mapSession)
        .filter((s): s is Session => s !== null)
      setSessions(mapped)
    } catch {
      // serve not ready yet; the next interval tick will retry.
    }
  }

  useEffect(() => {
    loadSessions()
    const id = setInterval(loadSessions, 5000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function createSession() {
    const project = projectInput.trim() || '默认任务'
    try {
      const created = await NewSession(project, '')
      const mapped = mapSession(created)
      await loadSessions()
      if (mapped) {
        setCurrentSession(mapped.id)
      }
      setProjectInput('')
      setCreating(false)
    } catch (err) {
      // Surface the failure instead of hiding it: keep the input open so the
      // user can retry, and log the reason for diagnosis.
      console.error('create session failed:', err)
    }
  }

  // After a destructive or mutating action, refresh the list and, if the active
  // session was removed, clear the selection so the chat panel empties.
  async function refreshAfter(removedIds: string[] = []) {
    if (removedIds.includes(currentSessionId)) {
      setCurrentSession('')
    }
    await loadSessions()
  }

  async function commitRename() {
    if (!renaming) return
    const value = renaming.value.trim()
    const [kind, ...rest] = renaming.key.split(':')
    const target = rest.join(':')
    setRenaming(null)
    if (!value) return
    try {
      if (kind === 'session') {
        await RenameSession(target, value)
      } else if (kind === 'project') {
        await RenameProject(target, value)
      }
      await loadSessions()
    } catch (err) {
      console.error('rename failed:', err)
    }
  }

  function sessionMenuItems(session: Session): ContextMenuItem[] {
    return [
      {
        label: '重命名',
        onSelect: () =>
          setRenaming({ key: `session:${session.id}`, value: session.title }),
      },
      {
        label: session.archived ? '取消归档' : '归档',
        onSelect: async () => {
          try {
            await SetSessionArchived(session.id, !session.archived)
            await loadSessions()
          } catch (err) {
            console.error('archive session failed:', err)
          }
        },
      },
      {
        label: '删除',
        destructive: true,
        onSelect: async () => {
          if (!window.confirm(`确认删除会话「${session.title || session.id}」？此操作不可撤销。`)) {
            return
          }
          try {
            await DeleteSession(session.id)
            await refreshAfter([session.id])
          } catch (err) {
            console.error('delete session failed:', err)
          }
        },
      },
    ]
  }

  function projectMenuItems(project: string, archived: boolean, ids: string[]): ContextMenuItem[] {
    return [
      {
        label: '重命名',
        onSelect: () => setRenaming({ key: `project:${project}`, value: project }),
      },
      {
        label: archived ? '取消归档' : '归档',
        onSelect: async () => {
          try {
            await SetProjectArchived(project, !archived)
            await loadSessions()
          } catch (err) {
            console.error('archive project failed:', err)
          }
        },
      },
      {
        label: '删除整组',
        destructive: true,
        onSelect: async () => {
          if (!window.confirm(`确认删除项目「${project}」下的全部会话？此操作不可撤销。`)) {
            return
          }
          try {
            await DeleteProject(project)
            await refreshAfter(ids)
          } catch (err) {
            console.error('delete project failed:', err)
          }
        },
      },
    ]
  }

  const active = sessions.filter((s) => !s.archived)
  const archived = sessions.filter((s) => s.archived)
  const grouped = groupSessions(active)
  const groupedArchived = groupSessions(archived)

  function renameInput(key: string) {
    return (
      <input
        autoFocus
        className="text-xs px-2 py-1 rounded border border-input bg-background w-full"
        value={renaming?.value ?? ''}
        onChange={(e) => setRenaming({ key, value: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitRename()
          if (e.key === 'Escape') setRenaming(null)
        }}
        onBlur={commitRename}
      />
    )
  }

  function sessionRow(session: Session) {
    const key = `session:${session.id}`
    if (renaming?.key === key) {
      return <div key={session.id} className="ml-2">{renameInput(key)}</div>
    }
    return (
      <button
        key={session.id}
        className={cn(
          'interactive text-left text-xs px-2 py-1 rounded truncate ml-2',
          currentSessionId === session.id
            ? 'bg-accent text-accent-foreground'
            : 'hover:bg-muted text-muted-foreground hover:text-foreground'
        )}
        onClick={() => setCurrentSession(session.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ kind: 'session', session, x: e.clientX, y: e.clientY })
        }}
      >
        {session.title || session.id}
      </button>
    )
  }

  function projectTree(
    tree: Map<string, Map<string, Session[]>>,
    isArchived: boolean
  ) {
    return [...tree.entries()].map(([project, byAgent]) => {
      const ids = [...byAgent.values()].flat().map((s) => s.id)
      const projectKey = `project:${project}`
      return (
        <div key={project} className="flex flex-col gap-1">
          {renaming?.key === projectKey ? (
            renameInput(projectKey)
          ) : (
            <p
              className="text-xs font-semibold text-foreground px-1 truncate cursor-default"
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ kind: 'project', project, archived: isArchived, ids, x: e.clientX, y: e.clientY })
              }}
            >
              {project}
            </p>
          )}
          {[...byAgent.entries()].map(([agent, agentSessions]) => (
            <div key={agent} className="flex flex-col gap-0.5 pl-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-1 truncate">
                {agent}
              </p>
              {agentSessions.map((session) => sessionRow(session))}
            </div>
          ))}
        </div>
      )
    })
  }

  return (
    <div className="h-full flex flex-col">
    <div className="p-2 flex flex-col gap-2 flex-1 overflow-y-auto">
      {/* New session */}
      {creating ? (
        <div className="flex flex-col gap-1">
          <input
            autoFocus
            className="text-xs px-2 py-1 rounded border border-input bg-background"
            placeholder="任务/项目名"
            value={projectInput}
            onChange={(e) => setProjectInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createSession()
              if (e.key === 'Escape') {
                setCreating(false)
                setProjectInput('')
              }
            }}
          />
          <div className="flex gap-1">
            <button
              className="interactive flex-1 text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
              onClick={createSession}
            >
              创建
            </button>
            <button
              className="interactive text-xs px-2 py-1 rounded hover:bg-muted text-muted-foreground"
              onClick={() => {
                setCreating(false)
                setProjectInput('')
              }}
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          className="interactive flex items-center gap-1.5 text-left text-xs px-2 py-1 rounded border border-input hover:bg-muted text-foreground"
          onClick={() => setCreating(true)}
        >
          <PlusIcon className="w-3.5 h-3.5" />
          <span>新建会话</span>
        </button>
      )}

      {/* Two-level grouped session tree (active only) */}
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground px-1">会话</p>
        {projectTree(grouped, false)}
      </div>

      {/* Collapsible archived area */}
      {archived.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border pt-2">
          <button
            className="interactive flex items-center gap-1 text-left text-xs text-muted-foreground px-1 hover:text-foreground"
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
          >
            {showArchived ? <ChevronDownIcon className="w-3.5 h-3.5" /> : <ChevronRightIcon className="w-3.5 h-3.5" />}
            <span>已归档 ({archived.length})</span>
          </button>
          {showArchived && (
            <div className="flex flex-col gap-2 opacity-70">
              {projectTree(groupedArchived, true)}
            </div>
          )}
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={
            menu.kind === 'session'
              ? sessionMenuItems(menu.session)
              : projectMenuItems(menu.project, menu.archived, menu.ids)
          }
          onClose={() => setMenu(null)}
        />
      )}
    </div>

      {/* Bottom settings entry */}
      <div className="border-t border-border p-2">
        <button
          className="interactive w-full text-left text-xs px-2 py-1 rounded hover:bg-muted hover:text-foreground text-muted-foreground flex items-center gap-2"
          onClick={() => useUIStore.getState().openSettings()}
          aria-label="打开设置"
        >
          <SettingsIcon className="w-4 h-4" />
          <span>设置</span>
        </button>
      </div>
    </div>
  )
}
