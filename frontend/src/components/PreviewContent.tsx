import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { rehypeShikiPlugin, highlightToHtml } from '../lib/highlighter'
import { parseFrontmatter } from '../lib/frontmatter'
import type { PreviewSource } from '../stores/previewStore'

interface Props {
  source: PreviewSource
  // raw shows the unrendered source (<pre>) for markdown/html; ignored otherwise.
  raw: boolean
}

// PreviewContent is the shared, kind-dispatched preview renderer. It backs both
// the chat-triggered 预览 tab (WebPreviewPanel) and the file browser's preview
// pane. Pure and props-driven for testability. Security for `html` matches the
// original panel: sandbox="" withholds scripts/same-origin entirely.
export const PreviewContent = memo(function PreviewContent({ source, raw }: Props) {
  switch (source.kind) {
    case 'html':
      if (raw) return <pre className="p-3 text-xs whitespace-pre-wrap break-all">{source.html}</pre>
      return (
        <iframe
          title="HTML 预览内容"
          sandbox=""
          srcDoc={source.html}
          className="min-h-0 flex-1 w-full h-full border-0 bg-white"
        />
      )
    case 'code':
      return (
        <div
          className="preview-code overflow-auto p-1 text-xs"
          dangerouslySetInnerHTML={{ __html: highlightToHtml(source.text, source.lang) }}
        />
      )
    case 'markdown': {
      if (raw) return <pre className="p-3 text-xs whitespace-pre-wrap break-all">{source.text}</pre>
      const { props, body } = parseFrontmatter(source.text)
      return (
        <div className="overflow-auto p-3">
          {props.length > 0 && (
            <table className="mb-3 w-full border-collapse text-xs">
              <tbody>
                {props.map((p) => (
                  <tr key={p.key} className="border-b border-border/50">
                    <td className="w-32 py-1 pr-3 align-top text-muted-foreground">{p.key}</td>
                    <td className="py-1 align-top text-foreground break-all">{p.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-background prose-pre:text-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeShikiPlugin]}>
              {body}
            </ReactMarkdown>
          </div>
        </div>
      )
    }
    case 'image':
      return (
        <div className="flex h-full items-center justify-center overflow-auto p-3">
          <img src={source.dataUri} alt={source.title ?? '图片预览'} className="max-w-full max-h-full object-contain" />
        </div>
      )
    case 'binary':
      return (
        <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
          不支持预览此文件
        </div>
      )
  }
})
