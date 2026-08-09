import { useEffect } from 'react'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import { ReadHTMLFile } from '../../wailsjs/go/main/App'
import { usePreviewStore } from '../stores/previewStore'

// PreviewOpenPayload is what the backend emits on `preview:open`. Either inline
// HTML, or a local file path the frontend resolves via ReadHTMLFile. Kept as a
// discriminated union so a malformed payload is caught, not guessed at.
type PreviewOpenPayload =
  | { kind: 'html'; html: string; title?: string; sourceUrl?: string }
  | { kind: 'localFile'; path: string; title?: string }

// useHtmlPreviewEvents listens for backend-driven preview requests and pushes
// them into previewStore. Mounted once at App level (alongside
// useBrowserSession). A localFile payload is resolved through the fail-loud
// ReadHTMLFile binding before opening; any resolution/parse failure is logged
// at the boundary (never silently swallowed) and the panel is left untouched.
export function useHtmlPreviewEvents() {
  const open = usePreviewStore((s) => s.open)
  useEffect(() => {
    const handle = (payload: PreviewOpenPayload) => {
      if (!payload || typeof payload !== 'object') {
        console.error('preview:open payload not an object:', payload)
        return
      }
      if (payload.kind === 'html' && typeof payload.html === 'string') {
        open({ kind: 'html', html: payload.html, title: payload.title, sourceUrl: payload.sourceUrl })
        return
      }
      if (payload.kind === 'localFile' && typeof payload.path === 'string') {
        ReadHTMLFile(payload.path)
          .then((html) => open({ kind: 'html', html, title: payload.title }))
          .catch((err) => console.error('preview:open ReadHTMLFile failed:', payload.path, err))
        return
      }
      console.error('preview:open payload unrecognized:', payload)
    }
    EventsOn('preview:open', handle)
    return () => EventsOff('preview:open')
  }, [open])
}
