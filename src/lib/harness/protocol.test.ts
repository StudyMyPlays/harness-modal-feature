import { describe, expect, it } from 'vitest'
import { collect, sseResponse } from '@/test/streams'
import { encodeEvent, eventsToResponse, readHarnessStream, type HarnessEvent } from './protocol'

const all: HarnessEvent[] = [
  { type: 'meta', balanceUsd: 3.2 },
  { type: 'step-start', step: 1 },
  { type: 'reasoning-delta', text: 'hmm' },
  { type: 'text-delta', text: 'Hi ' },
  { type: 'citations', citations: [{ title: 'A', url: 'https://a.example' }] },
  { type: 'tool-call', id: 'c1', name: 'mcp__docs__search', args: '{"q":"x"}' },
  { type: 'tool-result', id: 'c1', result: { ok: true, content: 'found', truncated: false } },
  { type: 'step-end', step: 1, finishReason: 'tool_calls' },
  { type: 'usage', usage: { inputTokens: 10, outputTokens: 2, cachedInputTokens: 0 }, costUsd: 0.0001 },
  { type: 'done', finishReason: 'max-steps' },
  { type: 'error', message: 'nope', status: 502 },
]

async function* from<T>(items: T[]) {
  for (const i of items) yield i
}

describe('protocol', () => {
  it('round-trips every event type through eventsToResponse and readHarnessStream', async () => {
    const res = eventsToResponse(from(all))
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform')
    expect(res.headers.get('x-accel-buffering')).toBe('no')
    expect(await collect(readHarnessStream(res))).toEqual(all)
  })

  it('encodes one SSE data event per harness event', () => {
    expect(new TextDecoder().decode(encodeEvent({ type: 'text-delta', text: 'a' }))).toBe(
      'data: {"type":"text-delta","text":"a"}\n\n',
    )
  })

  it('ignores unknown event types', async () => {
    const res = sseResponse([{ type: 'mystery' }, { type: 'text-delta', text: 'x' }, 'junk'])
    expect(await collect(readHarnessStream(res))).toEqual([{ type: 'text-delta', text: 'x' }])
  })

  it('an iterator that throws mid-stream ends with an error event, not a broken stream', async () => {
    async function* broken(): AsyncIterable<HarnessEvent> {
      yield { type: 'text-delta', text: 'partial' }
      throw new Error('kaboom')
    }
    const events = await collect(readHarnessStream(eventsToResponse(broken())))
    expect(events).toEqual([
      { type: 'text-delta', text: 'partial' },
      { type: 'error', message: 'The stream ended unexpectedly.', status: 502 },
    ])
  })

  it('cancelling the response stops the source iterator', async () => {
    let finished = false
    async function* endless(): AsyncIterable<HarnessEvent> {
      try {
        for (;;) {
          yield { type: 'text-delta', text: 'x' }
          await new Promise((r) => setTimeout(r, 1))
        }
      } finally {
        finished = true
      }
    }
    const res = eventsToResponse(endless())
    const reader = res.body!.getReader()
    await reader.read()
    await reader.cancel()
    await new Promise((r) => setTimeout(r, 10))
    expect(finished).toBe(true)
  })
})
