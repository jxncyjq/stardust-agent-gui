import { describe, it, expect } from 'vitest'
import {
  SLASH_COMMANDS,
  isSlashInput,
  filterSlashCommands,
  parseSlashCommand,
} from './slashCommands'

describe('isSlashInput', () => {
  it('detects a leading slash, tolerating leading whitespace', () => {
    expect(isSlashInput('/send')).toBe(true)
    expect(isSlashInput('   /tasks')).toBe(true)
  })

  it('rejects normal text and empty input', () => {
    expect(isSlashInput('hello')).toBe(false)
    expect(isSlashInput('')).toBe(false)
    expect(isSlashInput('a/b')).toBe(false)
  })
})

describe('filterSlashCommands', () => {
  it('returns every command for a bare slash', () => {
    expect(filterSlashCommands('/')).toHaveLength(SLASH_COMMANDS.length)
  })

  it('prefix-matches the first token case-insensitively', () => {
    // "/se" is a prefix of both "/send" and "/sessions".
    const names = filterSlashCommands('/se').map((c) => c.name)
    expect(names).toEqual(['/send', '/sessions'])
    expect(filterSlashCommands('/sw').map((c) => c.name)).toEqual(['/switch'])
    expect(filterSlashCommands('/S').map((c) => c.name)).toContain('/sessions')
  })

  it('returns nothing for non-slash input', () => {
    expect(filterSlashCommands('hello')).toEqual([])
  })
})

describe('parseSlashCommand', () => {
  it('passes through non-command input as an empty name', () => {
    expect(parseSlashCommand('just a message')).toEqual({ name: '', args: [], rest: '' })
    expect(parseSlashCommand('/unknown thing')).toEqual({ name: '', args: [], rest: '' })
  })

  it('parses an argument-less command', () => {
    expect(parseSlashCommand('/tasks')).toEqual({ name: '/tasks', args: [], rest: '' })
    expect(parseSlashCommand('  /inbox  ')).toEqual({ name: '/inbox', args: [], rest: '' })
  })

  it('matches the command token exactly, not by prefix', () => {
    // "/session" is not a command; only "/sessions" and "/switch" exist.
    expect(parseSlashCommand('/session').name).toBe('')
    expect(parseSlashCommand('/sessions').name).toBe('/sessions')
  })

  it('splits arguments and preserves the free-form remainder', () => {
    const send = parseSlashCommand('/send writer 你好 世界')
    expect(send.name).toBe('/send')
    expect(send.args).toEqual(['writer', '你好', '世界'])
    // rest is the whole argument string after the command token.
    expect(send.rest).toBe('writer 你好 世界')
  })

  it('keeps the handoff summary intact in rest', () => {
    const ho = parseSlashCommand('/handoff writer TASK-1 请接手缓存调研')
    expect(ho.name).toBe('/handoff')
    expect(ho.args[0]).toBe('writer')
    expect(ho.args[1]).toBe('TASK-1')
    expect(ho.rest).toBe('writer TASK-1 请接手缓存调研')
  })

  it('is case-insensitive on the command token', () => {
    expect(parseSlashCommand('/TASKS').name).toBe('/tasks')
  })
})
