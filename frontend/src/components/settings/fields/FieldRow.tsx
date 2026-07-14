import type { ReactNode } from 'react'

// FieldRow lays out a label beside its control in the settings form.
export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <label className="text-xs text-muted-foreground w-48 shrink-0 truncate">{label}</label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

export function ToggleControl({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
  )
}

export function NumberControl({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      className="text-xs px-2 py-1 rounded border border-input bg-background w-full"
      value={Number.isFinite(value) ? value : ''}
      onChange={(e) => {
        const n = Number(e.target.value)
        if (!Number.isNaN(n)) onChange(n)
      }}
    />
  )
}

export function TextControl({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      className="text-xs px-2 py-1 rounded border border-input bg-background w-full"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function ReadonlyControl({ value }: { value: any }) {
  const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')
  return (
    <span
      className="text-xs px-2 py-1 rounded border border-input bg-muted text-muted-foreground w-full inline-block truncate"
      title={text}
    >
      {text || '—'}
    </span>
  )
}
