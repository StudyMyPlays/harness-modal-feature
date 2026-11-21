import { parseSse } from './llm/sse'
import type { Citation, FinishReason, Usage } from './llm/types'
import type { ToolResult } from './tools/registry'

/**
 * What `/api/chat` streams to the browser: our own typed events, never the
 * provider's raw chunks, so the client is independent of the adapter and no
 * upstream detail can leak through.
 */
export type TurnFinish = FinishReason | 'max-steps' | 'aborted'

export type HarnessEvent =
  | { type: 'step-start'; step: number }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'text-delta'; text: string }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'tool-call'; id: string; name: string; args: string }
  | { type: 'tool-result'; id: string; result: ToolResult }
  | { type: 'usage'; usage: Usage; costUsd: number | null }
  | { type: 'meta'; balanceUsd: number | null }
  | { type: 'step-end'; step: number; finishReason: FinishReason }
  | { type: 'done'; finishReason: TurnFinish }
  | { type: 'error'; message: string; status: number }

const KNOWN = new Set<HarnessEvent['type']>([
  'step-start',
  'reasoning-delta',
  'text-delta',
  'citations',
  'tool-call',
  'tool-result',
  'usage',
  'meta',
  'step-end',
  'done',
  'error',
])

const encoder = new TextEncoder()

export function encodeEvent(e: HarnessEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(e)}\n\n`)
}

export function eventsToResponse(events: AsyncIterable<HarnessEvent>): Response {
  const iterator = events[Symbol.asyncIterator]()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await iterator.next()
        if (done) controller.close()
        else controller.enqueue(encodeEvent(value))
      } catch (err) {
        console.error('Harness stream failed:', err)
        controller.enqueue(
          encodeEvent({ type: 'error', message: 'The stream ended unexpectedly.', status: 502 }),
        )
        controller.close()
      }
    },
    async cancel() {
      await iterator.return?.()
    },
  })
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  })
}

export async function* readHarnessStream(res: Response): AsyncIterable<HarnessEvent> {
  if (!res.body) return
  for await (const payload of parseSse(res.body)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      continue
    }
    if (parsed && typeof parsed === 'object' && KNOWN.has((parsed as HarnessEvent).type)) {
      yield parsed as HarnessEvent
    }
  }
}
