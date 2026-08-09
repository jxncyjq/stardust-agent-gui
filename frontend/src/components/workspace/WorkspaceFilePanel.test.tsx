import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('../../../wailsjs/go/main/App', () => ({ ListWorkspaceDir: vi.fn().mockResolvedValue([]), ReadWorkspaceFile: vi.fn(), SearchWorkspaceContent: vi.fn(), OpenInEditor: vi.fn(), RevealInExplorer: vi.fn() }))
import { WorkspaceFilePanel } from './WorkspaceFilePanel'
import { useSessionStore } from '../../stores/sessionStore'

beforeEach(() => useSessionStore.setState({ currentSessionId: 's1', sessions: [{ id: 's1', project: 'p', title: 't', archived: false, updatedAt: '' }] }))

describe('WorkspaceFilePanel', () => {
  it('shows empty state when session has no working dir', () => {
    render(<WorkspaceFilePanel />)
    expect(screen.getByText(/未绑定工作目录/)).toBeInTheDocument()
  })

  it('shows the tree area when working dir is set', () => {
    useSessionStore.setState({ currentSessionId: 's1', sessions: [{ id: 's1', project: 'p', title: 't', archived: false, updatedAt: '', workingDir: '/w' }] })
    render(<WorkspaceFilePanel />)
    expect(screen.getByPlaceholderText(/过滤/)).toBeInTheDocument()
  })
})
