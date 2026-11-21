import type { LlmAdapter, LlmRequest } from './types'

/** Run one call to completion and return its text (for titles and summaries). */
export async function completeText(adapter: LlmAdapter, req: LlmRequest): Promise<string> {
  let text = ''
  for await (const e of adapter.stream(req)) {
    if (e.type === 'text-delta') text += e.text
  }
  return text
}
