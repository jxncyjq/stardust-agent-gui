interface Props {
  elapsedSec: number
  totalTokens?: number
}

/**
 * ExecutionStatus renders the running indicator shown above the chat input
 * while a task is in flight: a blinking star, the wall-clock seconds elapsed
 * since submission, and (once known) the token count — e.g. "✳ 12s · 561 tokens".
 * Its values are per-session, so switching sessions shows that session's own run.
 */
export function ExecutionStatus({ elapsedSec, totalTokens = 0 }: Props) {
  return (
    <div className="flex items-center gap-1.5 px-1 pb-1.5 text-xs text-muted-foreground">
      <span className="legion-blink text-primary">✳</span>
      <span>{elapsedSec}s</span>
      {totalTokens > 0 && <span>· {totalTokens} tokens</span>}
    </div>
  )
}
