import { useState } from 'react'

// SecretField masks a secret value with a reveal toggle. It never truncates the
// stored value — only the on-screen rendering is masked.
export function SecretField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="flex gap-1">
      <input
        type={shown ? 'text' : 'password'}
        className="text-xs px-2 py-1 rounded border border-input bg-background w-full"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="text-xs px-2 rounded hover:bg-muted text-muted-foreground"
        onClick={() => setShown((v) => !v)}
        title={shown ? '隐藏' : '显示'}
      >
        {shown ? '🙈' : '👁'}
      </button>
    </div>
  )
}
