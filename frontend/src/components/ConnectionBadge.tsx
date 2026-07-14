import { useServeStore } from '../stores/serveStore'

export function ConnectionBadge() {
  const { running, port } = useServeStore()
  return (
    <div className="flex items-center gap-1.5 text-xs px-2 py-1">
      <span className={`w-2 h-2 rounded-full ${running ? 'bg-green-500' : 'bg-red-400'}`} />
      <span className="text-muted-foreground">
        {running ? `连接中 :${port}` : '未连接'}
      </span>
    </div>
  )
}
