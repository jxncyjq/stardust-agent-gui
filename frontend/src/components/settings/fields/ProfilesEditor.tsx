interface Profile {
  model?: string
  base_url?: string
  api_key?: string
  prompt_cache?: boolean
}

// ProfilesEditor edits the maas.profiles map: add/remove named profiles and edit
// each profile's model/base_url/api_key.
export function ProfilesEditor({
  value,
  onChange,
}: {
  value: Record<string, Profile>
  onChange: (v: Record<string, Profile>) => void
}) {
  const profiles = value && typeof value === 'object' ? value : {}
  const names = Object.keys(profiles)

  const setField = (name: string, key: keyof Profile, v: string) =>
    onChange({ ...profiles, [name]: { ...profiles[name], [key]: v } })
  const remove = (name: string) => {
    const next = { ...profiles }
    delete next[name]
    onChange(next)
  }
  const add = () => {
    let n = 'new-profile'
    let i = 1
    while (profiles[n]) n = `new-profile-${i++}`
    onChange({ ...profiles, [n]: { model: '', base_url: '', api_key: '' } })
  }

  return (
    <div className="flex flex-col gap-2">
      {names.map((name) => (
        <div key={name} className="border border-border rounded p-2 flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">{name}</span>
            <button type="button" className="text-xs px-2 rounded hover:bg-muted text-muted-foreground" onClick={() => remove(name)}>
              删除
            </button>
          </div>
          {(['model', 'base_url', 'api_key'] as const).map((k) => (
            <div key={k} className="flex items-center gap-2">
              <label className="text-[10px] uppercase text-muted-foreground w-16 shrink-0">{k}</label>
              <input
                type={k === 'api_key' ? 'password' : 'text'}
                className="text-xs px-2 py-1 rounded border border-input bg-background w-full"
                value={profiles[name]?.[k] ?? ''}
                onChange={(e) => setField(name, k, e.target.value)}
              />
            </div>
          ))}
        </div>
      ))}
      <button type="button" className="text-xs px-2 py-1 rounded border border-input hover:bg-muted text-left" onClick={add}>
        + 添加 profile
      </button>
    </div>
  )
}
