import type { FieldSpec } from '../../../types/config'
import { useConfigStore } from '../../../stores/configStore'
import { getPath } from '../../../lib/objectPath'
import { FieldRow, ToggleControl, NumberControl, TextControl, ReadonlyControl } from './FieldRow'
import { SecretField } from './SecretField'
import { StringListField } from './StringListField'
import { ProfilesEditor } from './ProfilesEditor'

// FieldRenderer reads the field's current value from the config draft and
// renders the control for its widget, writing edits back through the store.
export function FieldRenderer({ field }: { field: FieldSpec }) {
  const draft = useConfigStore((s) => s.draft)
  const update = useConfigStore((s) => s.update)
  const value = getPath(draft, field.path)
  const set = (v: any) => update(field.path, v)

  switch (field.widget) {
    case 'toggle':
      return <FieldRow label={field.label}><ToggleControl value={value} onChange={set} /></FieldRow>
    case 'number':
      return <FieldRow label={field.label}><NumberControl value={value} onChange={set} /></FieldRow>
    case 'text':
    case 'color':
      return (
        <FieldRow label={field.label}>
          <div className="flex items-center gap-2">
            <TextControl value={value} onChange={set} />
            {field.widget === 'color' && (
              <span className="w-4 h-4 rounded border border-border shrink-0" style={{ background: value || 'transparent' }} />
            )}
          </div>
        </FieldRow>
      )
    case 'secret':
      return <FieldRow label={field.label}><SecretField value={value} onChange={set} /></FieldRow>
    case 'stringlist':
      return <FieldRow label={field.label}><StringListField value={value} onChange={set} /></FieldRow>
    case 'profiles':
      return <FieldRow label={field.label}><ProfilesEditor value={value} onChange={set} /></FieldRow>
    case 'readonly':
      return <FieldRow label={field.label}><ReadonlyControl value={value} /></FieldRow>
    default:
      // Fail loud: an unhandled widget is a programming error, not something to
      // silently skip.
      throw new Error(`FieldRenderer: unhandled widget "${field.widget}" for ${field.path}`)
  }
}
