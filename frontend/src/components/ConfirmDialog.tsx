import { useEffect } from 'react'
import { useConfirmStore } from '../stores/confirmStore'

// ConfirmDialog renders the single app-wide confirmation prompt driven by
// confirmStore. Mounted once at the App root. Esc / backdrop / cancel resolve
// false; the confirm button resolves true. Styling mirrors SettingsModal so
// destructive confirmations look native to the app (unlike window.confirm).
export function ConfirmDialog() {
  const request = useConfirmStore((s) => s.request)
  const accept = useConfirmStore((s) => s.accept)
  const cancel = useConfirmStore((s) => s.cancel)

  useEffect(() => {
    if (!request) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') cancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [request, cancel])

  if (!request) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={cancel}>
      <div
        className="bg-background border border-border rounded-lg shadow-xl w-full max-w-[420px] mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold">{request.title}</p>
        </div>
        <p className="px-4 py-3 text-sm text-foreground whitespace-pre-wrap">{request.message}</p>
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-border">
          <button
            className="interactive text-xs px-3 py-1 rounded hover:bg-muted text-muted-foreground"
            onClick={cancel}
          >
            {request.cancelLabel}
          </button>
          <button
            className={
              'interactive text-xs px-3 py-1 rounded text-primary-foreground ' +
              (request.danger ? 'bg-destructive hover:opacity-90' : 'bg-primary hover:opacity-90')
            }
            onClick={accept}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
