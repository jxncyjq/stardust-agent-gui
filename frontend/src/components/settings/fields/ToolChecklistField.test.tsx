import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({ ListGateableTools: vi.fn() }))
vi.mock('../../../../wailsjs/go/main/App', () => mocks)

import { ToolChecklistField } from './ToolChecklistField'

beforeEach(() => {
  mocks.ListGateableTools.mockReset()
  mocks.ListGateableTools.mockResolvedValue([
    { name: 'read_file', description: '读文件' },
    { name: 'write_file', description: '写文件' },
  ])
})

// Deny-list semantics: every gateable tool renders, and a tool is checked unless
// it is in the disabled_tools value.
it('renders every gateable tool, checked unless disabled', async () => {
  render(<ToolChecklistField value={['write_file']} onChange={() => {}} />)

  const read = await screen.findByRole('checkbox', { name: /read_file/ })
  const write = await screen.findByRole('checkbox', { name: /write_file/ })
  expect(read).toBeChecked()        // not disabled → allowed
  expect(write).not.toBeChecked()   // in disabled_tools → unchecked
})

// Unchecking a tool adds it to disabled_tools.
it('unchecking a tool adds it to disabled_tools', async () => {
  const onChange = vi.fn()
  render(<ToolChecklistField value={[]} onChange={onChange} />)

  const read = await screen.findByRole('checkbox', { name: /read_file/ })
  await userEvent.click(read)

  expect(onChange).toHaveBeenCalledWith(['read_file'])
})

// Re-checking a disabled tool removes it from disabled_tools.
it('checking a disabled tool removes it from disabled_tools', async () => {
  const onChange = vi.fn()
  render(<ToolChecklistField value={['read_file']} onChange={onChange} />)

  const read = await screen.findByRole('checkbox', { name: /read_file/ })
  await userEvent.click(read)

  expect(onChange).toHaveBeenCalledWith([])
})

// undefined value = empty deny-list = all checked.
it('treats an undefined value as all-allowed', async () => {
  render(<ToolChecklistField value={undefined as unknown as string[]} onChange={() => {}} />)

  const write = await screen.findByRole('checkbox', { name: /write_file/ })
  expect(write).toBeChecked()
})

// Fail-loud: a load failure shows an error, never an empty list masquerading as
// "no tools" (which would let the user think nothing is gateable).
it('shows an error when loading the tool list fails', async () => {
  mocks.ListGateableTools.mockRejectedValue(new Error('boom'))
  render(<ToolChecklistField value={[]} onChange={() => {}} />)

  await waitFor(() => expect(screen.getByText(/加载.*失败/)).toBeInTheDocument())
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
})
