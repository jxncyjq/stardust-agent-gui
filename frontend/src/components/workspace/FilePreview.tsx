import { useEffect, useState } from 'react'
import { ReadWorkspaceFile, OpenInEditor, RevealInExplorer } from '../../../wailsjs/go/main/App'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import type { PreviewSource } from '../../stores/previewStore'
import { getEditorTemplate, setEditorTemplate } from '../../lib/editorTemplate'
import { CopyIcon, ExternalLinkIcon, FolderIcon, SettingsIcon, EyeIcon } from '../icons'
import { PreviewContent } from '../PreviewContent'

function basename(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

function toPreviewSource(absPath: string, title: string, wf: { kind: string; text: string; dataURI: string; lang: string }): PreviewSource {
  switch (wf.kind) {
    case 'html':
      return { kind: 'html', html: wf.text, path: absPath, title }
    case 'markdown':
      return { kind: 'markdown', text: wf.text, path: absPath, title }
    case 'code':
      return { kind: 'code', text: wf.text, lang: wf.lang, path: absPath, title }
    case 'image':
      return { kind: 'image', dataUri: wf.dataURI, path: absPath, title }
    default:
      return { kind: 'binary', path: absPath, title }
  }
}

// FilePreview is the bottom pane of the 文件 tab. It reacts to
// workspaceStore.selected: reads the file via the Go backend, maps it to a
// PreviewSource, and renders it through the shared PreviewContent component.
// The toolbar offers 源码/渲染 toggle (markdown/html only), copy-path,
// reveal-in-explorer, and open-in-external-editor (via a user-configured
// command template stored in localStorage).
export function FilePreview() {
  const rootDir = useWorkspaceStore((s) => s.rootDir)
  const selected = useWorkspaceStore((s) => s.selected)

  const [source, setSource] = useState<PreviewSource | null>(null)
  const [raw, setRaw] = useState(false)
  const [template, setTemplate] = useState(() => getEditorTemplate())
  const [showTemplateEditor, setShowTemplateEditor] = useState(false)

  useEffect(() => {
    if (!selected) {
      setSource(null)
      return
    }
    const absPath = rootDir ? `${rootDir}/${selected}` : selected
    const title = basename(selected)
    setRaw(false)
    Promise.resolve(ReadWorkspaceFile(rootDir, absPath))
      .then((wf) => setSource(toPreviewSource(absPath, title, wf)))
      .catch((err) => console.error('read workspace file failed:', err))
  }, [rootDir, selected])

  if (!selected || !source) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
        未选择文件，请在上方选择文件以预览
      </div>
    )
  }

  const absPath = source.path ?? (rootDir ? `${rootDir}/${selected}` : selected)
  const canToggleRaw = source.kind === 'markdown' || source.kind === 'html'

  const handleCopyPath = () => {
    navigator.clipboard.writeText(absPath).catch((err) => console.error('copy path failed:', err))
  }

  const handleReveal = () => {
    Promise.resolve(RevealInExplorer(absPath)).catch((err) => console.error('reveal in explorer failed:', err))
  }

  const handleOpenInEditor = () => {
    if (!template) return
    Promise.resolve(OpenInEditor(template, absPath)).catch((err) => console.error('open in editor failed:', err))
  }

  const handleSaveTemplate = () => {
    setEditorTemplate(template)
    setShowTemplateEditor(false)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        <span className="flex-1 truncate text-xs font-mono text-foreground" title={selected}>
          {selected}
        </span>
        {canToggleRaw && (
          <button
            type="button"
            className="interactive rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setRaw((v) => !v)}
            aria-label={raw ? '渲染预览' : '源码'}
            title={raw ? '渲染预览' : '源码'}
          >
            <EyeIcon className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          className="interactive rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={handleCopyPath}
          aria-label="复制路径"
          title="复制路径"
        >
          <CopyIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="interactive rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={handleReveal}
          aria-label="在资源管理器中显示"
          title="在资源管理器中显示"
        >
          <FolderIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="interactive rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={handleOpenInEditor}
          disabled={!template}
          aria-label="用编辑器打开"
          title={template ? '用编辑器打开' : '请先设置编辑器命令模板'}
        >
          <ExternalLinkIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="interactive rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setShowTemplateEditor((v) => !v)}
          aria-label="设置编辑器命令模板"
          title="设置编辑器命令模板"
        >
          <SettingsIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      {showTemplateEditor && (
        <div className="flex items-center gap-1 border-b border-border px-2 py-1">
          <input
            className="flex-1 rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground"
            placeholder='编辑器命令模板，如 code "{path}"'
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          />
          <button
            type="button"
            className="interactive rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted"
            onClick={handleSaveTemplate}
          >
            保存
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 flex flex-col">
        <PreviewContent source={source} raw={raw} />
      </div>
    </div>
  )
}
