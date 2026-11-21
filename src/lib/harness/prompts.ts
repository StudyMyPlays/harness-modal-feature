import type { WebSearchMode } from './llm/types'

/**
 * The short note the harness adds after the user's own system prompt
 * (DeepSeek Harness's `system-prompt` + `time-context`).
 */
export function harnessPreamble(opts: { now: Date; webSearch: WebSearchMode; toolNames: string[] }): string {
  const lines = [`Today's date is ${opts.now.toISOString().slice(0, 10)}.`]
  if (opts.webSearch !== 'off') {
    lines.push('Web search is enabled for this conversation; cite sources when you use them.')
  }
  if (opts.toolNames.length) {
    lines.push(`You can call these tools when they help: ${opts.toolNames.join(', ')}.`)
  }
  return lines.join('\n')
}
