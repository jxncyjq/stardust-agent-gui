import { useEffect } from 'react'
import { useConfigStore } from '../../stores/configStore'
import { AGENT_SECTIONS } from '../../types/agentConfig'
import { AgentFieldRenderer } from './fields/FieldRenderer'
import { ChevronLeftIcon } from '../icons'
import type { EditingAgent } from '../../stores/uiStore'

// AgentConfigPage is the drill-in form for one sub-agent's config file. Edits go
// into the shared config store as a draft; they are written to disk by the
// dialog's single "保存并重启", together with the main config, so the whole
// configuration is committed and the service restarted exactly once.
export function AgentConfigPage({ agent, onBack }: { agent: EditingAgent; onBack: () => void }) {
  const loadAgent = useConfigStore((s) => s.loadAgent)
  const draft = useConfigStore((s) => s.agentDrafts[agent.path])
  const baseline = useConfigStore((s) => s.agentBaselines[agent.path])

  useEffect(() => {
    loadAgent(agent.path, agent.name)
  }, [agent.path, agent.name, loadAgent])

  // A baseline of '' means the file is not on disk yet: this agent was just
  // added and the form is showing the template that save will create.
  const isNew = baseline === ''

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 py-2 border-b border-border">
        <button
          className="interactive flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
          onClick={onBack}
          aria-label="返回设置主页面"
        >
          <ChevronLeftIcon className="w-3.5 h-3.5" />
          <span>返回</span>
        </button>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold truncate">子 Agent · {agent.name}</span>
          <span className="text-[10px] text-muted-foreground truncate" title={agent.path}>
            {agent.path}
            {isNew && ' · 新文件，保存时创建'}
          </span>
        </div>
      </div>

      {!draft ? (
        <p className="text-xs text-muted-foreground py-4">加载中…</p>
      ) : (
        AGENT_SECTIONS.map((section) => (
          <div key={section.key} className="border-b border-border py-2">
            <p className="text-sm font-semibold">{section.title}</p>
            <div className="pl-4 pt-1">
              <p className="text-[11px] text-muted-foreground mb-1">{section.help}</p>
              {section.fields.map((f) => (
                <AgentFieldRenderer key={f.path} relPath={agent.path} field={f} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
