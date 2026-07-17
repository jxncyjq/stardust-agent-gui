import { XIcon, PlusIcon } from '../../icons'

// StringListField edits a string[] as one comma-free item per row.
export function StringListField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const list = Array.isArray(value) ? value : []
  const setAt = (i: number, v: string) => onChange(list.map((x, j) => (j === i ? v : x)))
  const remove = (i: number) => onChange(list.filter((_, j) => j !== i))
  const add = () => onChange([...list, ''])
  return (
    <div className="flex flex-col gap-1">
      {list.map((item, i) => (
        <div key={i} className="flex gap-1">
          <input
            className="text-xs px-2 py-1 rounded border border-input bg-background w-full"
            value={item}
            onChange={(e) => setAt(i, e.target.value)}
          />
          <button
            type="button"
            className="interactive flex items-center justify-center px-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            onClick={() => remove(i)}
            aria-label={`移除第 ${i + 1} 项`}
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="interactive flex items-center gap-1 text-xs px-2 py-1 rounded border border-input hover:bg-muted text-left"
        onClick={add}
      >
        <PlusIcon className="w-3.5 h-3.5" />
        <span>添加</span>
      </button>
    </div>
  )
}
