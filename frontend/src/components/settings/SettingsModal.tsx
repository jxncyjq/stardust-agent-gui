import { useEffect, useState } from 'react'
import { useConfigStore } from '../../stores/configStore'
import { CONFIG_SECTIONS, type SectionSpec } from '../../types/config'
import { FieldRenderer } from './fields/FieldRenderer'
import { ListTasks } from '../../../wailsjs/go/main/App'
import { XIcon, ChevronDownIcon, ChevronRightIcon, SpinnerIcon } from '../icons'
import { useUIStore } from '../../stores/uiStore'
import { AgentConfigPage } from './AgentConfigPage'

// activeTaskCount returns how many tracked tasks are still in a non-terminal
// state, so save can warn that a serve restart will interrupt them.
async function activeTaskCount(): Promise<number> {
  try {
    const tasks = (await ListTasks()) || []
    const done = new Set(['done', 'cancelled', 'failed', 'completed'])
    return tasks.filter((t: any) => !done.has(String(t?.status ?? '').toLowerCase())).length
  } catch {
    return 0 // if the service is unreachable there is nothing running to interrupt
  }
}

function Section({ section }: { section: SectionSpec }) {
  const [open, setOpen] = useState(!section.advanced)
  return (
    <div className="border-b border-border py-2">
      <button
        className="interactive w-full text-left text-sm font-semibold flex items-center gap-1 rounded px-1 hover:bg-muted"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDownIcon className="w-4 h-4 text-muted-foreground" /> : <ChevronRightIcon className="w-4 h-4 text-muted-foreground" />}
        <span>{section.title}</span>
      </button>
      {open && (
        <div className="pl-4 pt-1">
          <p className="text-[11px] text-muted-foreground mb-1">{section.help}</p>
          {section.fields.map((f) => (
            <FieldRenderer key={f.path} field={f} />
          ))}
        </div>
      )}
    </div>
  )
}

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { path, draft, dirty, saving, error, load, save } = useConfigStore()
  const editingAgent = useUIStore((s) => s.editingAgent)
  const closeAgent = useUIStore((s) => s.closeAgent)

  useEffect(() => {
    if (open) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  async function onSave() {
    const n = await activeTaskCount()
    if (n > 0 && !window.confirm(`有 ${n} 个进行中的任务。保存会重启内嵌服务并中断它们，继续？`)) {
      return
    }
    try {
      await save()
      onClose()
    } catch {
      // store already recorded the error; keep the modal open to show it.
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-lg shadow-xl w-[720px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <div className="flex flex-col">
            <span className="text-sm font-semibold">设置 · Agent 配置</span>
            <span className="text-[10px] text-muted-foreground truncate max-w-[560px]" title={path}>{path}</span>
          </div>
          <button
            className="interactive rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={onClose}
            aria-label="关闭设置"
          >
            <XIcon />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4">
          {!draft && !error && <p className="text-xs text-muted-foreground py-4">加载中…</p>}
          {draft && editingAgent && <AgentConfigPage agent={editingAgent} onBack={closeAgent} />}
          {draft && !editingAgent && CONFIG_SECTIONS.map((s) => <Section key={s.key} section={s} />)}
        </div>

        {error && <p className="text-xs text-destructive px-4 py-1 break-all">保存/加载失败：{error}</p>}

        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-border">
          <button className="interactive text-xs px-3 py-1 rounded hover:bg-muted text-muted-foreground" onClick={onClose}>取消</button>
          <button
            className="interactive flex items-center gap-1.5 text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            disabled={!dirty || saving}
            onClick={onSave}
          >
            {saving && <SpinnerIcon className="w-3.5 h-3.5" />}
            <span>{saving ? '保存中…' : '保存并重启'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
