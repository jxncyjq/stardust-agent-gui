import { useEffect, useState } from 'react'
import { ListGateableTools } from '../../../../wailsjs/go/main/App'

interface GateableTool {
  name: string
  description: string
}

// ToolChecklistField edits a per-agent disabled_tools deny-list as checkboxes.
// It lists every gateable tool (App.ListGateableTools) and checks the ones that
// are NOT disabled; unchecking a tool adds its name to the value, re-checking
// removes it. An empty/undefined value means nothing is disabled — all checked.
export function ToolChecklistField({
  value,
  onChange,
}: {
  value: string[]
  onChange: (v: string[]) => void
}) {
  const [tools, setTools] = useState<GateableTool[] | null>(null)
  const [error, setError] = useState('')
  const disabled = Array.isArray(value) ? value : []

  useEffect(() => {
    let cancelled = false
    ListGateableTools()
      .then((list) => {
        if (!cancelled) setTools(list as GateableTool[])
      })
      .catch((err) => {
        // Fail-loud: never render an empty checklist as if there were no tools;
        // that would silently hide the whole feature on a binding failure.
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return <p className="text-xs text-error">加载工具列表失败：{error}</p>
  }
  if (!tools) {
    return <p className="text-xs text-muted-foreground">加载中…</p>
  }

  const toggle = (name: string, checked: boolean) => {
    if (checked) {
      onChange(disabled.filter((n) => n !== name))
    } else {
      onChange([...disabled, name])
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {tools.map((tool) => {
        const checked = !disabled.includes(tool.name)
        return (
          <label key={tool.name} className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => toggle(tool.name, e.target.checked)}
              aria-label={tool.name}
            />
            <span>
              <span className="font-mono">{tool.name}</span>
              <span className="text-muted-foreground"> — {tool.description}</span>
            </span>
          </label>
        )
      })}
    </div>
  )
}
