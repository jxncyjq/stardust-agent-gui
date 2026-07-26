import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ ListRuntimeEvents: vi.fn() }))
vi.mock('../../../wailsjs/go/main/App', () => mocks)
const runtimeMocks = vi.hoisted(() => {
  const listeners: Record<string, Array<(...a: any[]) => void>> = {}
  return {
    listeners,
    EventsOn: vi.fn((name: string, cb: any) => { (listeners[name] ??= []).push(cb); return () => {} }),
  }
})
vi.mock('../../../wailsjs/runtime/runtime', () => ({ EventsOn: runtimeMocks.EventsOn }))
function emit(name: string, payload: any) { for (const cb of runtimeMocks.listeners[name] ?? []) cb(payload) }

import { EventsTab } from './EventsTab'

beforeEach(() => {
  mocks.ListRuntimeEvents.mockReset().mockResolvedValue([])
  for (const k of Object.keys(runtimeMocks.listeners)) delete runtimeMocks.listeners[k]
})

describe('EventsTab event-driven refresh (A2)', () => {
  it('refreshes when an agent:event arrives, not only on the interval', async () => {
    render(<EventsTab />)
    await waitFor(() => expect(mocks.ListRuntimeEvents).toHaveBeenCalledTimes(1)) // initial
    emit('agent:event', { type: 'tool_executed', data: '{}' })
    await waitFor(() => expect(mocks.ListRuntimeEvents).toHaveBeenCalledTimes(2)) // event-driven
  })
})
