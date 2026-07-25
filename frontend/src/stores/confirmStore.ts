import { create } from 'zustand'

export type ConfirmRequest = {
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  danger: boolean
}

type ConfirmState = {
  request: ConfirmRequest | null
  accept: () => void
  cancel: () => void
}

// resolver is held outside React state: it is the pending promise's resolve
// function, set by confirm() and called by accept()/cancel().
let resolver: ((v: boolean) => void) | null = null

export const useConfirmStore = create<ConfirmState>((set) => ({
  request: null,
  accept: () => {
    resolver?.(true)
    resolver = null
    set({ request: null })
  },
  cancel: () => {
    resolver?.(false)
    resolver = null
    set({ request: null })
  },
}))

// confirm opens the dialog and resolves to the user's choice. It replaces the
// native window.confirm so destructive confirmations match the app's theme and can be
// styled/keyboard-driven. Only one confirm is expected at a time; a second call
// while one is open cancels the first (its promise resolves false) rather than
// silently dropping the earlier resolver.
export function confirm(opts: {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}): Promise<boolean> {
  resolver?.(false) // an in-flight confirm is superseded, not leaked
  return new Promise<boolean>((resolve) => {
    resolver = resolve
    useConfirmStore.setState({
      request: {
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? '确认',
        cancelLabel: opts.cancelLabel ?? '取消',
        danger: opts.danger ?? false,
      },
    })
  })
}
