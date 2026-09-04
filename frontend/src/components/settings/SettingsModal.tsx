import { useEffect, useState } from 'react'
import { useConfigStore } from '../../stores/configStore'
import { CONFIG_SECTIONS, type SectionSpec } from '../../types/config'
import { FieldRenderer } from './fields/FieldRenderer'
import { ListTasks } from '../../../wailsjs/go/main/App'
import { XIcon, ChevronDownIcon, ChevronRightIcon, SpinnerIcon } from '../icons'
import { useUIStore } from '../../stores/uiStore'
import { confirm, useConfirmStore } from '../../stores/confirmStore'
import { usePluginConsentStore } from '../../stores/pluginConsentStore'
import { AgentConfigPage } from './AgentConfigPage'
import { PluginsPage } from './PluginsPage'
import { BrowserPage } from './BrowserPage'

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
  const settingsTab = useUIStore((s) => s.settingsTab)
  const setSettingsTab = useUIStore((s) => s.setSettingsTab)
  // A plugin grant/deny/retry request is converging server-side and has no
  // abort semantics (see PluginConsentDialog's "no cancel while submitting"
  // rule) — closing the modal here would look like a cancel that never
  // actually happens, since the server call keeps running. This same
  // predicate must gate every door that reaches onClose: Escape, the
  // backdrop click, and the header X button. A row-level retryConvergence
  // (PluginsPage.tsx) has no overlay of its own the way PluginConsentDialog's
  // submitting phase does, so without this the backdrop/X are reachable and
  // would silently unmount the panel out from under a real in-flight request.
  // The 配置/插件 tab buttons are gated on it too: they do not reach onClose,
  // but they unmount PluginsPage just the same, which is the damage the guard
  // is actually about.
  const consentInFlight = usePluginConsentStore((s) => s.inFlight > 0)

  useEffect(() => {
    if (open) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      // A confirm dialog opened over this modal (e.g. save-restart warning) owns
      // Esc first; closing the settings modal underneath it would be wrong.
      if (useConfirmStore.getState().request) return
      if (consentInFlight) return
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose, consentInFlight])

  if (!open) return null

  async function onSave() {
    const n = await activeTaskCount()
    if (n > 0 && !(await confirm({
      title: '保存并重启',
      message: `有 ${n} 个进行中的任务。保存会重启内嵌服务并中断它们，继续？`,
      confirmLabel: '保存并重启',
      danger: true,
    }))) {
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={() => {
        // Same refusal as the Escape guard above — see consentInFlight's
        // comment. Without this, the backdrop is a second door that looks
        // exactly like a cancel and cancels nothing.
        if (consentInFlight) return
        onClose()
      }}
    >
      <div
        className="bg-background border border-border rounded-lg shadow-xl w-full max-w-[720px] mx-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <div className="flex flex-col">
            <span className="text-sm font-semibold">
              {settingsTab === 'plugins' ? '设置 · 插件授权' : settingsTab === 'browser' ? '设置 · 浏览器' : '设置 · Agent 配置'}
            </span>
            <span className="text-[10px] text-muted-foreground truncate max-w-[560px]" title={path}>{path}</span>
          </div>
          <div className="flex items-center gap-2">
            {!editingAgent && (
              // The tab buttons are gated on consentInFlight for the same
              // reason Escape / the backdrop / the X are, even though they do
              // not close the modal: switching tabs UNMOUNTS PluginsPage,
              // which is where `resolved`, `resolveError` and the consent
              // dialog live, so it discards the result of the request the
              // operator is waiting on. PluginConsentDialog's own submit is
              // covered by its fixed inset-0 z-[70] overlay, but
              // retryConvergence and resolveDeclaration have no overlay at
              // all — these were the last two clickable doors into that.
              <div className="flex items-center gap-1">
                <button
                  className={`interactive text-xs px-2 py-1 rounded disabled:opacity-50 disabled:hover:bg-transparent ${settingsTab === 'config' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                  onClick={() => setSettingsTab('config')}
                  disabled={consentInFlight}
                  title={consentInFlight ? '插件授权正在收敛，暂时无法切换' : undefined}
                >
                  配置
                </button>
                <button
                  className={`interactive text-xs px-2 py-1 rounded disabled:opacity-50 disabled:hover:bg-transparent ${settingsTab === 'plugins' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                  onClick={() => setSettingsTab('plugins')}
                  disabled={consentInFlight}
                  title={consentInFlight ? '插件授权正在收敛，暂时无法切换' : undefined}
                >
                  插件
                </button>
                <button
                  className={`interactive text-xs px-2 py-1 rounded disabled:opacity-50 disabled:hover:bg-transparent ${settingsTab === 'browser' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                  onClick={() => setSettingsTab('browser')}
                  disabled={consentInFlight}
                  title={consentInFlight ? '插件授权正在收敛，暂时无法切换' : undefined}
                >
                  浏览器
                </button>
              </div>
            )}
            <button
              className="interactive rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent"
              onClick={onClose}
              disabled={consentInFlight}
              aria-label="关闭设置"
              title={consentInFlight ? '插件授权正在收敛，暂时无法关闭' : undefined}
            >
              <XIcon />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4">
          {settingsTab === 'plugins' ? (
            <PluginsPage />
          ) : settingsTab === 'browser' ? (
            <BrowserPage />
          ) : (
            <>
              {!draft && !error && <p className="text-xs text-muted-foreground py-4">加载中…</p>}
              {draft && editingAgent && <AgentConfigPage agent={editingAgent} onBack={closeAgent} />}
              {draft && !editingAgent && CONFIG_SECTIONS.map((s) => <Section key={s.key} section={s} />)}
            </>
          )}
        </div>

        {settingsTab === 'config' && error && <p className="text-xs text-destructive px-4 py-1 break-all">保存/加载失败：{error}</p>}

        {/* The plugin panel and the browser page each act on their own
            (plugin grant/deny calls; a Chromium install that runs
            independently in chromiumStore), independent of this draft's
            save/restart flow, so neither has a place in this footer —
            closing via the X or Esc is enough. */}
        {settingsTab === 'config' && (
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
        )}
      </div>
    </div>
  )
}
