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

it('export calls SaveGeneratedFile', () => {
  render(<FileCard file={docx} />)
  fireEvent.click(screen.getByRole('button', { name: '导出' }))
  expect(appMocks.SaveGeneratedFile).toHaveBeenCalledWith('F:/w', 'r.docx')
})

// The loopback URL stopped being copyable the moment the embedded serve began
// requiring a bearer token: pasted into a browser it is a 401, and putting the
// token on the clipboard would hand the whole agent to whatever reads it next.
// Taking the file out is what the user wanted; that is 导出.
it('offers no copy-link for a loopback url, since that link now 401s outside the app', () => {
  render(<FileCard file={html} />)
  expect(screen.queryByRole('button', { name: '复制链接' })).toBeNull()
  expect(screen.getByRole('button', { name: '导出' })).toBeInTheDocument()
})

// A deployment that configured server.file_base_url published that address on
// purpose and carries its own auth. Copying it is still the right answer, and
// it is copied verbatim -- no loopback base to resolve against.
it('keeps copy-link for a published absolute url and copies it verbatim', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  const published = { ...html, url: 'https://agent.example.com/v1/files?x' }
  render(<FileCard file={published} />)
  fireEvent.click(screen.getByRole('button', { name: '复制链接' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://agent.example.com/v1/files?x'))
  expect(appMocks.GetBrowserEndpoint).not.toHaveBeenCalled()
})
