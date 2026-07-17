import { useState } from 'react'
import { EyeIcon, EyeOffIcon } from '../../icons'

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
        className="interactive flex items-center justify-center px-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? '隐藏密钥' : '显示密钥'}
        aria-pressed={shown}
        title={shown ? '隐藏' : '显示'}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  )
}
