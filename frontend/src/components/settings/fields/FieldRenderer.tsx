import type { FieldSpec } from '../../../types/config'
import { useConfigStore } from '../../../stores/configStore'
import { getPath } from '../../../lib/objectPath'
import { FieldRow, ToggleControl, NumberControl, TextControl, ReadonlyControl } from './FieldRow'
import { SecretField } from './SecretField'
import { StringListField } from './StringListField'
import { ProfilesEditor } from './ProfilesEditor'
import { AgentsEditor } from './AgentsEditor'
import { ToolChecklistField } from './ToolChecklistField'

// WidgetControl renders the control for a field's widget against a plain
// value/onChange pair. It is deliberately store-agnostic so the same widget set
// serves both the main config form and the sub-agent form.
function WidgetControl({
  field,
  value,
  onChange,
}: {
  field: FieldSpec
  value: any
  onChange: (v: any) => void
}) {
  switch (field.widget) {
    case 'toggle':
      return <ToggleControl value={value} onChange={onChange} />
    case 'number':
      return <NumberControl value={value} onChange={onChange} />
    case 'text':
    case 'color':
      return (
        <div className="flex items-center gap-2">
          <TextControl value={value} onChange={onChange} />
          {field.widget === 'color' && (
            <span
              className="w-4 h-4 rounded border border-border shrink-0"
              style={{ background: value || 'transparent' }}
            />
          )}
        </div>
      )
    case 'secret':
      return <SecretField value={value} onChange={onChange} />
    case 'stringlist':
      return <StringListField value={value} onChange={onChange} />
    case 'profiles':
      return <ProfilesEditor value={value} onChange={onChange} />
    case 'agents':
      return <AgentsEditor value={value} onChange={onChange} />
    case 'tool-checklist':
      return <ToolChecklistField value={value} onChange={onChange} />
    case 'readonly':
      return <ReadonlyControl value={value} />
    default:
      // Fail loud: an unhandled widget is a programming error, not something to
      // silently skip.
      throw new Error(`WidgetControl: unhandled widget "${field.widget}" for ${field.path}`)
  }
}

// FieldRenderer reads the field's current value from the main config draft and
// renders its control, writing edits back through the store.
export function FieldRenderer({ field }: { field: FieldSpec }) {
  const draft = useConfigStore((s) => s.draft)
  const update = useConfigStore((s) => s.update)
  return (
    <FieldRow label={field.label}>
      <WidgetControl field={field} value={getPath(draft, field.path)} onChange={(v) => update(field.path, v)} />
    </FieldRow>
  )
}

// AgentFieldRenderer is the same control, bound to one sub-agent's draft instead
// of the main config. relPath identifies which sub-agent file is being edited.
export function AgentFieldRenderer({ relPath, field }: { relPath: string; field: FieldSpec }) {
  const draft = useConfigStore((s) => s.agentDrafts[relPath])
  const updateAgent = useConfigStore((s) => s.updateAgent)
  return (
    <FieldRow label={field.label}>
      <WidgetControl
        field={field}
        value={getPath(draft, field.path)}
        onChange={(v) => updateAgent(relPath, field.path, v)}
      />
    </FieldRow>
  )
}
