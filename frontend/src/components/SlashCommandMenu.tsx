import { useEffect, useRef } from 'react'
import { cn } from '../lib/utils'
import type { SlashCommand } from '../lib/slashCommands'

interface Props {
  // commands is the already-filtered list to display; the menu hides itself
  // when it is empty.
  commands: SlashCommand[]
  // activeIndex is the highlighted row, owned by the parent so keyboard
  // navigation in the textarea stays in sync with mouse hover.
  activeIndex: number
  // onSelect fires when a row is clicked or otherwise chosen.
  onSelect: (command: SlashCommand) => void
  // onHover updates the parent's active index when the pointer moves.
  onHover: (index: number) => void
}

// SlashCommandMenu renders the command palette dropdown above the chat input.
// It mirrors the TUI's interactiveCommands list: command name, an argument hint,
// and a description. Selection and filtering are driven by the parent so the
// textarea's key handling remains the single place that interprets ↑/↓/Enter/Tab.
export function SlashCommandMenu({ commands, activeIndex, onSelect, onHover }: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the highlighted row visible when navigating with the keyboard.
  useEffect(() => {
    const container = listRef.current
    if (!container) return
    const active = container.children[activeIndex] as HTMLElement | undefined
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (commands.length === 0) return null

  return (
    <div
      ref={listRef}
      className="mb-2 max-h-56 overflow-y-auto rounded-md border border-border bg-background shadow-md"
      role="listbox"
    >
      {commands.map((cmd, index) => (
        <button
          key={cmd.name}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={cn(
            'interactive flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs',
            index === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
          )}
          // onMouseDown (not onClick) so the textarea does not lose focus and
          // fire blur before the selection is applied.
          onMouseDown={(e) => {
            e.preventDefault()
            onSelect(cmd)
          }}
          onMouseEnter={() => onHover(index)}
        >
          <span className="font-mono font-semibold text-foreground">{cmd.name}</span>
          {cmd.argHint && <span className="font-mono text-muted-foreground">{cmd.argHint}</span>}
          <span className="ml-auto truncate text-muted-foreground">{cmd.description}</span>
        </button>
      ))}
    </div>
  )
}
