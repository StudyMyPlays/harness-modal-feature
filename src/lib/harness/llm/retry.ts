import { LlmError, type LlmAdapter, type LlmEvent, type LlmRequest } from './types'

/**
 * Retry a failed call (DeepSeek Harness's `llm-retry`), but only before
 * anything reached the caller: once a delta has been streamed, a retry would
 * duplicate text the user already saw.
 */
export function withRetry(
  adapter: LlmAdapter,
  opts: { retries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): LlmAdapter {
  const retries = opts.retries ?? 2
  const baseDelayMs = opts.baseDelayMs ?? 500
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  return {
    async *stream(req: LlmRequest): AsyncIterable<LlmEvent> {
      for (let attempt = 0; ; attempt++) {
        let yielded = false
        try {
          for await (const event of adapter.stream(req)) {
            // `meta` carries headers only: nothing the user has seen yet.
            if (event.type !== 'meta') yielded = true
            yield event
          }
          return
        } catch (err) {
          const canRetry =
            !yielded && attempt < retries && err instanceof LlmError && err.retryable && !req.signal?.aborted
          if (!canRetry) throw err
          await sleep(baseDelayMs * 2 ** attempt)
        }
      }
    },
  }
}
