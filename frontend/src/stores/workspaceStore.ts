import { create } from 'zustand'
import { main } from '../../wailsjs/go/models'

// TreeNode caches one loaded directory level. children===null means "not loaded
// yet" (lazy). subPath is relative to rootDir.
export interface TreeNode {
  entry: main.WorkspaceEntry
  subPath: string
  children: TreeNode[] | null
}

interface WorkspaceState {
  rootDir: string
  roots: TreeNode[]
  expanded: Set<string>
  selected: string | null
  filter: string
  searchHits: main.SearchHit[] | null
  maximized: boolean
  setRoot: (dir: string) => void
  setRoots: (nodes: TreeNode[]) => void
  setChildren: (subPath: string, children: TreeNode[]) => void
  toggleExpanded: (subPath: string) => void
  select: (subPath: string | null) => void
  setFilter: (f: string) => void
  setSearchHits: (hits: main.SearchHit[] | null) => void
  setMaximized: (v: boolean) => void
  reset: () => void
}

const empty = {
  roots: [] as TreeNode[], expanded: new Set<string>(), selected: null as string | null,
  filter: '', searchHits: null as main.SearchHit[] | null, maximized: false,
}

function attach(nodes: TreeNode[], subPath: string, children: TreeNode[]): TreeNode[] {
  return nodes.map((n) => {
    if (n.subPath === subPath) return { ...n, children }
    if (n.children) return { ...n, children: attach(n.children, subPath, children) }
    return n
  })
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  rootDir: '',
  ...empty,
  setRoot: (dir) => set({ rootDir: dir, ...empty }),
  setRoots: (nodes) => set({ roots: nodes }),
  setChildren: (subPath, children) => set((s) => ({ roots: attach(s.roots, subPath, children) })),
  toggleExpanded: (subPath) => set((s) => {
    const next = new Set(s.expanded)
    if (next.has(subPath)) next.delete(subPath); else next.add(subPath)
    return { expanded: next }
  }),
  select: (subPath) => set({ selected: subPath }),
  setFilter: (f) => set({ filter: f }),
  setSearchHits: (hits) => set({ searchHits: hits }),
  setMaximized: (v) => set({ maximized: v }),
  reset: () => set({ rootDir: '', ...empty }),
}))
