import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ProfilesEditor } from './ProfilesEditor'

// Editing context_length must produce a number, not the string the <input> gives us.
// ProfilesEditor is a controlled component (value prop doesn't change across
// keystrokes in this test), so we fire a single change event rather than
// userEvent.type, which would type into a value the parent never updates.
it('editing context_length calls onChange with a number', () => {
  const onChange = vi.fn()
  render(
    <ProfilesEditor
      value={{ default: { model: 'gpt-5', base_url: '', api_key: '' } }}
      onChange={onChange}
    />
  )

  const input = screen.getByPlaceholderText('上下文 token 数，如 128000')
  fireEvent.change(input, { target: { value: '128000' } })

  const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
  expect(lastCall.default.context_length).toBe(128000)
  expect(typeof lastCall.default.context_length).toBe('number')
})

// Fail-loud semantics: clearing the field must store undefined ("unset"), not 0 —
// 0 would be a false context length shown in the badge instead of "context 未设".
it('clearing context_length stores undefined, not 0', async () => {
  const onChange = vi.fn()
  render(
    <ProfilesEditor
      value={{ default: { model: 'gpt-5', base_url: '', api_key: '', context_length: 128000 } }}
      onChange={onChange}
    />
  )

  const input = screen.getByPlaceholderText('上下文 token 数，如 128000') as HTMLInputElement
  await userEvent.clear(input)

  const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
  expect(lastCall.default.context_length).toBeUndefined()
})

// The input reflects the stored value, and an unset profile shows an empty field
// (not "0").
it('renders the stored context_length and leaves unset profiles blank', () => {
  render(
    <ProfilesEditor
      value={{
        withCtx: { model: 'a', context_length: 64000 },
        noCtx: { model: 'b' },
      }}
      onChange={() => {}}
    />
  )

  const inputs = screen.getAllByPlaceholderText('上下文 token 数，如 128000') as HTMLInputElement[]
  expect(inputs.map((i) => i.value)).toEqual(['64000', ''])
})
