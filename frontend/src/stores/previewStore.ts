import { create } from 'zustand'

// PreviewSource is the fully-resolved payload the panel renders: always an HTML
// string fed to <iframe srcdoc>. A local file is resolved to this shape by the
// backend before it reaches the store — the store never holds a bare path.
export type PreviewSource =
  | { kind: 'html';     html: string;    title?: string; sourceUrl?: string }
  | { kind: 'code';     text: string;    lang: string;   title?: string; path?: string }
  | { kind: 'markdown'; text: string;    title?: string; path?: string }
  | { kind: 'image';    dataUri: string; title?: string; path?: string }
  | { kind: 'binary';   title?: string;  path?: string }

interface PreviewState {
  source: PreviewSource | null
  open: (src: PreviewSource) => void
  close: () => void
}

// previewStore holds the single active HTML preview. It is a singleton panel:
// a new open() replaces whatever was showing. Kept deliberately pure (no
// cross-store writes) so it stays trivially testable; the right-column tab
// auto-switch lives in RightPanel as an effect on `source`.
export const usePreviewStore = create<PreviewState>((set) => ({
  source: null,
  open: (src) => set({ source: src }),
  close: () => set({ source: null }),
}))
