import { useEffect, useState } from 'react'
import { ListPlugins, GrantPlugin, DenyPlugin } from '../../../wailsjs/go/main/App'
import { main } from '../../../wailsjs/go/models'
import { PluginConsentDialog } from './PluginConsentDialog'
import { SpinnerIcon } from '../icons'
import { beginPluginConsent, endPluginConsent } from '../../stores/pluginConsentStore'

// errText renders an unknown error value as a string, matching the small
// local helper ApprovalPrompt.tsx/PluginConsentDialog.tsx each keep for the
// same purpose rather than sharing one across files.
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ConsentOverride is what a completed Grant/Deny call leaves behind for one
// plugin row, so the row can render the fresh outcome immediately instead of
// waiting on a manual refresh (ListPlugins carries no push/SSE channel).
// mode records which call produced it, so a "重试收敛" retry resubmits the
// SAME kind of request.
interface ConsentOverride {
  result: main.ConsentResultDTO
  mode: 'grant' | 'deny'
}

// STATE_LABELS/STATE_BADGE_CLASS cover every state internal/cli's
// mergePluginStatus and internal/plugin/loader report today (unauthorized,
// disabled, pending, loaded, suspended, failed). An unrecognized state
// string still renders — via stateLabel/stateBadgeClass's fallback — rather
// than throwing: the backend contract for this string is "value from a
// worked-out list", not "value validated turn by turn", so a forward-
// compatible fallback here is a legitimate default, not a swallowed error.
const STATE_LABELS: Record<string, string> = {
  unauthorized: '未授权',
  disabled: '已禁用',
  pending: '待生效',
  loaded: '运行中',
  suspended: '已暂停',
  failed: '失败',
}

const STATE_BADGE_CLASS: Record<string, string> = {
  unauthorized: 'border-amber-500 text-amber-600',
  disabled: 'border-muted-foreground text-muted-foreground',
  pending: 'border-sky-500 text-sky-600',
  loaded: 'border-emerald-500 text-emerald-600',
  suspended: 'border-sky-500 text-sky-600',
  failed: 'border-destructive text-destructive',
}

function stateLabel(state: string): string {
  return STATE_LABELS[state] ?? (state || '未知')
}

function stateBadgeClass(state: string): string {
  return STATE_BADGE_CLASS[state] ?? 'border-border text-foreground'
}

// PluginsPage is the plugin consent panel: one row per deployment entry
// (Task 4's ListPlugins binding), each with an authorization-state badge and
// the grant/deny action that fits its state.
//
// unauthorized ("nobody ever decided") and disabled ("somebody decided no")
// render with different badges, different body text and a different next
// step on purpose: unauthorized prompts "授权" as the obvious next action,
// disabled does not push the user toward re-authorizing (a muted, low-
// emphasis link instead of a primary call to action) because a deliberate
// "no" is not the same situation as "nobody decided yet".
export function PluginsPage() {
  const [plugins, setPlugins] = useState<main.PluginDTO[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [overrides, setOverrides] = useState<Record<string, ConsentOverride>>({})
  const [dialog, setDialog] = useState<{ plugin: main.PluginDTO; mode: 'grant' | 'deny' } | null>(null)
  const [retrying, setRetrying] = useState<Record<string, boolean>>({})
  const [retryError, setRetryError] = useState<Record<string, string>>({})

  // load fetches the authoritative list from the server and clears every
  // override: a fresh List() result is the truth this page defers to, and
  // holding onto a stale override past a manual refresh would be exactly
  // the kind of quiet drift fail-loud exists to avoid.
  async function load() {
    try {
      const result = await ListPlugins()
      setPlugins(result ?? [])
      setLoadError('')
      setOverrides({})
    } catch (err) {
      // Surfaced, not swallowed: a failed list call must not read as "no
      // plugins installed".
      setLoadError(errText(err))
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // retryConvergence resubmits the exact same kind of request the pending
  // override came from, using the GRANTED fields the previous response
  // reported (what is already ON DISK — see server.ConsentResult's own doc
  // comment), not whatever the dialog's checkboxes happened to hold at
  // submit time. Re-submitting the disk truth is what makes this a safe,
  // idempotent retry rather than a second, possibly different, request.
  async function retryConvergence(name: string) {
    const ov = overrides[name]
    if (!ov) return
    setRetrying((r) => ({ ...r, [name]: true }))
    setRetryError((e) => ({ ...e, [name]: '' }))
    // Same "in flight" registration as PluginConsentDialog's submit() — a
    // row-level retry is the same kind of unabortable server-side
    // convergence wait, and SettingsModal's Escape guard must see it too.
    beginPluginConsent()
    try {
      const res =
        ov.mode === 'grant'
          ? await GrantPlugin(
              name,
              ov.result.granted_capabilities,
              ov.result.granted_allowed_hosts,
              ov.result.granted_allowed_paths,
            )
          : await DenyPlugin(name)
      setOverrides((prev) => ({ ...prev, [name]: { ...ov, result: res } }))
    } catch (err) {
      setRetryError((e) => ({ ...e, [name]: errText(err) }))
    } finally {
      setRetrying((r) => ({ ...r, [name]: false }))
      endPluginConsent()
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between py-2 border-b border-border">
        <span className="text-sm font-semibold">插件授权</span>
        <button
          type="button"
          className="interactive text-xs px-2 py-1 rounded hover:bg-muted text-muted-foreground"
          onClick={load}
        >
          刷新
        </button>
      </div>

      {loadError && <p className="text-xs text-destructive py-2 break-all">加载插件列表失败：{loadError}</p>}
      {!plugins && !loadError && <p className="text-xs text-muted-foreground py-4">加载中…</p>}
      {plugins && plugins.length === 0 && !loadError && (
        <p className="text-xs text-muted-foreground py-4">此部署未配置任何插件。</p>
      )}

      <div className="flex flex-col gap-2 py-2">
        {plugins?.map((plugin) => (
          <PluginRow
            key={plugin.name}
            plugin={plugin}
            override={overrides[plugin.name]}
            retrying={!!retrying[plugin.name]}
            retryError={retryError[plugin.name] ?? ''}
            onGrant={() => setDialog({ plugin, mode: 'grant' })}
            onDeny={() => setDialog({ plugin, mode: 'deny' })}
            onRetryConvergence={() => retryConvergence(plugin.name)}
          />
        ))}
      </div>

      {dialog && (
        <PluginConsentDialog
          plugin={dialog.plugin}
          mode={dialog.mode}
          onClose={() => setDialog(null)}
          onResult={(result) => {
            setOverrides((prev) => ({ ...prev, [result.name]: { result, mode: dialog.mode } }))
          }}
        />
      )}
    </div>
  )
}

function PluginRow({
  plugin,
  override,
  retrying,
  retryError,
  onGrant,
  onDeny,
  onRetryConvergence,
}: {
  plugin: main.PluginDTO
  override?: ConsentOverride
  retrying: boolean
  retryError: string
  onGrant: () => void
  onDeny: () => void
  onRetryConvergence: () => void
}) {
  // PendingConvergence has no bearing on plugin.state at all — it means the
  // write already landed but nothing converged, so State/Detail/Tools on
  // the response are empty by contract (see server.ConsentResult's doc
  // comment). Falling through to plugin.state here would render whatever
  // the LAST list fetch happened to show, misrepresenting "authorized,
  // awaiting convergence" as unrelated old state.
  const pending = override?.result.pending_convergence ?? false
  const state = pending ? '' : (override?.result.state ?? plugin.state)
  const detail = pending ? '' : (override?.result.detail ?? plugin.detail ?? '')

  return (
    <div
      className="border border-border rounded p-2 flex flex-col gap-1"
      role="group"
      aria-label={`插件 ${plugin.name}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold truncate">{plugin.name}</span>
          <span className="text-[10px] text-muted-foreground">{plugin.version}</span>
        </div>
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${
            pending ? 'border-indigo-500 text-indigo-600' : stateBadgeClass(state)
          }`}
        >
          {pending ? '待收敛' : stateLabel(state)}
        </span>
      </div>

      {retrying ? (
        // Rule 3 applies here too: a retry-in-flight is the same kind of
        // server-side convergence wait a fresh grant/deny is, so this row
        // renders no button — cancel or otherwise — for as long as it runs.
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1" role="status">
          <SpinnerIcon className="w-3.5 h-3.5" />
          <span>正在重试收敛，请稍候……</span>
        </div>
      ) : pending ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs">已授权，等待收敛生效。</p>
          {override?.result.convergence_detail && (
            <p className="text-xs text-muted-foreground break-all">{override.result.convergence_detail}</p>
          )}
          {retryError && <p className="text-xs text-destructive break-all">重试失败：{retryError}</p>}
          <div>
            <button
              type="button"
              className="interactive text-xs px-2 py-1 rounded border border-input hover:bg-muted"
              onClick={onRetryConvergence}
            >
              重试收敛
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {plugin.declared_unresolved && (
            // Distinct from "this plugin requests nothing" on purpose — see
            // PluginConsentDialog's own doc comment for the same rule
            // inside the grant dialog.
            <p className="text-xs text-muted-foreground">该插件的能力声明尚未在本地解析（远程包尚未缓存）。</p>
          )}
          {state === 'unauthorized' && (
            <>
              <p className="text-xs text-muted-foreground">尚无授权决定。</p>
              <div>
                <button
                  type="button"
                  className="interactive text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
                  onClick={onGrant}
                >
                  授权
                </button>
              </div>
            </>
          )}
          {state === 'disabled' && (
            <>
              <p className="text-xs text-muted-foreground">该插件的授权已被拒绝。</p>
              <div>
                <button
                  type="button"
                  className="interactive text-xs px-2 py-1 rounded border border-input hover:bg-muted text-muted-foreground"
                  onClick={onGrant}
                >
                  重新授权
                </button>
              </div>
            </>
          )}
          {state !== 'unauthorized' && state !== 'disabled' && (
            <>
              {detail && (
                <p className="text-xs text-muted-foreground break-all">
                  {state === 'failed' ? `原因：${detail}` : detail}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="interactive text-xs px-2 py-1 rounded border border-input hover:bg-muted text-muted-foreground"
                  onClick={onGrant}
                >
                  重新授权
                </button>
                <button
                  type="button"
                  className="interactive text-xs px-2 py-1 rounded border border-input hover:bg-muted text-muted-foreground"
                  onClick={onDeny}
                >
                  撤销授权
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
