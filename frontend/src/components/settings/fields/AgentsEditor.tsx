import { useEffect, useState } from 'react'
import { XIcon, PlusIcon, ChevronRightIcon } from '../../icons'
import { useUIStore } from '../../../stores/uiStore'

// AgentRow edits one sub-agent entry. The name is the map key, so it is edited
// through a local draft and only committed on blur/Enter: rewriting the key on
// every keystroke would momentarily produce empty or half-typed keys (and could
// clobber a sibling entry). An empty or duplicate name is rejected — the row
// turns red while it is invalid and reverts on blur rather than silently
// writing a broken key.
function AgentRow({
  name,
  path,
  otherNames,
  onRename,
  onPathChange,
  onRemove,
}: {
  name: string
  path: string
  otherNames: string[]
  onRename: (next: string) => void
  onPathChange: (next: string) => void
  onRemove: () => void
}) {
  const [draft, setDraft] = useState(name)

  // Re-sync when the committed name changes from the outside (add/remove/reload).
  useEffect(() => setDraft(name), [name])

  const trimmed = draft.trim()
  const invalid = trimmed === '' || (trimmed !== name && otherNames.includes(trimmed))

  function commit() {
    if (invalid) {
      setDraft(name)
      return
    }
    if (trimmed !== name) onRename(trimmed)
  }

  return (
    <div className="flex items-center gap-1">
      <input
        className={`text-xs px-2 py-1 rounded border bg-background w-32 shrink-0 font-mono ${
          invalid ? 'border-destructive' : 'border-input'
        }`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setDraft(name)
        }}
        aria-label={`子 Agent 名称：${name}`}
        aria-invalid={invalid}
        title={invalid ? '名称不能为空且不能重复' : '对应 workflow task.agent_id'}
      />
      <input
        className="text-xs px-2 py-1 rounded border border-input bg-background w-full"
        value={path ?? ''}
        onChange={(e) => onPathChange(e.target.value)}
        placeholder="configs/agents/xxx.json"
        aria-label={`${name} 的配置文件路径`}
        title="相对本配置文件所在目录解析"
      />
      <button
        type="button"
        className="interactive flex items-center gap-0.5 shrink-0 text-xs px-2 py-1 rounded border border-input hover:bg-muted disabled:opacity-50"
        onClick={() => useUIStore.getState().openAgent({ name, path: path.trim() })}
        disabled={!path?.trim()}
        aria-label={`编辑子 Agent ${name} 的配置`}
        title={path?.trim() ? '编辑该 Agent 的配置' : '先填写配置文件名'}
      >
        <span>配置</span>
        <ChevronRightIcon className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        className="interactive flex items-center justify-center px-2 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        aria-label={`删除子 Agent ${name}`}
      >
        <XIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// AgentsEditor edits the `agents` map: sub-agent name -> config file path. The
// name is the id a workflow task targets (task.agent_id); the path resolves
// relative to the directory holding agent.json. Entries can be added, renamed,
// repointed, and removed from the UI.
export function AgentsEditor({
  value,
  onChange,
}: {
  value: Record<string, string>
  onChange: (v: Record<string, string>) => void
}) {
  const agents = value && typeof value === 'object' ? value : {}
  const names = Object.keys(agents)

  // rename rebuilds the map in place so the edited entry keeps its position
  // instead of jumping to the end of the list.
  const rename = (from: string, to: string) => {
    const next: Record<string, string> = {}
    for (const n of names) {
      if (n === from) next[to] = agents[from]
      else next[n] = agents[n]
    }
    onChange(next)
  }

  const setPath = (name: string, path: string) => onChange({ ...agents, [name]: path })

  const remove = (name: string) => {
    const next = { ...agents }
    delete next[name]
    onChange(next)
  }

  const add = () => {
    let n = 'new-agent'
    let i = 1
    while (agents[n] !== undefined) n = `new-agent-${i++}`
    onChange({ ...agents, [n]: '' })
  }

  return (
    <div className="flex flex-col gap-1">
      {names.length === 0 && (
        <p className="text-[11px] text-muted-foreground">尚未配置子 Agent</p>
      )}
      {names.map((name) => (
        <AgentRow
          key={name}
          name={name}
          path={agents[name]}
          otherNames={names.filter((n) => n !== name)}
          onRename={(next) => rename(name, next)}
          onPathChange={(next) => setPath(name, next)}
          onRemove={() => remove(name)}
        />
      ))}
      <button
        type="button"
        className="interactive flex items-center gap-1 text-xs px-2 py-1 rounded border border-input hover:bg-muted text-left"
        onClick={add}
      >
        <PlusIcon className="w-3.5 h-3.5" />
        <span>添加子 Agent</span>
      </button>
    </div>
  )
}
