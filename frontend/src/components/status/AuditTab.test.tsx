import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ ListAuditEvents: vi.fn() }))
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

import { AuditTab } from './AuditTab'

beforeEach(() => {
  mocks.ListAuditEvents.mockReset().mockResolvedValue([])
  for (const k of Object.keys(runtimeMocks.listeners)) delete runtimeMocks.listeners[k]
})

describe('AuditTab heuristic refresh (A2)', () => {
  it('AuditTab refreshes heuristically on task_completed/failed (A2)', async () => {
    render(<AuditTab />)
    await waitFor(() => expect(mocks.ListAuditEvents).toHaveBeenCalledTimes(1))
    emit('agent:event', { type: 'tool_executed', data: '{}' }) // 非终态，不触发
    emit('agent:event', { type: 'task_completed', data: '{}' }) // 终态，启发式刷新
    await waitFor(() => expect(mocks.ListAuditEvents).toHaveBeenCalledTimes(2))
  })
})
