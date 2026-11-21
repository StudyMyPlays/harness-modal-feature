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

export const TITLE_PROMPT = 'Write a title of at most 6 words for this conversation. Reply with the title only.'

export const COMPACT_PROMPT =
  'Summarise the conversation so far for another assistant who will continue it. Keep: the user’s goals and preferences, decisions made, facts and numbers given, code or text the user will refer back to, and open questions. Use short headed sections. Do not add anything that was not said.'

const MAX_TITLE_WORDS = 6
const MAX_TITLE_CHARS = 60

/** A model's title reply cleaned up for the sidebar, or null if nothing is left. */
export function sanitizeTitle(raw: string): string | null {
  let t = raw.replace(/\s+/g, ' ').trim()
  t = t.replace(/^title\s*:\s*/i, '')
  t = t.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').trim()
  t = t.replace(/[.。]+$/, '').trim()
  t = t.split(' ').filter(Boolean).slice(0, MAX_TITLE_WORDS).join(' ')
  if (t.length > MAX_TITLE_CHARS) t = t.slice(0, MAX_TITLE_CHARS).trim()
  return t || null
}
