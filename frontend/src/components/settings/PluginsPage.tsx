import { useEffect, useState } from 'react'
import { ListPlugins, GrantPlugin, DenyPlugin, ResolvePlugin } from '../../../wailsjs/go/main/App'
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

// UNTRUSTED_MARKER must stay byte-for-byte in sync with errPluginUntrusted's
// message in legionAgentGUI's app_plugins.go (`插件包不被信任`). Go-side,
// ResolvePlugin identifies a 422 STRUCTURALLY — errors.As against
// httpStatusError's numeric HTTP status, not by parsing response text (see
// that function's doc comment). But a Wails-bound method's error crosses to
// JS as nothing more than the wrapped error's Error() string: no status
// code, no error type, survives the boundary. So matching this substring
// really is the only thing the JS side has to key on — not a shortcut
// around a better mechanism, but the actual contract this file depends on.
// It is fragile in exactly the way that implies: renaming errPluginUntrusted's
// message on the Go side silently breaks this check with no compile error
// on either side.
const UNTRUSTED_MARKER = '插件包不被信任'

function isUntrustedResolveError(message: string): boolean {
  return message.includes(UNTRUSTED_MARKER)
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
  const [resolving, setResolving] = useState<Record<string, boolean>>({})
  const [resolveError, setResolveError] = useState<Record<string, string>>({})
  // resolved holds the successful ResolvePlugin() view per plugin name. It is
  // deliberately NOT cleared by load(): fetching does not write plugins.json
  // (Rule 2 in the brief this implements), so a manual refresh must not make
  // the operator lose a fetch they already paid the download cost for, or
  // "已取回并缓存该插件包" would stop being true the moment they clicked 刷新.
  const [resolved, setResolved] = useState<Record<string, main.PluginDTO>>({})

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

  // resolveDeclaration fetches and verifies one plugin's package (Task 4's
  // ResolvePlugin, POST /v1/plugins/{name}/resolve) WITHOUT authorizing
  // anything, so an operator can preview an uncached remote package's
  // declaration before deciding whether to grant it. It really downloads,
  // so it registers in flight exactly the way retryConvergence does above:
  // SettingsModal's Escape / title-bar X / backdrop-click guards must be
  // able to see it, or an operator pressing Escape closes the window while
  // the server is still downloading.
  async function resolveDeclaration(name: string) {
    setResolving((r) => ({ ...r, [name]: true }))
    setResolveError((e) => ({ ...e, [name]: '' }))
    beginPluginConsent()
    try {
      const res = await ResolvePlugin(name)
      setResolved((prev) => ({ ...prev, [name]: res }))
    } catch (err) {
      setResolveError((e) => ({ ...e, [name]: errText(err) }))
    } finally {
      setResolving((r) => ({ ...r, [name]: false }))
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
            resolved={resolved[plugin.name]}
            resolving={!!resolving[plugin.name]}
            resolveError={resolveError[plugin.name] ?? ''}
            // A fetched declaration (resolved[plugin.name]) supersedes the
            // stale one ListPlugins returned, or the dialog would open on the
            // ORIGINAL declared_unresolved:true/empty-capabilities view and
            // stay stuck disabling its own confirm button — silently
            // defeating the whole point of fetching first.
            onGrant={() => setDialog({ plugin: resolved[plugin.name] ?? plugin, mode: 'grant' })}
            onDeny={() => setDialog({ plugin: resolved[plugin.name] ?? plugin, mode: 'deny' })}
            onRetryConvergence={() => retryConvergence(plugin.name)}
            onResolve={() => resolveDeclaration(plugin.name)}
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
  resolved,
  resolving,
  resolveError,
  onGrant,
  onDeny,
  onRetryConvergence,
  onResolve,
}: {
  plugin: main.PluginDTO
  override?: ConsentOverride
  retrying: boolean
  retryError: string
  // resolved is the successful ResolvePlugin() view for this plugin, if the
  // operator has fetched its declaration this session. It only ever narrows
  // declared_unresolved from true to false — see resolveDeclaration's own
  // comment for why it survives a manual list refresh.
  resolved?: main.PluginDTO
  resolving: boolean
  resolveError: string
  onGrant: () => void
  onDeny: () => void
  onRetryConvergence: () => void
  onResolve: () => void
}) {
  // effectivePlugin is what this row actually renders declared_* from: once
  // a fetch has succeeded, the row shows what was JUST fetched, not the
  // stale declared_unresolved:true snapshot ListPlugins returned before the
  // fetch. name/version keep coming from `plugin` — ResolvePlugin's request
  // path is keyed by name, so that never changes across a fetch.
  const effectivePlugin = resolved ?? plugin
  const untrustedResolve = resolveError !== '' && isUntrustedResolveError(resolveError)
  // PendingConvergence has no bearing on plugin.state at all — it means the
  // write already landed but nothing converged, so State/Detail/Tools on
  // the response are empty by contract (see server.ConsentResult's doc
  // comment). Falling through to plugin.state here would render whatever
  // the LAST list fetch happened to show, misrepresenting "authorized,
  // awaiting convergence" as unrelated old state.
  const pending = override?.result.pending_convergence ?? false
  // Once an override exists this row HAS been acted on, so the whole row comes
  // from that one result -- never a field-by-field mix of new and stale. `??`
  // per field looks equivalent and is not: `detail` is `json:"detail,omitempty"`,
  // so a successful grant (nothing to report) omits it entirely and arrives as
  // undefined, which `??` then backfills from the PREVIOUS list fetch. That
  // rendered a freshly mounted plugin as "running" above the pre-grant line
  // "it has never been authorized here; run agent plugins grant" -- two fields
  // of one row contradicting each other. `state` has no omitempty and so
  // updated correctly, which is exactly what made the mismatch visible.
  const state = pending ? '' : override ? override.result.state : plugin.state
  const detail = pending ? '' : override ? (override.result.detail ?? '') : (plugin.detail ?? '')

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
          {override?.result.convergence_detail && (
            // Non-empty here means convergence RAN and reported errors this
            // entry nonetheless survived (see server.ConsentResult's doc
            // comment) — a different meaning from the entry's own detail
            // below, so it renders as its own distinct warning line rather
            // than being dropped just because this entry converged fine.
            <p className="text-xs text-amber-600 break-all">收敛警告：{override.result.convergence_detail}</p>
          )}
          {effectivePlugin.declared_error ? (
            // declared_error means DeclaredUnresolved is true for the OTHER
            // reason: the declaration failed to load (corrupted plugin.wasm,
            // package dir removed from disk, …), not a not-yet-cached remote
            // package. This is the row-level fix the server change exists
            // for — this used to take the whole /v1/plugins call down as a
            // 500, hiding every OTHER plugin's row along with it (and the
            // deny button below, which stays reachable regardless of this
            // branch). Rendered distinct from `detail` (the loader's state
            // explanation) in destructive color because this is the reason
            // the DECLARATION itself could not be read, a different failure
            // than a load/activation failure.
            <p className="text-xs text-destructive break-all">插件声明解析失败：{effectivePlugin.declared_error}</p>
          ) : (
            effectivePlugin.declared_unresolved && (
              // Distinct from "this plugin requests nothing" on purpose —
              // see PluginConsentDialog's own doc comment for the same rule
              // inside the grant dialog.
              <p className="text-xs text-muted-foreground">该插件的能力声明尚未在本地解析（远程包尚未缓存）。</p>
            )
          )}
          {resolved && (
            // Persistent, not a toast: fetching (Rule 2) leaves the package
            // in the server's cache regardless of whether the operator ever
            // authorizes it, and that fact stays true past this render, so
            // it must not fade out on its own the way a toast would.
            <p className="text-xs text-muted-foreground">已取回并缓存该插件包（未授权，可随时撤销）。</p>
          )}
          {resolving && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1" role="status">
              <SpinnerIcon className="w-3.5 h-3.5" />
              <span>正在取回声明，请稍候……</span>
            </div>
          )}
          {!resolving && resolveError !== '' && untrustedResolve && (
            // Rule 4, untrusted branch: an alert with NO retry button.
            // Retrying can never make an untrusted package trusted — a
            // control that cannot work is the same class of lie a cancel
            // button that cancels nothing would be.
            <p className="text-xs font-semibold text-destructive break-all" role="alert">
              该插件包未通过信任校验，重试无法解决此问题，请联系插件包的提供方：{resolveError}
            </p>
          )}
          {!resolving && resolveError !== '' && !untrustedResolve && (
            // Rule 4, every other failure: plain error + retry, since these
            // ARE plausibly transient (network, no cache configured, …).
            <div className="flex flex-col gap-1">
              <p className="text-xs text-destructive break-all">取回声明失败：{resolveError}</p>
              <div>
                <button
                  type="button"
                  className="interactive text-xs px-2 py-1 rounded border border-input hover:bg-muted text-muted-foreground"
                  onClick={onResolve}
                >
                  重试
                </button>
              </div>
            </div>
          )}
          {!resolving && resolveError === '' && effectivePlugin.declared_unresolved && (
            <div>
              {/* Rule 1: secondary styling — fetching is not the goal,
                  authorizing is. */}
              <button
                type="button"
                className="interactive text-xs px-2 py-1 rounded border border-input hover:bg-muted text-muted-foreground"
                onClick={onResolve}
              >
                取回声明
              </button>
            </div>
          )}
          {state === 'unauthorized' && (
            <>
              <p className="text-xs text-muted-foreground">尚无授权决定。</p>
              <div>
                <button
                  type="button"
                  className="interactive text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  onClick={onGrant}
                  disabled={effectivePlugin.declared_unresolved}
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
                  className="interactive text-xs px-2 py-1 rounded border border-input hover:bg-muted text-muted-foreground disabled:opacity-50"
                  onClick={onGrant}
                  disabled={effectivePlugin.declared_unresolved}
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
                  className="interactive text-xs px-2 py-1 rounded border border-input hover:bg-muted text-muted-foreground disabled:opacity-50"
                  onClick={onGrant}
                  disabled={effectivePlugin.declared_unresolved}
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
