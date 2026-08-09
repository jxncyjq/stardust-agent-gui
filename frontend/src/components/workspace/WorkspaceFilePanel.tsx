import { useEffect } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { FileTree } from './FileTree'
import { FilePreview } from './FilePreview'

// WorkspaceFilePanel is the 文件 tab of the right column. It binds
// workspaceStore's root directory to the current session's workingDir, then
// renders a fixed-ratio vertical split of the file tree above the file
// preview. A maximize toggle overlays the same pair full-screen for sessions
// where the fixed split is too cramped to work in comfortably.
export function WorkspaceFilePanel() {
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const sessions = useSessionStore((s) => s.sessions)
  const rootDir = useWorkspaceStore((s) => s.rootDir)
  const maximized = useWorkspaceStore((s) => s.maximized)
  const setMaximized = useWorkspaceStore((s) => s.setMaximized)

  const currentSession = sessions.find((s) => s.id === currentSessionId)
  const workingDir = currentSession?.workingDir

  useEffect(() => {
    const next = workingDir ?? ''
    if (next !== useWorkspaceStore.getState().rootDir) {
      useWorkspaceStore.getState().setRoot(next)
    }
  }, [workingDir])

  if (!workingDir) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
        未绑定工作目录，请先为当前会话绑定工作目录
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end border-b border-border px-2 py-1">
        <button
          type="button"
          className="interactive rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted"
          onClick={() => setMaximized(true)}
          aria-label="最大化文件面板"
          title="最大化文件面板"
        >
          最大化
        </button>
      </div>
      <div className="flex h-1/2 min-h-0 flex-col border-b border-border">
        <FileTree />
      </div>
      <div className="flex-1 min-h-0">
        <FilePreview />
      </div>

      {maximized && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-medium text-foreground">工作目录：{rootDir}</span>
            <button
              type="button"
              className="interactive rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted"
              onClick={() => setMaximized(false)}
              aria-label="还原文件面板"
              title="还原文件面板"
            >
              还原
            </button>
          </div>
          <div className="flex flex-1 min-h-0">
            <div className="flex w-1/3 min-h-0 flex-col border-r border-border">
              <div className="border-b border-border px-2 py-1 text-xs font-medium text-muted-foreground">Files</div>
              <div className="flex-1 min-h-0">
                <FileTree />
              </div>
            </div>
            <div className="flex flex-1 min-h-0 flex-col">
              <div className="border-b border-border px-2 py-1 text-xs font-medium text-muted-foreground">File</div>
              <div className="flex-1 min-h-0">
                <FilePreview />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
