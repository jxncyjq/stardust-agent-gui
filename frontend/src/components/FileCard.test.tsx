import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const appMocks = vi.hoisted(() => ({ OpenPath: vi.fn(), SaveGeneratedFile: vi.fn(), GetBrowserEndpoint: vi.fn() }))
vi.mock('../../wailsjs/go/main/App', () => appMocks)
const previewMock = vi.hoisted(() => ({ fetchPreview: vi.fn() }))
vi.mock('../lib/fetchPreview', () => previewMock)

import { FileCard } from './FileCard'
import { usePreviewStore } from '../stores/previewStore'
import { useSessionStore } from '../stores/sessionStore'

beforeEach(() => {
  Object.values(appMocks).forEach((m) => m.mockReset())
  previewMock.fetchPreview.mockReset()
  usePreviewStore.getState().close()
  useSessionStore.setState({ currentSessionId: 's1', sessions: [{ id: 's1', project: 'p', title: 't', archived: false, updatedAt: '', workingDir: 'F:/w' }] })
})

const html = { path: 'a.html', url: '/v1/files?x', downloadUrl: '/v1/files?x&download=1', name: 'a.html' }
const docx = { path: 'r.docx', url: '/v1/files?d', downloadUrl: '/v1/files?d&download=1', name: 'r.docx' }

it('shows name + preview action for previewable', () => {
  render(<FileCard file={html} />)
  expect(screen.getByText('a.html')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '预览' })).toBeInTheDocument()
})

it('hides preview for office', () => {
  render(<FileCard file={docx} />)
  expect(screen.queryByRole('button', { name: '预览' })).toBeNull()
})

it('preview opens PreviewContent via fetchPreview', async () => {
  previewMock.fetchPreview.mockResolvedValue({ kind: 'html', html: '<h1>h</h1>', title: 'a.html' })
  render(<FileCard file={html} />)
  fireEvent.click(screen.getByRole('button', { name: '预览' }))
  await waitFor(() => expect(usePreviewStore.getState().source?.kind).toBe('html'))
})

it('open-external calls OpenPath with workingDir + path', () => {
  render(<FileCard file={docx} />)
  fireEvent.click(screen.getByRole('button', { name: '外部打开' }))
  expect(appMocks.OpenPath).toHaveBeenCalledWith('F:/w', 'r.docx')
})

it('download calls SaveGeneratedFile', () => {
  render(<FileCard file={docx} />)
  fireEvent.click(screen.getByRole('button', { name: '下载' }))
  expect(appMocks.SaveGeneratedFile).toHaveBeenCalledWith('F:/w', 'r.docx')
})

it('copy link writes url to clipboard', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  render(<FileCard file={html} />)
  fireEvent.click(screen.getByRole('button', { name: '复制链接' }))
  expect(writeText).toHaveBeenCalledWith('/v1/files?x')
})
