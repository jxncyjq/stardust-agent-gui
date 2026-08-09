import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const appMocks = vi.hoisted(() => ({ ListWorkspaceDir: vi.fn(), SearchWorkspaceContent: vi.fn() }))
vi.mock('../../../wailsjs/go/main/App', () => appMocks)

import { FileTree } from './FileTree'
import { useWorkspaceStore } from '../../stores/workspaceStore'

beforeEach(() => {
  useWorkspaceStore.getState().reset()
  appMocks.ListWorkspaceDir.mockReset()
  appMocks.SearchWorkspaceContent.mockReset()
})

it('loads top level on mount when root set and empty', async () => {
  useWorkspaceStore.getState().setRoot('/w')
  appMocks.ListWorkspaceDir.mockResolvedValue([
    { name: 'a.ts', isDir: false, size: 3 }, { name: 'sub', isDir: true, size: 0 },
  ])
  render(<FileTree />)
  await waitFor(() => expect(screen.getByText('a.ts')).toBeInTheDocument())
  expect(screen.getByText('sub')).toBeInTheDocument()
})

it('selecting a file updates the store', async () => {
  useWorkspaceStore.getState().setRoot('/w')
  useWorkspaceStore.getState().setRoots([{ entry: { name: 'a.ts', isDir: false, size: 3 }, subPath: 'a.ts', children: null }])
  render(<FileTree />)
  fireEvent.click(screen.getByText('a.ts'))
  expect(useWorkspaceStore.getState().selected).toBe('a.ts')
})

it('filter hides non-matching loaded nodes', () => {
  useWorkspaceStore.getState().setRoot('/w')
  useWorkspaceStore.getState().setRoots([
    { entry: { name: 'alpha.ts', isDir: false, size: 1 }, subPath: 'alpha.ts', children: null },
    { entry: { name: 'beta.ts', isDir: false, size: 1 }, subPath: 'beta.ts', children: null },
  ])
  render(<FileTree />)
  fireEvent.change(screen.getByPlaceholderText(/过滤/i), { target: { value: 'alpha' } })
  expect(screen.getByText('alpha.ts')).toBeInTheDocument()
  expect(screen.queryByText('beta.ts')).toBeNull()
})

it('? prefix triggers content search', async () => {
  useWorkspaceStore.getState().setRoot('/w')
  appMocks.SearchWorkspaceContent.mockResolvedValue([{ path: '/w/a.ts', line: 2, snippet: 'hit' }])
  render(<FileTree />)
  fireEvent.change(screen.getByPlaceholderText(/过滤/i), { target: { value: '?hit' } })
  await waitFor(() => expect(appMocks.SearchWorkspaceContent).toHaveBeenCalledWith('/w', 'hit'))
})
