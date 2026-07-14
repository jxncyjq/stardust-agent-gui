import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '../lib/utils'
import type { Message } from '../stores/chatStore'

interface Props {
  message: Message
}

// downloadMarkdown saves the given text as a .md file via an object URL. Wails'
// webview honours the anchor download attribute, so this triggers a native
// "save as" dialog without a backend round-trip.
function downloadMarkdown(content: string, id: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `legion-${id}.md`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

// formatK renders a token count in thousands (1000 -> "1k"), keeping one
// decimal only when it carries information (1500 -> "1.5k", 1000 -> "1k").
function formatK(n: number): string {
  const k = n / 1000
  const s = k.toFixed(1).replace(/\.0$/, '')
  return `${s}k`
}

export function MessageBubble({ message }: Props) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  // System notices (slash command output) are full-width, dimmer, monospaced,
  // and prefixed so they read as command output rather than a model reply.
  if (message.role === 'system') {
    return (
      <div className="self-stretch rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span className="mr-1 font-semibold text-foreground">⌘</span>
        <span className="whitespace-pre-wrap font-mono">{message.content}</span>
      </div>
    )
  }

  const isAssistant = message.role === 'assistant'
  const meta = message.meta

  return (
    <div className={cn(
      'max-w-[80%] rounded-lg px-4 py-3 text-sm',
      message.role === 'user'
        ? 'self-end bg-primary text-primary-foreground ml-auto'
        : 'self-start bg-muted text-foreground'
    )}>
      {isAssistant ? (
        // react-markdown v10 dropped the `className` prop; wrap instead.
        <div className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-background prose-pre:text-foreground prose-table:my-2 prose-headings:mt-3 prose-headings:mb-1">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content || (message.streaming ? '▋' : '')}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="whitespace-pre-wrap">{message.content}</p>
      )}

      {isAssistant && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/50 pt-2 text-xs text-muted-foreground">
          {meta && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>用时 {meta.elapsedSec}s</span>
              <span>输入 {formatK(meta.promptTokens)}</span>
              {meta.cachedTokens > 0 && <span>缓存 {formatK(meta.cachedTokens)}</span>}
              <span>输出 {formatK(meta.completionTokens)}</span>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              className="rounded px-2 py-0.5 hover:bg-background hover:text-foreground"
              onClick={copy}
            >
              {copied ? '已复制' : '复制'}
            </button>
            <button
              className="rounded px-2 py-0.5 hover:bg-background hover:text-foreground"
              onClick={() => downloadMarkdown(message.content, message.id)}
            >
              下载
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
