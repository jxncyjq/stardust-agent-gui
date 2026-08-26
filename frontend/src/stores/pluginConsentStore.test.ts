import { describe, it, expect, beforeEach, vi } from 'vitest'
import { usePluginConsentStore, beginPluginConsent, endPluginConsent } from './pluginConsentStore'

beforeEach(() => usePluginConsentStore.setState({ inFlight: 0 }))

describe('pluginConsentStore', () => {
  it('starts at zero', () => {
    expect(usePluginConsentStore.getState().inFlight).toBe(0)
  })

  it('begin/end pair back to zero', () => {
    beginPluginConsent()
    expect(usePluginConsentStore.getState().inFlight).toBe(1)
    endPluginConsent()
    expect(usePluginConsentStore.getState().inFlight).toBe(0)
  })

  it('tracks two overlapping in-flight requests independently', () => {
    beginPluginConsent()
    beginPluginConsent()
    expect(usePluginConsentStore.getState().inFlight).toBe(2)
    endPluginConsent()
    expect(usePluginConsentStore.getState().inFlight).toBe(1)
    endPluginConsent()
    expect(usePluginConsentStore.getState().inFlight).toBe(0)
  })

  it('never goes negative on an unpaired end', () => {
    endPluginConsent()
    expect(usePluginConsentStore.getState().inFlight).toBe(0)
  })

  // Roll-up (b) from the whole-branch final review: a negative inFlight can
  // only mean an unbalanced begin/end (a coding bug), and CLAUDE.md section 0
  // forbids silently self-correcting that away. The clamp itself must stay
  // (both callers invoke this inside a `finally`, so throwing would replace a
  // genuine in-flight error with this assertion) — but it must not be silent.
  it('logs an error (without throwing) on an unpaired end, while still clamping at zero', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => endPluginConsent()).not.toThrow()
    expect(usePluginConsentStore.getState().inFlight).toBe(0)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toMatch(/endPluginConsent.*inFlight=0/)
    spy.mockRestore()
  })

  it('does not log when begin/end are balanced', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    beginPluginConsent()
    endPluginConsent()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
