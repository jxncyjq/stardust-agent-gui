// Slash command registry and parsing for the chat input. This mirrors the TUI's
// interactiveCommands (internal/tui/interactive.go) so the GUI exposes the same
// command palette. The parsing here is intentionally a set of pure functions so
// they can be unit tested without React or the Wails runtime.

// SlashCommand describes a single command shown in the palette: the leading
// token typed by the user (without arguments) and a human-readable description
// (with an argument hint where relevant).
export interface SlashCommand {
  // name is the canonical command token including the leading slash, e.g.
  // "/send". It never carries arguments.
  name: string
  // description is the palette label, matching the TUI wording.
  description: string
  // argHint, when present, documents the expected arguments for the command.
  argHint?: string
}

// SLASH_COMMANDS is the shared command list, ordered to match the TUI palette.
// Keeping it as a single source of truth means the menu and the executor agree
// on which commands exist.
export const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/history', description: '显示完整对话历史' },
  { name: '/audit', description: '显示审计动作' },
  { name: '/event', description: '显示事件流' },
  { name: '/tasks', description: '显示任务看板' },
  { name: '/task', description: '显示任务详情', argHint: '<task_id>' },
  { name: '/handoff', description: '交接任务', argHint: '<agent> <task_id> <summary>' },
  { name: '/send', description: '发送消息', argHint: '<agent> <message>' },
  { name: '/inbox', description: '显示未读消息' },
  { name: '/new', description: '创建新会话' },
  { name: '/sessions', description: '列出会话' },
  { name: '/switch', description: '切换会话', argHint: '<session_id>' },
  { name: '/clear-session', description: '清空当前会话' },
  { name: '/skill', description: '管理技能', argHint: 'install|update|uninstall <arg>' },
]

// ParsedSlashCommand is the result of parsing a single input line.
export interface ParsedSlashCommand {
  // name is the matched canonical command token (e.g. "/send"). Empty when the
  // input is not a recognized slash command.
  name: string
  // args holds the remaining whitespace-separated tokens after the command.
  args: string[]
  // rest is the raw argument string after the command token, trimmed. It is
  // useful for commands whose final argument is free-form text (e.g. /send and
  // /handoff carry a summary/message that may contain spaces).
  rest: string
}

// isSlashInput reports whether the (untrimmed) input should trigger the command
// palette: a line whose first non-space character is a slash.
export function isSlashInput(input: string): boolean {
  return input.trimStart().startsWith('/')
}

// filterSlashCommands returns the commands whose name is a case-insensitive
// prefix match for the typed token. The token is the first whitespace-delimited
// word of the input (including its leading slash). An input of just "/" matches
// every command. Non-slash input matches nothing.
export function filterSlashCommands(input: string): SlashCommand[] {
  const trimmed = input.trimStart()
  if (!trimmed.startsWith('/')) return []
  const token = trimmed.split(/\s+/)[0].toLowerCase()
  return SLASH_COMMANDS.filter((cmd) => cmd.name.toLowerCase().startsWith(token))
}

// parseSlashCommand parses an input line into a command name and its arguments.
// A line is a recognized command only when its first token exactly equals a
// known command name (case-insensitive); otherwise name is "" and the caller
// should treat the input as a normal message. The match is exact on the token
// so that "/sessions" is not mistaken for "/session" prefixes and vice versa.
export function parseSlashCommand(input: string): ParsedSlashCommand {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) {
    return { name: '', args: [], rest: '' }
  }
  const firstSpace = trimmed.search(/\s/)
  const token = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toLowerCase()
  const matched = SLASH_COMMANDS.find((cmd) => cmd.name.toLowerCase() === token)
  if (!matched) {
    return { name: '', args: [], rest: '' }
  }
  const rest = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim()
  const args = rest.length > 0 ? rest.split(/\s+/) : []
  return { name: matched.name, args, rest }
}
