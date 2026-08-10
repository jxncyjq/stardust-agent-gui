import { FetchPreviewFile } from '../../wailsjs/go/main/App'
import type { PreviewSource } from '../stores/previewStore'
import type { GeneratedFile } from './generatedFiles'

// fetchPreview loads a generated file for preview THROUGH the Go side
// (FetchPreviewFile), which makes an authed request to the embedded service's
// /v1/files endpoint. It deliberately does NOT fetch from the frontend: the
// Wails webview origin is cross-origin to the loopback server, and that fetch is
// blocked by CORS (surfaces as net::ERR_FAILED / a spurious 304). Going through
// Go reuses the pooled authed client and sidesteps CORS entirely — the same
// reason every other GUI API call routes through Go. The server resolves the
// session's working dir from sessionID, so no local root is needed here.
export async function fetchPreview(file: GeneratedFile, sessionID: string): Promise<PreviewSource> {
  const wf = await FetchPreviewFile(sessionID, file.path)
  switch (wf.kind) {
    case 'image':
      return { kind: 'image', dataUri: wf.dataURI, title: file.name, path: file.path }
    case 'html':
      return { kind: 'html', html: wf.text, title: file.name, sourceUrl: file.url }
    case 'markdown':
      return { kind: 'markdown', text: wf.text, title: file.name, path: file.path }
    case 'binary':
      return { kind: 'binary', title: file.name, path: file.path }
    default:
      // 'code' (and any unknown Kind) render as highlighted text.
      return { kind: 'code', text: wf.text, lang: wf.lang || 'text', title: file.name, path: file.path }
  }
}
