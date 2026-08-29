import { useEffect, useState } from 'react'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { ListPlugins, GrantPlugin, DenyPlugin, ResolvePlugin } from '../../../wailsjs/go/main/App'
import { main } from '../../../wailsjs/go/models'
import { PluginConsentDialog } from './PluginConsentDialog'
import { SpinnerIcon } from '../icons'
import { beginPluginConsent, endPluginConsent } from '../../stores/pluginConsentStore'

// errText renders an unknown error value as a string, matching the small
// local helper ApprovalPrompt.tsx/PluginConsentDialog.tsx each keep for the
// same purpose rather than sharing one across files.
//
// In production a rejected Wails binding call hands `catch` a bare STRING,
// not an Error instance: internal/frontend/dispatcher/calls.go sets
// callbackMessage.Err = err.Error() (a Go string), and the desktop runtime's
// calls.js rejects the promise with that raw string directly
// (`callbackData.reject(message.error)`) — it never wraps it in `new
// Error(...)`. `err instanceof Error` is therefore the UNCOMMON branch here,
// not the common one; String(err) on a string is the identity, which is why
// this still resolves correctly. Do not "simplify" this on the assumption
// that Wails errors normally arrive as Error instances — they don't.
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// UNTRUSTED_MARKER must stay byte-for-byte in sync with errPluginUntrusted's
// message in legionAgentGUI's app_plugins.go (`插件包不被信任`). Go-side,
// ResolvePlugin identifies a 422 STRUCTURALLY — errors.As against
// httpStatusError's numeric HTTP status, not by parsing response text (see
// that function's doc comment). Wails' options.App does support a
// structured channel (`ErrorFormatter ErrorFormatter`, wired into the
// dispatcher at internal/frontend/dispatcher/calls.go), but it is an
// app-wide hook — adopting it here would change the error shape of every
// existing binding (GrantPlugin, DenyPlugin, ListPlugins, ...), which is out
// of scope for this one button. This repo configures no ErrorFormatter, so
// today a Wails-bound method's error crosses to JS as nothing more than the
// wrapped error's Error() string (a bare string, see errText's comment
// above) — no status code, no error type, no structured payload survives
// the boundary. So matching this substring really is the only thing the JS
// side has to key on given the current configuration — not a shortcut
// around a better mechanism, but the actual contract this file depends on.
// It is fragile in exactly the way that implies: renaming errPluginUntrusted's
// message on the Go side silently breaks this check with no compile error
// on either side.
const UNTRUSTED_MARKER = '插件包不被信任'

function isUntrustedResolveError(message: string): boolean {
  return message.includes(UNTRUSTED_MARKER)
}

// UNRESOLVED_NOT_CACHED / UNRESOLVED_NO_CACHE mirror two of legionAgent's
// internal/server/plugins.go DeclaredUnresolved* constants, carried over the
// wire as PluginDTO.declared_unresolved_reason.
//
// They exist because declared_unresolved alone is true in three different
// server-side situations and a fetch is the remedy for exactly ONE of them:
//
//   not_cached          — a remote package simply not downloaded yet.
//                         取回声明 works. This is the only fetchable case.
//   no_cache_configured — the deployment configured no "plugins.cache", so
//                         resolvePluginPackageDir refuses before it fetches.
//                         The remedy is a config edit plus a serve restart;
//                         nothing in this panel can produce it.
//   load_failed         — the package resolved but would not load (corrupt
//                         plugin.wasm, missing plugin.json, deleted local
//                         source). A local entry makes no network call at
//                         all and a remote one is a cache HIT that short-
//                         circuits before fetching, so a fetch re-reads the
//                         same broken bytes forever. Rendered by the
//                         declared_error branch below, which always
//                         accompanies this reason.
//
// Unlike UNTRUSTED_MARKER above, a drift here fails CLOSED: an unrecognised
// (or absent, from a server predating the field) reason takes the default
// branch — a plain note and NO fetch button. A missing remedy is recoverable
// from the CLI; a button that cannot work is the lie this panel exists to
// avoid.
const UNRESOLVED_NOT_CACHED = 'not_cached'
const UNRESOLVED_NO_CACHE = 'no_cache_configured'

// unresolvedNote is the row's explanation for declared_unresolved, per
// reason. The generic default deliberately does NOT claim a cache state: the
// old single sentence said "远程包尚未缓存" for every case, which is simply
// false when the deployment has no cache to miss.
function unresolvedNote(reason: string): string {
  switch (reason) {
    case UNRESOLVED_NOT_CACHED:
      return '该插件的能力声明尚未在本地解析（远程包尚未缓存）。'
    case UNRESOLVED_NO_CACHE:
      return '该插件的能力声明无法在本地解析：此部署未配置插件缓存目录（plugins.cache），远程包没有可写入的位置。请修改部署配置后重启 agent serve —— 此面板无法取回。'
    default:
      return '该插件的能力声明尚未在本地解析。'
  }
}

// ErrorDetail renders a failure as a HUMAN SENTENCE with the raw error chain
// folded behind a disclosure.
//
// The chain is not decoration and is never dropped: a Go error crossing the
// Wails boundary arrives as ONE FLAT STRING carrying every wrapper it picked
// up — HTTP status line, JSON response body, the escaped absolute cache path
// — and an operator diagnosing a supply-chain problem needs all of it. What
// the 2026-08-28 real-machine walkthrough showed is that putting it INSIDE
// the sentence buries the finding it is supposed to deliver: 633 characters
// in a single <p>, with 「该插件包未通过信任校验」 somewhere in the middle.
// So the sentence stands alone and the chain moves one click away.
//
// The disclosure is a native <details>, which keeps the chain in the DOM
// (searchable, selectable, copyable) rather than behind React state that
// would have to be cleared alongside the error it belongs to.
function ErrorDetail({
  summary,
  detail,
  summaryClass,
  role,
}: {
  summary: string
  detail: string
  summaryClass: string
  // role is set only where the failure is an ALERT — a trust failure the
  // operator must not miss. It goes on the sentence, not on the wrapper, so
  // an assistive reader announces the finding and not the error chain.
  role?: 'alert'
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className={summaryClass} role={role}>
        {summary}
      </p>
      <details className="text-[10px] text-muted-foreground">
        <summary className="interactive cursor-pointer select-none">显示详细错误</summary>
        <pre className="whitespace-pre-wrap break-all mt-0.5">{detail}</pre>
      </details>
    </div>
  )
}

// pluginEventReloadDelayMs is the trailing debounce on event-driven reloads.
//
// Long enough that one convergence's burst of events collapses into a single
// refetch, short enough that an operator watching the panel sees the result as
// "immediately". It is not a poll interval: with no events, nothing runs.
const pluginEventReloadDelayMs = 300

// ConsentOverride is what a completed Grant/Deny call leaves behind for one
// plugin row, so the row can render the fresh outcome immediately instead of
// waiting on a manual refresh (ListPlugins carries no push/SSE channel).
// mode records which call produced it, so a "重试收敛" retry resubmits the
// SAME kind of request.
//
// (The panel now also reloads on plugin lifecycle events — see the effect in
// PluginsPage — but an override is still what shows a decision the operator
// just made BEFORE the convergence event arrives.)
interface ConsentOverride {
  result: main.ConsentResultDTO
  mode: 'grant' | 'deny'
}

// denyDialogView is the plugin as the DENY dialog must see it.
//
// Each dialog mode reads a different field group, and the freshest source for
// each group is a different object — so there is no one "latest plugin" to
// hand both. Deny renders "当前已授权的能力（只读）" from granted_*, and the
// freshest granted_* is:
//
//   1. the override, if this row was granted/denied this session — the server
//      wrote those fields and reported them back, and nothing has re-listed
//      since (onResult stores the result; it does not reload);
//   2. otherwise the row from the last ListPlugins.
//
// Never `resolved`: PluginConsentService.Resolve fills granted_* from
// entry.Grant AS OF THE FETCH, and `resolved` is deliberately never cleared,
// so it is the one source guaranteed to go stale. Deny has no use for the
// declared_* fields the resolved view IS fresher for (its own
// unresolvedBlocked is `mode === 'grant' && …`).
function denyDialogView(plugin: main.PluginDTO, override?: ConsentOverride): main.PluginDTO {
  if (!override) return plugin
  return main.PluginDTO.createFrom({
    ...plugin,
    granted_capabilities: override.result.granted_capabilities,
    granted_allowed_hosts: override.result.granted_allowed_hosts,
    granted_allowed_paths: override.result.granted_allowed_paths,
  })
}

// reconcileResolved drops every fetched-declaration view the server no longer
// corroborates, and keeps the rest.
//
// `resolved` is a claim about the SERVER'S DISK ("已取回并缓存该插件包"), not
// a fact about this session, and the server is the one that knows. A fresh
// List that reports the row unresolved again — the cache entry deleted by an
// operator, a disk cleanup, a digest edit in plugins.json that points at a
// package nobody has fetched — makes the claim false. Keeping it there was
// the 2026-08-28 walkthrough's worst finding: the panel went on asserting the
// package was cached AND, because the stale view shadowed the fresh row, it
// withheld 取回声明 — the one control that could have fixed it. Only an app
// restart cleared it.
//
// The reverse over-correction is just as wrong, which is why this is a filter
// and not a wipe: dropping a fetch the server still agrees with would make
// the operator pay the download cost again on every 刷新, the very thing
// `resolved` survives a refresh to prevent. A row absent from the fresh list
// is dropped too — there is nothing left to make a claim about.
function reconcileResolved(
  resolved: Record<string, main.PluginDTO>,
  fresh: main.PluginDTO[],
): Record<string, main.PluginDTO> {
  const next: Record<string, main.PluginDTO> = {}
  for (const plugin of fresh) {
    const view = resolved[plugin.name]
    if (!view) continue
    if (plugin.declared_unresolved) continue
    if ((plugin.declared_error ?? '') !== '') continue
    next[plugin.name] = view
  }
  return next
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
  // resolved holds the successful ResolvePlugin() view per plugin name. load()
  // does not WIPE it — fetching does not write plugins.json (Rule 2 in the
  // brief this implements), so a manual refresh must not make the operator
  // lose a fetch they already paid the download cost for — but it does
  // RECONCILE it against the fresh list: see reconcileResolved for why a
  // survival rule with no reconciliation turned into a false claim the panel
  // could not be talked out of.
  const [resolved, setResolved] = useState<Record<string, main.PluginDTO>>({})

  // load fetches the authoritative list from the server and drops every piece
  // of client-side state the fresh result supersedes: a List() result is the
  // truth this page defers to, and holding stale client state past a manual
  // refresh is exactly the kind of quiet drift fail-loud exists to avoid.
  //
  // That means all four, not just the override it originally cleared:
  //
  //   overrides     — a completed grant/deny the list has now absorbed.
  //   retryError    — keyed by plugin name and gated on an override that
  //                   load() clears, so a stale one goes INVISIBLE here and
  //                   resurfaces on the next pending convergence, pinning an
  //                   old failure on a request that has not failed.
  //   resolveError  — a 422 caches the untrusted package, so the very next
  //                   List reports that same failure server-side; keeping the
  //                   client-side copy renders one signature failure twice.
  //   resolved      — reconciled, not cleared (see reconcileResolved).
  async function load() {
    try {
      const result = await ListPlugins()
      const fresh = result ?? []
      setPlugins(fresh)
      setLoadError('')
      setOverrides({})
      setRetryError({})
      setResolveError({})
      setResolved((prev) => reconcileResolved(prev, fresh))
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

  // A plugin lifecycle event means SOMETHING CHANGED — it is not the change
  // itself. The event's message is a line written for a human
  // ("plugin=foo reason=health category=trap revoked=2"); patching row state
  // out of it would tie this panel to a string format nobody promised to keep,
  // and this file has already paid for that kind of coupling once (see
  // UNTRUSTED_MARKER). So the event triggers one question to the authoritative
  // source instead, through the SAME load() the 刷新 button uses — which is
  // also what keeps the `resolved` reconciliation identical on both paths.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancel = EventsOn('agent:plugin', () => {
      // Trailing debounce, and it is not an optimisation: one convergence
      // emits several events (unload the old, load the new, resume a
      // dependent), so refetching per event both multiplies the requests and
      // paints the half-converged states on the way through.
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => {
        timer = undefined
        load()
      }, pluginEventReloadDelayMs)
    })
    return () => {
      // Both halves matter: the settings modal is opened and closed
      // repeatedly, so a missed cancel() leaves one more listener behind every
      // time, and a missed clearTimeout fires load() into an unmounted tree.
      cancel()
      if (timer !== undefined) {
        clearTimeout(timer)
      }
    }
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
            // GRANT gets the fetched declaration (resolved[plugin.name]): it
            // supersedes the stale one ListPlugins returned, or the dialog
            // opens on the ORIGINAL declared_unresolved:true/empty-
            // capabilities view and stays stuck disabling its own confirm
            // button — silently defeating the whole point of fetching first.
            onGrant={() => setDialog({ plugin: resolved[plugin.name] ?? plugin, mode: 'grant' })}
            // DENY must NOT get the resolved view: it reads granted_*, and
            // that is the one group the resolved DTO is STALER for. Handing
            // it over pins the dialog to the pre-fetch grant state for the
            // rest of the session — fetch, grant http, then 撤销授权, and the
            // dialog shows an EMPTY 当前已授权的能力 list, asking the operator
            // to confirm a revocation without showing what is being revoked,
            // which is that dialog's entire job. See denyDialogView for where
            // the freshest granted_* actually lives.
            onDeny={() => setDialog({ plugin: denyDialogView(plugin, overrides[plugin.name]), mode: 'deny' })}
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
  // fetchable is the gate for BOTH 取回声明 and its 重试. declared_unresolved
  // alone is not that gate: it is also true where no fetch can ever succeed
  // (no plugins.cache configured; a package that fails to load), and a
  // control offered there is the same class of lie as the retry this file
  // already refuses to render for an untrusted package. See
  // UNRESOLVED_NOT_CACHED's comment for the three cases.
  const fetchable =
    effectivePlugin.declared_unresolved && effectivePlugin.declared_unresolved_reason === UNRESOLVED_NOT_CACHED
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
          {retryError && (
            // Same treatment as the fetch failures below: a convergence error
            // is another flat Go chain, and the sentence must not be buried
            // in it.
            <ErrorDetail summary="重试失败。" detail={retryError} summaryClass="text-xs text-destructive" />
          )}
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
            // than a load/activation failure. This branch is exactly the
            // load_failed reason (the server always sets declared_error with
            // it), and `fetchable` is false throughout it: re-fetching reads
            // the same broken bytes forever.
            <ErrorDetail
              summary="插件声明解析失败。"
              detail={effectivePlugin.declared_error}
              summaryClass="text-xs text-destructive"
            />
          ) : (
            effectivePlugin.declared_unresolved && (
              // Distinct from "this plugin requests nothing" on purpose —
              // see PluginConsentDialog's own doc comment for the same rule
              // inside the grant dialog. The wording depends on WHY it is
              // unresolved: see unresolvedNote.
              <p className="text-xs text-muted-foreground">
                {unresolvedNote(effectivePlugin.declared_unresolved_reason ?? '')}
              </p>
            )
          )}
          {resolved && (
            // Persistent, not a toast: fetching (Rule 2) leaves the package
            // in the server's cache regardless of whether the operator ever
            // authorizes it, and that fact stays true past this render, so
            // it must not fade out on its own the way a toast would.
            //
            // Only the CACHE half stays true forever, though. The
            // "（未授权，可随时撤销）" clarification is about the fetch not
            // having authorized anything, and it stops being true the instant
            // the operator grants — leaving a 运行中 badge stacked directly
            // above a line asserting 未授权, the same two-fields-of-one-row
            // contradiction the `detail ??` backfill post-mortem below
            // records. `resolved` is never cleared and load() clears only
            // `overrides`, so it would survive a 刷新 too. Gating it on the
            // row still being undecided keeps the persistent cache fact and
            // drops the claim that went stale.
            <p className="text-xs text-muted-foreground">
              {state === 'unauthorized' ? '已取回并缓存该插件包（未授权，可随时撤销）。' : '已取回并缓存该插件包。'}
            </p>
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
            <ErrorDetail
              summary="该插件包未通过信任校验，重试无法解决此问题，请联系插件包的提供方。"
              detail={resolveError}
              summaryClass="text-xs font-semibold text-destructive"
              role="alert"
            />
          )}
          {!resolving && resolveError !== '' && !untrustedResolve && (
            // Rule 4, every other failure: the error always renders, but the
            // 重试 button only where a fetch could work at all (`fetchable`).
            // A transient fetch failure — a refused connection, a timeout, a
            // 5xx from the origin — really is worth retrying. A row that is
            // not fetchable in the first place is not: retrying a deployment
            // with no plugins.cache, or a package that will not load, fails
            // identically forever. (The old comment here claimed "no cache
            // configured" was "plausibly transient"; a deployment
            // configuration fact is the least transient thing there is.)
            <div className="flex flex-col gap-1">
              <ErrorDetail summary="取回声明失败。" detail={resolveError} summaryClass="text-xs text-destructive" />
              {fetchable && (
                <div>
                  <button
                    type="button"
                    className="interactive text-xs px-2 py-1 rounded border border-input hover:bg-muted text-muted-foreground"
                    onClick={onResolve}
                  >
                    重试
                  </button>
                </div>
              )}
            </div>
          )}
          {!resolving && resolveError === '' && fetchable && (
            <div>
              {/* Rule 1: secondary styling — fetching is not the goal,
                  authorizing is. Gated on `fetchable`, not on
                  declared_unresolved: see that constant's comment. */}
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
