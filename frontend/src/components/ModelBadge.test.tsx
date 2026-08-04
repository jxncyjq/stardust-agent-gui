import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// vi.mock() factories are hoisted above imports/top-level consts (see
// ModeSelector.test.tsx), so the mock object must be built with vi.hoisted().
const mocks = vi.hoisted(() => ({
  GetAgentModelInfo: vi.fn(),
}))
vi.mock('../../wailsjs/go/main/App', () => mocks)

import { ModelBadge, formatContext } from './ModelBadge'
import { useAgentStore } from '../stores/agentStore'

describe('formatContext', () => {
  it('formats K/M and unset', () => {
    expect(formatContext(128000)).toBe('128K')
    expect(formatContext(1000000)).toBe('1M')
    expect(formatContext(500)).toBe('500')
    expect(formatContext(0)).toBe('context 未设')
  })
})

beforeEach(() => {
  mocks.GetAgentModelInfo.mockReset()
  useAgentStore.setState({ selected: 'default' })
})

describe('ModelBadge', () => {
  it('shows model and formatted context once resolved', async () => {
    mocks.GetAgentModelInfo.mockResolvedValue({
      model: 'claude-sonnet-5',
      context_length: 200000,
      profile: 'p1',
    })
    render(<ModelBadge />)

    await waitFor(() => {
      expect(screen.getByText('claude-sonnet-5 · 200K')).toBeInTheDocument()
    })
    expect(mocks.GetAgentModelInfo).toHaveBeenCalledWith('default')
  })

  it('shows "context 未设" when context_length is 0', async () => {
    mocks.GetAgentModelInfo.mockResolvedValue({
      model: 'claude-sonnet-5',
      context_length: 0,
      profile: 'p1',
    })
    render(<ModelBadge />)

    await waitFor(() => {
      expect(screen.getByText('claude-sonnet-5 · context 未设')).toBeInTheDocument()
    })
  })

  // Fail-loud: a resolution error (e.g. maas_profile points at a missing
  // profile) must surface visibly, not be hidden behind a default value.
  it('fails loud with "配置错误" and the reason in the tooltip when resolution errors', async () => {
    mocks.GetAgentModelInfo.mockRejectedValue(new Error('profile "x" not found'))
    render(<ModelBadge />)

    await waitFor(() => {
      expect(screen.getByText('配置错误')).toBeInTheDocument()
    })
    expect(screen.getByText('配置错误')).toHaveAttribute(
      'title',
      expect.stringContaining('profile "x" not found'),
    )
  })

  it('re-fetches when the selected agent changes', async () => {
    mocks.GetAgentModelInfo.mockResolvedValue({
      model: 'm1',
      context_length: 1000,
      profile: 'p1',
    })
    render(<ModelBadge />)
    await waitFor(() => {
      expect(mocks.GetAgentModelInfo).toHaveBeenCalledWith('default')
    })

    useAgentStore.setState({ selected: 'sub-agent' })
    await waitFor(() => {
      expect(mocks.GetAgentModelInfo).toHaveBeenCalledWith('sub-agent')
    })
  })
})
