import type { GeneratedFile } from '../lib/generatedFiles'
import { FileCard } from './FileCard'

interface FileCardListProps {
  files: GeneratedFile[]
}

// FileCardList renders the row of generated-file cards attached to an
// assistant turn. Empty input (a turn that wrote no files) renders nothing —
// a legitimate empty, not an error (see generatedFiles.mapGeneratedFiles).
export function FileCardList({ files }: FileCardListProps) {
  if (!files.length) return null
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {files.map((file) => (
        <FileCard key={file.path} file={file} />
      ))}
    </div>
  )
}
