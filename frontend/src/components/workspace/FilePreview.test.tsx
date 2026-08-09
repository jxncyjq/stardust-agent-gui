import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const appMocks = vi.hoisted(() => ({ ReadWorkspaceFile: vi.fn(), OpenInEditor: vi.fn(), RevealInExplorer: vi.fn() }))
vi.mock('../../../wailsjs/go/main/App', () => appMocks)

import { FilePreview } from './FilePreview'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { setEditorTemplate } from '../../lib/editorTemplate'

beforeEach(() => {
  useWorkspaceStore.getState().reset()
  useWorkspaceStore.getState().setRoot('/w')
  localStorage.clear()
  Object.values(appMocks).forEach((m) => m.mockReset())
})

it('shows empty state with no selection', () => {
  render(<FilePreview />)
  expect(screen.getByText(/未选择|选择文件/)).toBeInTheDocument()
})

it('reads and renders the selected markdown file', async () => {
  appMocks.ReadWorkspaceFile.mockResolvedValue({ kind: 'markdown', text: '---\nid: x1\n---\n# 标题', dataURI: '', lang: '' })
  render(<FilePreview />)
  useWorkspaceStore.getState().select('d.md')
  await waitFor(() => expect(screen.getByText('id')).toBeInTheDocument())
  expect(screen.getByRole('heading', { name: '标题' })).toBeInTheDocument()
})

it('open-in-editor disabled without a template', async () => {
  appMocks.ReadWorkspaceFile.mockResolvedValue({ kind: 'code', text: 'x', dataURI: '', lang: 'text' })
  render(<FilePreview />)
  useWorkspaceStore.getState().select('a.txt')
  await waitFor(() => expect(screen.getByRole('button', { name: '用编辑器打开' })).toBeDisabled())
})

it('open-in-editor calls OpenInEditor with template + abs path', async () => {
  setEditorTemplate('code "{path}"')
  appMocks.ReadWorkspaceFile.mockResolvedValue({ kind: 'code', text: 'x', dataURI: '', lang: 'text' })
  appMocks.OpenInEditor.mockResolvedValue(undefined)
  render(<FilePreview />)
  useWorkspaceStore.getState().select('a.txt')
  await waitFor(() => screen.getByRole('button', { name: '用编辑器打开' }))
  fireEvent.click(screen.getByRole('button', { name: '用编辑器打开' }))
  await waitFor(() => expect(appMocks.OpenInEditor).toHaveBeenCalledWith('code "{path}"', expect.stringContaining('a.txt')))
})
