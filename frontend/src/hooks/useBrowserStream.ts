import { useEffect } from 'react'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import { useBrowserStore, type BrowserElement } from '../stores/browserStore'

// useBrowserStream feeds the browser view for the given sessionId from the
// screencast/observation/progress events the Go side forwards as Wails events
// (see browser_stream_bridge.go). The stream is consumed in the Go process, not
// read directly by this webview: WebView2's fetch+ReadableStream reader cannot
// consume a long-lived text/event-stream body, so the previous direct reader
// connected and immediately dropped, leaving the canvas blank and the badge
// amber. Every forwarded event carries the originating session_id; events for
// any other session are ignored so a stale listener cannot cross-write.
export function useBrowserStream(sessionId: string | null) {
  useEffect(() => {
    if (!sessionId) return
    const state = useBrowserStore.getState
    const forSession = (p: { session_id?: string }) => p?.session_id === sessionId

    const onFrame = (p: { session_id?: string; data?: string }) => {
      if (!forSession(p) || !p.data) return
      let f: { mime: string; b64: string }
      try {
        f = JSON.parse(p.data)
      } catch (err) {
        console.error('browser:frame data not JSON:', p, err)
        return
      }
      state().onFrame(f.mime, f.b64)
    }
    const onObservation = (p: { session_id?: string; data?: string }) => {
      if (!forSession(p) || !p.data) return
      let obs: { elements: BrowserElement[]; text: string }
      try {
        obs = JSON.parse(p.data)
      } catch (err) {
        console.error('browser:observation data not JSON:', p, err)
        return
      }
      state().onObservation(obs)
    }
    const onProgress = (p: { session_id?: string; data?: string }) => {
      if (!forSession(p) || !p.data) return
      let prog: { action: string; status: string; ref?: string }
      try {
        prog = JSON.parse(p.data)
      } catch (err) {
        console.error('browser:progress data not JSON:', p, err)
        return
      }
      state().onProgress(prog)
    }
    const onStream = (p: { session_id?: string; connected?: boolean }) => {
      if (!forSession(p)) return
      state().setConnected(Boolean(p.connected))
    }

    EventsOn('browser:frame', onFrame)
    EventsOn('browser:observation', onObservation)
    EventsOn('browser:progress', onProgress)
    EventsOn('browser:stream', onStream)
    return () => {
      EventsOff('browser:frame')
      EventsOff('browser:observation')
      EventsOff('browser:progress')
      EventsOff('browser:stream')
      state().setConnected(false)
    }
  }, [sessionId])
}
