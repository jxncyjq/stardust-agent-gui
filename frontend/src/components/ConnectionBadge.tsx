import { useServeStore } from '../stores/serveStore'

export function ConnectionBadge() {
  const { running, port } = useServeStore()
  return (
    <div
      className="flex items-center gap-1.5 text-xs px-2 py-1"
      role="status"
      aria-live="polite"
      title={running ? `已连接内嵌服务，端口 ${port}` : '未连接内嵌服务'}
    >
      <span
        className={`w-2 h-2 rounded-full ${running ? 'bg-emerald-500' : 'bg-destructive'}`}
        aria-hidden="true"
      />
      <span className="text-muted-foreground">
        {running ? `连接中 :${port}` : '未连接'}
      </span>
    </div>
  )
}
