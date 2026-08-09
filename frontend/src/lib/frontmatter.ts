// Prop is one displayed frontmatter row. Value is always a display string —
// arrays are joined, quotes stripped; nested/block values are kept raw.
export interface Prop { key: string; value: string }
export interface Parsed { props: Prop[]; body: string }

const unquote = (s: string): string => {
  const t = s.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

// parseFrontmatter extracts a leading `---`…`---` YAML block and parses only the
// top-level `key: value` lines (bare / quoted / inline `[...]`). Block or nested
// structures are not YAML-parsed; a top-level key whose value is empty (block
// follows) is skipped rather than guessed. Not a general YAML parser — the docs
// use a flat, predictable shape. No frontmatter → empty props, whole input body.
export function parseFrontmatter(src: string): Parsed {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src)
  if (!m) return { props: [], body: src }
  const [, head, body] = m
  const props: Prop[] = []
  for (const raw of head.split(/\r?\n/)) {
    if (/^\s/.test(raw) || raw.trim() === '') continue // skip indented block/nested lines
    const idx = raw.indexOf(':')
    if (idx < 0) continue
    const key = raw.slice(0, idx).trim()
    let val = raw.slice(idx + 1).trim()
    if (val === '') continue // block/nested follows — not a scalar
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map((x) => unquote(x)).filter((x) => x !== '').join(', ')
    } else {
      val = unquote(val)
    }
    props.push({ key, value: val })
  }
  return { props, body: body ?? '' }
}
