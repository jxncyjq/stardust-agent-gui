import { useEffect, useRef, useState } from 'react'
import { ListWorkspaceDir, SearchWorkspaceContent } from '../../../wailsjs/go/main/App'
import { main } from '../../../wailsjs/go/models'
import { useWorkspaceStore, type TreeNode } from '../../stores/workspaceStore'
import { ChevronDownIcon, ChevronRightIcon, FileIcon, FolderIcon } from '../icons'

// SEARCH_DEBOUNCE_MS delays the content-search RPC while the user is still
// typing after a "?" prefix. Filename filtering (the non-"?" path) applies
// synchronously instead — it's a pure client-side array filter, not an RPC,
// so there's nothing to debounce and delaying it would just make the tree
// feel laggy.
const SEARCH_DEBOUNCE_MS = 200

// nodeMatchesFilter reports whether `node` or any of its already-loaded
// descendants match `filterLower`. Unloaded (children === null) subtrees are
// invisible to the filter — we only filter what's actually in memory.
function nodeMatchesFilter(node: TreeNode, filterLower: string): boolean {
  if (node.entry.name.toLowerCase().includes(filterLower)) return true
  if (node.children) return node.children.some((c) => nodeMatchesFilter(c, filterLower))
  return false
}

interface TreeRowProps {
  node: TreeNode
  filterLower: string
}

function TreeRow({ node, filterLower }: TreeRowProps) {
  const rootDir = useWorkspaceStore((s) => s.rootDir)
  const expanded = useWorkspaceStore((s) => s.expanded)
  const selected = useWorkspaceStore((s) => s.selected)
  const setChildren = useWorkspaceStore((s) => s.setChildren)
  const toggleExpanded = useWorkspaceStore((s) => s.toggleExpanded)
  const select = useWorkspaceStore((s) => s.select)

  const isDir = node.entry.isDir
  const isExpanded = expanded.has(node.subPath)
  const isSelected = node.subPath === selected

  const handleClick = () => {
    if (!isDir) {
      select(node.subPath)
      return
    }
    if (node.children === null) {
      Promise.resolve(ListWorkspaceDir(rootDir, node.subPath))
        .then((entries) => {
          const kids: TreeNode[] = (entries || []).map((e) => ({
            entry: e,
            subPath: node.subPath ? `${node.subPath}/${e.name}` : e.name,
            children: null,
          }))
          setChildren(node.subPath, kids)
          toggleExpanded(node.subPath)
        })
        .catch((err) => console.error('list workspace dir failed:', err))
      return
    }
    toggleExpanded(node.subPath)
  }

  const children = node.children ?? []
  const visibleChildren = filterLower
    ? children.filter((c) => nodeMatchesFilter(c, filterLower))
    : children

  return (
    <div>
      <div
        onClick={handleClick}
        className={`flex items-center gap-1 px-1 py-0.5 cursor-pointer rounded hover:bg-accent ${
          isSelected ? 'bg-accent text-accent-foreground' : ''
        }`}
      >
        {isDir ? (
          isExpanded ? <ChevronDownIcon className="w-3 h-3 shrink-0" /> : <ChevronRightIcon className="w-3 h-3 shrink-0" />
        ) : (
          <span className="w-3 h-3 shrink-0" />
        )}
        {isDir ? <FolderIcon className="w-3.5 h-3.5 shrink-0" /> : <FileIcon className="w-3.5 h-3.5 shrink-0" />}
        <span className="truncate">{node.entry.name}</span>
      </div>
      {isDir && isExpanded && (
        <div className="pl-3">
          {visibleChildren.map((c) => (
            <TreeRow key={c.subPath} node={c} filterLower={filterLower} />
          ))}
        </div>
      )}
    </div>
  )
}

// FileTree renders the workspace file tree with a combined filename-filter /
// content-search bar above it. It is the top pane of the 文件 tab: type a
// plain string to filter loaded filenames client-side, or prefix with "?" to
// run a debounced full-text search across the workspace via the Go backend.
export function FileTree() {
  const rootDir = useWorkspaceStore((s) => s.rootDir)
  const roots = useWorkspaceStore((s) => s.roots)
  const filter = useWorkspaceStore((s) => s.filter)
  const searchHits = useWorkspaceStore((s) => s.searchHits)
  const setRoots = useWorkspaceStore((s) => s.setRoots)
  const setFilter = useWorkspaceStore((s) => s.setFilter)
  const setSearchHits = useWorkspaceStore((s) => s.setSearchHits)
  const select = useWorkspaceStore((s) => s.select)

  const [text, setText] = useState(filter)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (rootDir && roots.length === 0) {
      Promise.resolve(ListWorkspaceDir(rootDir, ''))
        .then((entries) => {
          const nodes: TreeNode[] = (entries || []).map((e) => ({ entry: e, subPath: e.name, children: null }))
          setRoots(nodes)
        })
        .catch((err) => console.error('list workspace dir failed:', err))
    }
    // Only re-run when the root directory changes; roots.length is checked,
    // not depended on, so loading a subdirectory later doesn't retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootDir])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setText(value)
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (value.startsWith('?')) {
      const query = value.slice(1)
      debounceRef.current = setTimeout(() => {
        Promise.resolve(SearchWorkspaceContent(rootDir, query))
          .then((hits) => setSearchHits(hits || []))
          .catch((err) => console.error('search workspace content failed:', err))
      }, SEARCH_DEBOUNCE_MS)
      return
    }
    setSearchHits(null)
    setFilter(value)
  }

  const handleHitClick = (hit: main.SearchHit) => {
    const subPath = hit.path.replace(rootDir, '').replace(/^[\\/]/, '')
    select(subPath)
    setSearchHits(null)
  }

  const filterLower = filter.toLowerCase()
  const visibleRoots = searchHits === null && filter ? roots.filter((n) => nodeMatchesFilter(n, filterLower)) : roots

  return (
    <div className="flex flex-col h-full text-xs">
      <input
        className="m-1 px-2 py-1 rounded border border-border bg-background text-foreground"
        placeholder="过滤文件名，? text 搜内容"
        value={text}
        onChange={handleChange}
      />
      <div className="flex-1 overflow-auto">
        {searchHits !== null ? (
          <div>
            {searchHits.length === 0 && <p className="p-2 text-muted-foreground">无匹配结果</p>}
            {searchHits.map((h, i) => (
              <div
                key={`${h.path}-${h.line}-${i}`}
                onClick={() => handleHitClick(h)}
                className="p-1 cursor-pointer rounded hover:bg-accent"
              >
                <div className="font-mono truncate">{h.path}:{h.line}</div>
                <div className="text-muted-foreground truncate">{h.snippet}</div>
              </div>
            ))}
          </div>
        ) : (
          visibleRoots.map((n) => <TreeRow key={n.subPath} node={n} filterLower={filterLower} />)
        )}
      </div>
    </div>
  )
}
