import { create } from 'zustand'

// pluginConsentStore tracks how many plugin grant/deny/retry-convergence
// requests are currently outstanding: PluginConsentDialog's submit() and
// PluginsPage's row-level retryConvergence() both call
// beginPluginConsent()/endPluginConsent() around their await. It exists so
// SettingsModal's Escape handler can refuse to close while one is in
// flight — mirroring the existing
// `if (useConfirmStore.getState().request) return` guard in that same
// handler — because none of these Wails bindings has abort semantics: the
// server keeps converging regardless of what the UI does, so dismissing the
// modal here would be exactly the "looks like cancel, isn't" lie
// PluginConsentDialog's own no-cancel-button rule exists to prevent.
//
// A count rather than a boolean: a dialog submit and a different row's
// convergence retry can legitimately overlap.
interface PluginConsentState {
  inFlight: number
}

export const usePluginConsentStore = create<PluginConsentState>(() => ({
  inFlight: 0,
}))

export function beginPluginConsent() {
  usePluginConsentStore.setState((s) => ({ inFlight: s.inFlight + 1 }))
}

// endPluginConsent decrements inFlight, clamped at zero so the SettingsModal
// close guard degrades safely rather than latching permanently armed. A
// negative inFlight is never a legitimate state — it can only mean an
// unbalanced begin/end call, i.e. a bug in one of the two callers above — so
// that case is logged loudly rather than silently absorbed by the clamp.
// This must not throw: both callers invoke endPluginConsent() inside a
// `finally`, where a thrown assertion would replace a genuine in-flight
// error with this one.
export function endPluginConsent() {
  usePluginConsentStore.setState((s) => {
    if (s.inFlight <= 0) {
      console.error(
        'pluginConsentStore: endPluginConsent() with inFlight=' + s.inFlight +
          '; begin/end are unbalanced and the SettingsModal close guard is now unreliable',
      )
    }
    return { inFlight: Math.max(0, s.inFlight - 1) }
  })
}
