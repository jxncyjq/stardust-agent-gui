import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const appMocks = vi.hoisted(() => ({ ReadHTMLFile: vi.fn() }))
vi.mock('../../wailsjs/go/main/App', () => appMocks)

const runtimeMocks = vi.hoisted(() => {
  const listeners: Record<string, Array<(...a: any[]) => void>> = {}
  return {
    listeners,
    EventsOn: vi.fn((name: string, cb: (...a: any[]) => void) => {
      ;(listeners[name] ??= []).push(cb)
      return () => { listeners[name] = (listeners[name] ?? []).filter((c) => c !== cb) }
    }),
    EventsOff: vi.fn((name: string) => { delete listeners[name] }),
  }
})
vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: runtimeMocks.EventsOn,
  EventsOff: runtimeMocks.EventsOff,
}))

import { useHtmlPreviewEvents } from './useHtmlPreviewEvents'
import { usePreviewStore } from '../stores/previewStore'

function Harness() { useHtmlPreviewEvents(); return null }
function emit(payload: unknown) {
  for (const cb of runtimeMocks.listeners['preview:open'] ?? []) cb(payload)
}

describe('useHtmlPreviewEvents', () => {
  beforeEach(() => {
    usePreviewStore.getState().close()
    appMocks.ReadHTMLFile.mockReset()
  })

  it('opens inline html payloads directly', () => {
    render(<Harness />)
    emit({ kind: 'html', html: '<h1>x</h1>', title: 'T' })
    expect(usePreviewStore.getState().source).toEqual({ kind: 'html', html: '<h1>x</h1>', title: 'T' })
  })

  it('resolves a localFile payload via ReadHTMLFile then opens it', async () => {
    appMocks.ReadHTMLFile.mockResolvedValue('<h1>file</h1>')
    render(<Harness />)
    emit({ kind: 'localFile', path: '/tmp/r.html', title: 'R' })
    await waitFor(() =>
      expect(usePreviewStore.getState().source).toEqual({ kind: 'html', html: '<h1>file</h1>', title: 'R' })
    )
    expect(appMocks.ReadHTMLFile).toHaveBeenCalledWith('/tmp/r.html')
  })

  it('does not open when ReadHTMLFile rejects', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    appMocks.ReadHTMLFile.mockRejectedValue(new Error('bad ext'))
    render(<Harness />)
    emit({ kind: 'localFile', path: '/tmp/r.txt' })
    await waitFor(() => expect(err).toHaveBeenCalled())
    expect(usePreviewStore.getState().source).toBeNull()
    err.mockRestore()
  })

  it('ignores malformed payloads', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Harness />)
    emit({ kind: 'nonsense' })
    expect(usePreviewStore.getState().source).toBeNull()
    err.mockRestore()
  })
})
