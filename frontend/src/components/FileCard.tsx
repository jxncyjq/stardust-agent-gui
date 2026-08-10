import { GetBrowserEndpoint, OpenPath, SaveGeneratedFile } from '../../wailsjs/go/main/App'
import { fetchPreview } from '../lib/fetchPreview'
import { isPreviewable, type GeneratedFile } from '../lib/generatedFiles'
import { usePreviewStore } from '../stores/previewStore'
import { useSessionStore } from '../stores/sessionStore'
import { CopyIcon, DownloadIcon, ExternalLinkIcon, EyeIcon, FileIcon } from './icons'

const ACTION_BTN =
  'interactive flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-40 disabled:pointer-events-none'

interface FileCardProps {
  file: GeneratedFile
}

// FileCard renders a single generated-file result: name + action row (preview,
// download, open-external, copy-link). download/open-external need the
// session's bound workingDir to resolve a filesystem path — when unbound they
// are disabled rather than silently no-op, per the fail-loud stance on
// "should exist but doesn't" state (this is a legitimate optional/unbound
// state, not an error, hence disabled + title hint rather than a thrown error).
export function FileCard({ file }: FileCardProps) {
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const root = useSessionStore((s) => s.sessions.find((x) => x.id === s.currentSessionId)?.workingDir)
  const canPreview = isPreviewable(file.name)

  const handlePreview = () => {
    // Preview goes through the Go side (fetchPreview → FetchPreviewFile) which
    // resolves the file from the current session — no cross-origin frontend fetch.
    fetchPreview(file, currentSessionId ?? '').then(usePreviewStore.getState().open).catch(console.error)
  }
  const handleOpenExternal = () => {
    if (!root) return
    Promise.resolve(OpenPath(root, file.path)).catch(console.error)
  }
  const handleDownload = () => {
    if (!root) return
    Promise.resolve(SaveGeneratedFile(root, file.path)).catch(console.error)
  }
  const handleCopyLink = () => {
    // file.url is relative ("/v1/files?...") when server.file_base_url is unset;
    // copying the bare relative path is useless outside the app, so resolve it to
    // an absolute URL against the live base. Absolute urls (configured domain)
    // pass through unchanged.
    void (async () => {
      let link = file.url
      if (!/^https?:\/\//i.test(link)) {
        const { baseURL } = await GetBrowserEndpoint()
        link = baseURL + link
      }
      await navigator.clipboard.writeText(link)
    })().catch(console.error)
  }

  return (
    <div className="flex items-center gap-2 rounded border border-border px-2 py-1.5 text-xs">
      <FileIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
      <span className="truncate max-w-[10rem]" title={file.name}>
        {file.name}
      </span>
      <div className="ml-auto flex items-center gap-1">
        {canPreview && (
          <button type="button" className={ACTION_BTN} onClick={handlePreview} aria-label="预览">
            <EyeIcon className="w-3.5 h-3.5" />
            <span>预览</span>
          </button>
        )}
        <button
          type="button"
          className={ACTION_BTN}
          onClick={handleDownload}
          aria-label="下载"
          disabled={!root}
          title={root ? undefined : '未绑定工作目录'}
        >
          <DownloadIcon className="w-3.5 h-3.5" />
          <span>下载</span>
        </button>
        <button
          type="button"
          className={ACTION_BTN}
          onClick={handleOpenExternal}
          aria-label="外部打开"
          disabled={!root}
          title={root ? undefined : '未绑定工作目录'}
        >
          <ExternalLinkIcon className="w-3.5 h-3.5" />
          <span>外部打开</span>
        </button>
        <button type="button" className={ACTION_BTN} onClick={handleCopyLink} aria-label="复制链接">
          <CopyIcon className="w-3.5 h-3.5" />
          <span>复制链接</span>
        </button>
      </div>
    </div>
  )
}
