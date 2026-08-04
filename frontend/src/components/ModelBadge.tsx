import { useEffect, useState } from 'react'
import { GetAgentModelInfo } from '../../wailsjs/go/main/App'
import { useAgentStore } from '../stores/agentStore'

// formatContext renders a token count compactly: 128000 -> "128K",
// 1000000 -> "1M", small values as-is, and 0/negative (unconfigured) as the
// explicit "context 未设" so an unset context reads as unset, not a wrong number.
export function formatContext(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return 'context 未设'
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`
  }
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}

interface ModelInfoState {
  model: string
  contextLength: number
}

// ModelBadge shows the model + context window the currently selected agent
// uses. It re-fetches whenever the selected agent changes. Per the repo's
// fail-loud rule, a resolution error (e.g. an agent's maas_profile points at
// a missing profile) is surfaced as "配置错误" with the reason in the
// tooltip rather than hidden behind a default value.
export function ModelBadge() {
  const agent = useAgentStore((s) => s.selected)
  const [info, setInfo] = useState<ModelInfoState | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    setErr('')
    setInfo(null)
    GetAgentModelInfo(agent)
      .then((r) => {
        if (cancelled) return
        setInfo({ model: String(r?.model ?? ''), contextLength: Number(r?.context_length ?? 0) })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setInfo(null)
        setErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [agent])

  const base =
    'flex items-center gap-1 rounded-md border border-input bg-muted/50 px-2 py-1 text-xs text-muted-foreground'

  if (err) {
    return (
      <span className={base} title={`模型信息读取失败: ${err}`}>
        配置错误
      </span>
    )
  }
  if (!info) return <span className={base}>…</span>
  return (
    <span className={base} title={`模型 ${info.model} · 上下文 ${info.contextLength} tokens`}>
      {info.model} · {formatContext(info.contextLength)}
    </span>
  )
}
