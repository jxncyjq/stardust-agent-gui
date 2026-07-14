// getPath reads a dot-separated path from a nested object, returning undefined
// when any segment is missing.
export function getPath(obj: any, path: string): any {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj)
}

// setPath returns a shallow-cloned copy of obj with value written at the
// dot-separated path, creating missing intermediate objects. The input is never
// mutated, so React state comparisons see a new reference along the changed path.
export function setPath<T>(obj: T, path: string, value: any): T {
  const keys = path.split('.')
  const clone: any = Array.isArray(obj) ? [...(obj as any)] : { ...(obj as any) }
  let cursor = clone
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    const child = cursor[key]
    cursor[key] = child != null && typeof child === 'object' ? (Array.isArray(child) ? [...child] : { ...child }) : {}
    cursor = cursor[key]
  }
  cursor[keys[keys.length - 1]] = value
  return clone
}
