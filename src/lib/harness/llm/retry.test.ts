import { describe, expect, it, vi } from 'vitest'
import { collect } from '@/test/streams'
import { withRetry } from './retry'
import { LlmError, type LlmAdapter, type LlmEvent, type LlmRequest } from './types'

const request = {} as LlmRequest
const ok: LlmEvent[] = [
  { type: 'text-delta', text: 'hi' },
  { type: 'finish', reason: 'stop' },
]

/** An adapter whose nth call runs the nth script: an error to throw, or events then an optional error. */
function scripted(scripts: Array<{ events?: LlmEvent[]; error?: LlmError }>) {
  const calls = vi.fn()
  const adapter: LlmAdapter = {
    async *stream() {
      const script = scripts[calls.mock.calls.length] ?? scripts.at(-1)!
      calls()
      for (const e of script.events ?? []) yield e
      if (script.error) throw script.error
    },
  }
  return { adapter, calls }
}

const noSleep = { sleep: async () => {} }

describe('withRetry', () => {
  it('retries a 429 thrown before the first event', async () => {
    const { adapter, calls } = scripted([{ error: new LlmError('upstream', 429) }, { events: ok }])
    expect(await collect(withRetry(adapter, noSleep).stream(request))).toEqual(ok)
    expect(calls).toHaveBeenCalledTimes(2)
  })

  it('does not retry after an event was yielded', async () => {
    const { adapter, calls } = scripted([
      { events: [ok[0]], error: new LlmError('upstream', 503) },
      { events: ok },
    ])
    await expect(collect(withRetry(adapter, noSleep).stream(request))).rejects.toMatchObject({ status: 503 })
    expect(calls).toHaveBeenCalledTimes(1)
  })

  it('does not retry 400 or aborted', async () => {
    for (const error of [new LlmError('upstream', 400), new LlmError('aborted')]) {
      const { adapter, calls } = scripted([{ error }, { events: ok }])
      await expect(collect(withRetry(adapter, noSleep).stream(request))).rejects.toBe(error)
      expect(calls).toHaveBeenCalledTimes(1)
    }
  })

  it('gives up after retries and rethrows the last error', async () => {
    const last = new LlmError('upstream', 502)
    const { adapter, calls } = scripted([
      { error: new LlmError('upstream', 500) },
      { error: new LlmError('transport') },
      { error: last },
    ])
    await expect(collect(withRetry(adapter, noSleep).stream(request))).rejects.toBe(last)
    expect(calls).toHaveBeenCalledTimes(3)
  })

  it('backs off 500ms then 1000ms by default', async () => {
    const sleep = vi.fn(async () => {})
    const { adapter } = scripted([
      { error: new LlmError('upstream', 500) },
      { error: new LlmError('upstream', 500) },
      { events: ok },
    ])
    await collect(withRetry(adapter, { sleep }).stream(request))
    expect(sleep.mock.calls).toEqual([[500], [1000]])
  })
})
