import { memo } from 'react'
import { BrowserOpenURL } from '../../wailsjs/runtime/runtime'
import type { PreviewSource } from '../stores/previewStore'
import { XIcon, ExternalLinkIcon } from './icons'

interface Props {
  source: PreviewSource | null
  onClose: () => void
}

// WebPreviewPanel renders an HTML preview inside a fully sandboxed iframe. It is
// a pure, props-driven component (no store access) so it is trivial to test.
//
// Security: srcdoc + `sandbox=""` (empty) means the content is treated as an
// opaque origin with EVERY capability withheld — no scripts, no same-origin, no
// forms. Agent-supplied HTML that contains <script> simply does not execute.
// Remote URLs never reach this iframe; they open in the system browser instead
// (see the toolbar action), sidestepping X-Frame-Options entirely.
export const WebPreviewPanel = memo(function WebPreviewPanel({ source, onClose }: Props) {
  if (!source || source.kind !== 'html') {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
        暂无预览内容
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1">
        <span className="flex-1 truncate text-xs font-medium text-foreground">
          {source.title ?? 'HTML 预览'}
        </span>
        {source.sourceUrl && (
          <button
            type="button"
            className="interactive rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => BrowserOpenURL(source.sourceUrl!)}
            aria-label="在系统浏览器打开"
            title="在系统浏览器打开"
          >
            <ExternalLinkIcon className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          className="interactive rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onClose}
          aria-label="关闭预览"
          title="关闭预览"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <iframe
        title="HTML 预览内容"
        sandbox=""
        srcDoc={source.html}
        className="min-h-0 flex-1 w-full border-0 bg-white"
      />
    </div>
  )
})
