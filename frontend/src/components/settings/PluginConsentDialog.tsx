import { useState } from 'react'
import { main } from '../../../wailsjs/go/models'
import { GrantPlugin, DenyPlugin } from '../../../wailsjs/go/main/App'
import { SpinnerIcon } from '../icons'
import { beginPluginConsent, endPluginConsent } from '../../stores/pluginConsentStore'

// errText renders an unknown error value as a string, matching
// ApprovalPrompt.tsx's own local helper (this codebase duplicates this
// small helper per file rather than sharing it — see ApprovalPrompt.tsx,
// ChatPanel.tsx).
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

type Phase = 'form' | 'submitting' | 'result'

export interface PluginConsentDialogProps {
  plugin: main.PluginDTO
  // 'grant' shows the declared-capabilities checklist and the host/path
  // narrowing checkboxes; 'deny' is a plain revoke confirmation (nothing new
  // is being decided, so there is nothing to check or uncheck).
  mode: 'grant' | 'deny'
  onClose: () => void
  // Called once, as soon as the server responds — including a
  // pending_convergence:true response — so the caller can update its row
  // immediately rather than waiting for the user to dismiss this dialog.
  onResult: (result: main.ConsentResultDTO) => void
}

// PluginConsentDialog is the grant/deny dialog Task 5's brief calls for.
// Three rules this component exists to enforce (see the file header the
// executor task was given, ".superpowers/sdd/gpc-task-5-brief.md"):
//
//  1. Capabilities render as a READ-ONLY LIST, never as checkboxes (disabled
//     or otherwise) — a plugin's capability declaration is not a menu, and a
//     disabled checkbox would misrepresent "you lack permission" for "this
//     is not a settable field here at all".
//  2. Hosts and paths ARE checkboxes, default all-checked and individually
//     removable, because narrowing the manifest's granted set below what the
//     plugin declares is a legitimate choice the server itself supports.
//  3. There is NO cancel affordance — button, backdrop click, or Escape —
//     while a grant/deny request is in flight (`phase === 'submitting'`):
//     the wait is the server converging the deployment manifest, Wails
//     bindings carry no abort semantics, and a button that "cancels"
//     nothing but the frontend's own waiting spinner is exactly the kind of
//     lie this phase exists to prevent.
export function PluginConsentDialog({ plugin, mode, onClose, onResult }: PluginConsentDialogProps) {
  const declaredCaps = plugin.declared_capabilities ?? []
  const declaredHosts = plugin.declared_allowed_hosts ?? []
  const declaredPaths = plugin.declared_allowed_paths ?? []

  const [selectedHosts, setSelectedHosts] = useState<Set<string>>(() => new Set(declaredHosts))
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set(declaredPaths))
  const [phase, setPhase] = useState<Phase>('form')
  const [result, setResult] = useState<main.ConsentResultDTO | null>(null)
  const [error, setError] = useState<string | null>(null)

  function toggleHost(host: string) {
    setSelectedHosts((prev) => {
      const next = new Set(prev)
      if (next.has(host)) next.delete(host)
      else next.add(host)
      return next
    })
  }

  function togglePath(path: string) {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  // Rule 3 (server side): consent.RefuseUnnamedAllowlist rejects a grant that
  // names "http" while the plugin declares allowed_hosts but the request's
  // host list is empty (same for "fs" and allowed_paths) — an allowlist that
  // reaches nothing. Checking this here, before submit, turns a guaranteed
  // 400 into a disabled button with a visible reason instead of a
  // submit-then-fail round trip.
  const hasHttp = declaredCaps.includes('http')
  const hasFs = declaredCaps.includes('fs')
  const hostsBlocked = hasHttp && declaredHosts.length > 0 && selectedHosts.size === 0
  const pathsBlocked = hasFs && declaredPaths.length > 0 && selectedPaths.size === 0
  // declared_unresolved means the server could not tell us what this plugin
  // declares (an uncached remote package) — not that it declares nothing.
  // There is nothing honest to preview here, so grant is blocked rather than
  // silently authorizing an empty checklist.
  const unresolvedBlocked = mode === 'grant' && plugin.declared_unresolved

  let disabledReason = ''
  if (unresolvedBlocked) {
    disabledReason = '该插件的能力声明尚未在本地解析（远程包尚未缓存），此处无法确认它请求的范围，暂时无法授权。'
  } else if (hostsBlocked) {
    disabledReason = '此插件声明了 http 能力和允许主机列表，取消全部主机会让 http 授权覆盖不到任何目标——服务器会拒绝，至少保留一个主机。'
  } else if (pathsBlocked) {
    disabledReason = '此插件声明了 fs 能力和允许路径列表，取消全部路径会让 fs 授权覆盖不到任何目标——服务器会拒绝，至少保留一个路径。'
  }
  const confirmDisabled = mode === 'grant' && (unresolvedBlocked || hostsBlocked || pathsBlocked)

  async function submit() {
    setPhase('submitting')
    setError(null)
    // Registers this request as "in flight" for SettingsModal's Escape guard
    // (see pluginConsentStore.ts) for as long as the await below is pending —
    // regardless of whether this component is still mounted when it settles.
    beginPluginConsent()
    try {
      const res =
        mode === 'grant'
          ? await GrantPlugin(plugin.name, declaredCaps, Array.from(selectedHosts), Array.from(selectedPaths))
          : await DenyPlugin(plugin.name)
      onResult(res)
      setResult(res)
      setPhase('result')
    } catch (err) {
      setError(errText(err))
      setPhase('result')
    } finally {
      endPluginConsent()
    }
  }

  function backToForm() {
    setError(null)
    setResult(null)
    setPhase('form')
  }

  const title = mode === 'grant' ? `授权插件 · ${plugin.name}` : `撤销插件授权 · ${plugin.name}`

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40"
      onClick={() => {
        // Rule 3 extends to the backdrop: a dismiss-by-click during
        // 'submitting' would be the same lie a Cancel button would be.
        if (phase !== 'submitting') onClose()
      }}
    >
      <div
        className="bg-background border border-border rounded-lg shadow-xl w-full max-w-[480px] mx-4 max-h-[85vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold">{title}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
          {phase === 'form' && mode === 'grant' && (
            <div className="flex flex-col gap-4">
              <section>
                <p className="text-xs font-semibold mb-1">声明的能力（只读）</p>
                <p className="text-[11px] text-muted-foreground mb-2">
                  插件的能力声明不是菜单：以下是插件包自身在 plugin.json 中声明的内容，仅供查看，不能在此勾选或修改。
                </p>
                {plugin.declared_unresolved ? (
                  <p className="text-xs text-muted-foreground">该插件的声明尚未在本地解析，暂时无法预览。</p>
                ) : declaredCaps.length === 0 ? (
                  <p className="text-xs text-muted-foreground">此插件未声明任何能力。</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {declaredCaps.map((cap) => (
                      <li key={cap} className="text-xs font-mono px-2 py-1 rounded bg-muted">
                        {cap}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <p className="text-xs font-semibold mb-1">允许的主机（可缩小范围）</p>
                {declaredHosts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">此插件未声明任何主机限制。</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {declaredHosts.map((host) => (
                      <li key={host}>
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={selectedHosts.has(host)}
                            onChange={() => toggleHost(host)}
                          />
                          <span className="font-mono">{host}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <p className="text-xs font-semibold mb-1">允许的路径（可缩小范围）</p>
                {declaredPaths.length === 0 ? (
                  <p className="text-xs text-muted-foreground">此插件未声明任何路径限制。</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {declaredPaths.map((path) => (
                      <li key={path}>
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={selectedPaths.has(path)}
                            onChange={() => togglePath(path)}
                          />
                          <span className="font-mono">{path}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {disabledReason && <p className="text-xs text-destructive">{disabledReason}</p>}
            </div>
          )}

          {phase === 'form' && mode === 'deny' && (
            <div className="flex flex-col gap-2">
              <p className="text-xs">
                撤销后 <span className="font-mono">{plugin.name}</span> 将停止运行，其已授权的能力/主机/路径会被清空。
              </p>
              {(plugin.granted_capabilities ?? []).length > 0 && (
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1">当前已授权的能力（只读）</p>
                  <ul className="flex flex-col gap-1">
                    {(plugin.granted_capabilities ?? []).map((cap) => (
                      <li key={cap} className="text-xs font-mono px-2 py-1 rounded bg-muted">
                        {cap}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {phase === 'submitting' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4" role="status">
              <SpinnerIcon className="w-3.5 h-3.5" />
              <span>正在提交并等待服务端收敛，请稍候……</span>
            </div>
          )}

          {phase === 'result' && error && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-destructive break-all">请求失败：{error}</p>
            </div>
          )}

          {phase === 'result' && result && result.pending_convergence && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold">
                {mode === 'grant' ? '已授权，等待收敛生效' : '已撤销，等待收敛生效'}
              </p>
              {result.convergence_detail && (
                <p className="text-xs text-muted-foreground break-all">{result.convergence_detail}</p>
              )}
            </div>
          )}

          {phase === 'result' && result && !result.pending_convergence && result.state === 'failed' && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-destructive">收敛后加载失败</p>
              {result.detail && <p className="text-xs text-muted-foreground break-all">{result.detail}</p>}
              {result.convergence_detail && (
                <p className="text-xs text-amber-600 break-all">收敛警告：{result.convergence_detail}</p>
              )}
            </div>
          )}

          {phase === 'result' && result && !result.pending_convergence && result.state !== 'failed' && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold">{mode === 'grant' ? '已生效' : '已撤销'}</p>
              {result.convergence_detail && (
                // Non-empty here means convergence ran and reported errors
                // THIS entry nonetheless survived — an unrelated entry
                // failing, say (see server.ConsentResult's doc comment).
                // "Convergence ran, and these errors happened" is a real
                // state distinct from a clean success line, so it must not
                // be dropped just because this entry itself converged.
                <p className="text-xs text-amber-600 break-all">收敛警告：{result.convergence_detail}</p>
              )}
            </div>
          )}
        </div>

        {/* Rule 3: phase === 'submitting' renders no button of any kind. */}
        {phase === 'form' && (
          <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-border">
            <button
              type="button"
              className="interactive text-xs px-3 py-1 rounded hover:bg-muted text-muted-foreground"
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="button"
              className="interactive text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              onClick={submit}
              disabled={confirmDisabled}
            >
              {mode === 'grant' ? '确认并授权' : '确认撤销'}
            </button>
          </div>
        )}

        {phase === 'result' && result && result.pending_convergence && (
          <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-border">
            <button
              type="button"
              className="interactive text-xs px-3 py-1 rounded hover:bg-muted text-muted-foreground"
              onClick={onClose}
            >
              关闭
            </button>
            <button
              type="button"
              className="interactive text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
              onClick={submit}
            >
              重试收敛
            </button>
          </div>
        )}

        {phase === 'result' && (error || (result && !result.pending_convergence)) && (
          <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-border">
            <button
              type="button"
              className="interactive text-xs px-3 py-1 rounded hover:bg-muted text-muted-foreground"
              onClick={onClose}
            >
              关闭
            </button>
            {error && (
              <button
                type="button"
                className="interactive text-xs px-3 py-1 rounded hover:bg-muted text-muted-foreground"
                onClick={backToForm}
              >
                返回修改
              </button>
            )}
            <button
              type="button"
              className="interactive text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
              onClick={submit}
            >
              重试
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
