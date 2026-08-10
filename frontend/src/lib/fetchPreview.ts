import { GetBrowserEndpoint } from '../../wailsjs/go/main/App'
import type { PreviewSource } from '../stores/previewStore'
import type { GeneratedFile } from './generatedFiles'

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', go: 'go', json: 'json',
  sh: 'bash', py: 'python', css: 'css', yaml: 'yaml', yml: 'yaml', toml: 'toml',
}
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'])

function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

// fetchPreview loads a generated file via the backend /v1/files endpoint (with
// the current loopback token) and maps it to a PreviewSource for PreviewContent.
// Relative urls are resolved against the live baseURL from GetBrowserEndpoint so
// a serve restart (new port) never breaks the link. Throws on non-2xx / network.
export async function fetchPreview(file: GeneratedFile): Promise<PreviewSource> {
  const { baseURL, token } = await GetBrowserEndpoint()
  const full = /^https?:\/\//i.test(file.url) ? file.url : baseURL + file.url
  const resp = await fetch(full, token ? { headers: { Authorization: 'Bearer ' + token } } : {})
  if (!resp.ok) {
    throw new Error(`preview fetch ${file.name} failed: ${resp.status}`)
  }
  const ext = extOf(file.name)
  if (IMAGE_EXT.has(ext)) {
    const blob = await resp.blob()
    const dataUri = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = () => reject(fr.error)
      fr.readAsDataURL(blob)
    })
    return { kind: 'image', dataUri, title: file.name, path: file.path }
  }
  const text = await resp.text()
  if (ext === 'html' || ext === 'htm') {
    return { kind: 'html', html: text, title: file.name, sourceUrl: file.url }
  }
  if (ext === 'md' || ext === 'markdown') {
    return { kind: 'markdown', text, title: file.name, path: file.path }
  }
  return { kind: 'code', text, lang: LANG_BY_EXT[ext] ?? 'text', title: file.name, path: file.path }
}
