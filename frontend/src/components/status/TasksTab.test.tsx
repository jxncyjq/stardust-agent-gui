import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ ListTasks: vi.fn() }))
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

import { TasksTab } from './TasksTab'

beforeEach(() => {
  mocks.ListTasks.mockReset().mockResolvedValue([])
  for (const k of Object.keys(runtimeMocks.listeners)) delete runtimeMocks.listeners[k]
})

describe('TasksTab event-driven refresh (A2)', () => {
  it('refreshes on task_* events but ignores others', async () => {
    render(<TasksTab />)
    await waitFor(() => expect(mocks.ListTasks).toHaveBeenCalledTimes(1))
    emit('agent:event', { type: 'tool_executed', data: '{}' }) // 非 task_*，不刷新
    emit('agent:event', { type: 'task_completed', data: '{}' }) // task_*，刷新
    await waitFor(() => expect(mocks.ListTasks).toHaveBeenCalledTimes(2))
  })
})
