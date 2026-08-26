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

export function endPluginConsent() {
  usePluginConsentStore.setState((s) => ({ inFlight: Math.max(0, s.inFlight - 1) }))
}
