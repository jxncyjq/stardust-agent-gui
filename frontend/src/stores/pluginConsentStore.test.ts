import { describe, it, expect, beforeEach } from 'vitest'
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
})
