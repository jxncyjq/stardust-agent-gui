export interface GeneratedFile {
  path: string
  url: string
  downloadUrl: string
  name: string
}

// mapGeneratedFiles converts the backend's generated_files (snake_case
// download_url) into GeneratedFile[]. Non-array input yields [] — a task that
// wrote no files is a legitimate empty, not an error.
export function mapGeneratedFiles(raw: unknown): GeneratedFile[] {
  if (!Array.isArray(raw)) return []
  return raw.map((r) => {
    const o = r as Record<string, unknown>
    return {
      path: String(o.path ?? ''),
      url: String(o.url ?? ''),
      downloadUrl: String(o.download_url ?? ''),
      name: String(o.name ?? ''),
    }
  })
}

const PREVIEWABLE = new Set([
  'html', 'htm', 'md', 'markdown', 'txt', 'log', 'json', 'ts', 'tsx', 'js', 'jsx', 'go', 'py', 'sh', 'css', 'yaml', 'yml', 'toml',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp',
])

// isPreviewable decides whether a file can render in the in-app preview (vs
// download/open-external only). Extension-based; office/binary → false.
export function isPreviewable(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return PREVIEWABLE.has(ext)
}
