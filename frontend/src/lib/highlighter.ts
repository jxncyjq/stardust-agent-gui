import { createHighlighter } from 'shiki'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import rehypeShikiFromHighlighter, { type RehypeShikiCoreOptions } from '@shikijs/rehype/core'

// Top-level await: shiki v4's createHighlighter is async (grammar loading), but
// the resulting highlighter's codeToHast is SYNC — which react-markdown v10's
// synchronous render requires. Building at module load means it is ready before
// the first message renders. The JS regex engine avoids shipping/serving the
// oniguruma .wasm asset (simpler under Wails/WebView2). Languages are passed as
// string names (bundled shiki self-resolves them); unknown languages in a code
// fence fall back to plain text rather than crashing.
const highlighter = await createHighlighter({
  themes: ['github-light', 'github-dark'],
  langs: ['typescript', 'javascript', 'tsx', 'go', 'json', 'bash', 'python', 'markdown'],
  engine: createJavaScriptRegexEngine(),
})

// rehypeShikiPlugin is the react-markdown rehypePlugins ENTRY. Note the shape:
// rehypeShikiFromHighlighter takes the highlighter as its FIRST argument, so the
// entry is [plugin, highlighter, options] — react-markdown calls
// plugin(highlighter, options). Dual themes emit CSS variables toggled by the
// app's `.dark` class (see style.css), so highlighting follows light/dark
// automatically. HTML stays escaped — rehype-raw is NOT used (an agent could
// inject <script>; keeping HTML escaped is the safe default).
// NOTE: brief's draft set `defaultColor: false`, but verified against the
// installed shiki@4.2.0 (see codeToHtml output), that option strips the plain
// `color:`/`background-color:` inline styles entirely and leaves only the
// `--shiki-light`/`--shiki-dark` CSS variables — so with no `.dark` class
// present, tokens carry no color at all. Leaving `defaultColor` at its default
// keeps the light-theme colors inline (`color: ...`) while still emitting the
// `--shiki-dark` variable per span, which the CSS override below swaps in
// under `.dark`.
// Explicit tuple type: without it, TS widens the array literal to a union
// element type, which react-markdown's `Pluggable` (a fixed-length
// `[plugin, ...params]` tuple) then rejects.
export const rehypeShikiPlugin: [typeof rehypeShikiFromHighlighter, typeof highlighter, RehypeShikiCoreOptions] = [
  rehypeShikiFromHighlighter,
  highlighter,
  {
    themes: { light: 'github-light', dark: 'github-dark' },
  },
]

// LOADED_LANGS mirrors the `langs` array passed to createHighlighter above.
// The highlighter is built with an eagerly-loaded, FIXED language set — unlike
// shiki's `bundledLanguages` (every language shiki ships), which is a superset
// of what this instance actually has loaded. Checking against `bundledLanguages`
// would let a "known to shiki but not loaded here" lang slip through and throw
// at codeToHtml time. Checking against this loaded set instead guarantees the
// fallback branch is taken for anything the highlighter cannot actually render.
const LOADED_LANGS = new Set([
  'typescript',
  'javascript',
  'tsx',
  'go',
  'json',
  'bash',
  'python',
  'markdown',
])

// highlightToHtml renders a full code string to Shiki HTML (dual light/dark
// themes, CSS-variable driven like the markdown plugin above). Used by the
// file preview's `code` kind to highlight an entire file's contents directly
// — going through the markdown/code-fence plugin would break on file content
// that itself contains triple-backtick fences. Unknown/unloaded languages
// fall back to plain text ('text') instead of throwing, so an arbitrary file
// extension is always safe to pass through.
export function highlightToHtml(code: string, lang: string): string {
  return highlighter.codeToHtml(code, {
    lang: LOADED_LANGS.has(lang) ? lang : 'text',
    themes: { light: 'github-light', dark: 'github-dark' },
  })
}
