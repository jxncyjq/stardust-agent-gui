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
          <button type="button" className="text-xs px-2 rounded hover:bg-muted text-muted-foreground" onClick={() => remove(i)}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="text-xs px-2 py-1 rounded border border-input hover:bg-muted text-left" onClick={add}>
        + 添加
      </button>
    </div>
  )
}
