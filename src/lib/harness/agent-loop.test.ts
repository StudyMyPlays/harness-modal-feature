import { describe, expect, it, vi } from 'vitest'
import { collect } from '@/test/streams'
import { runAgentLoop } from './agent-loop'
import { LlmError, type LlmAdapter, type LlmEvent, type LlmRequest } from './llm/types'
import type { HarnessEvent } from './protocol'
import { createToolRegistry, type HarnessTool } from './tools/registry'

type Step = LlmEvent[] | LlmError

/** Adapter whose nth call plays the nth step; records every request. */
function scripted(steps: Step[]) {
  const requests: LlmRequest[] = []
  const adapter: LlmAdapter = {
    async *stream(req) {
      requests.push(structuredClone({ ...req, signal: undefined }) as unknown as LlmRequest)
      const step = steps[requests.length - 1] ?? steps.at(-1)!
      if (step instanceof LlmError) throw step
      for (const e of step) yield e
    },
  }
  return { adapter, requests }
}

const usage = (i: number, o: number): LlmEvent => ({
  type: 'usage',
  usage: { inputTokens: i, outputTokens: o, cachedInputTokens: 0 },
})

const textStep = (text: string): LlmEvent[] => [
  { type: 'text-delta', text },
  usage(10, 2),
  { type: 'finish', reason: 'stop' },
]

const toolStep = (id: string, name = 'echo', args = '{"v":1}'): LlmEvent[] => [
  { type: 'text-delta', text: 'Checking.' },
  { type: 'tool-calls', calls: [{ id, type: 'function', function: { name, arguments: args } }] },
  usage(5, 1),
  { type: 'finish', reason: 'tool_calls' },
]

const echo: HarnessTool = {
  spec: { name: 'echo', description: 'echo', parameters: { type: 'object' } },
  execute: async (args) => `echo ${JSON.stringify(args)}`,
}

function run(adapter: LlmAdapter, over: Partial<Parameters<typeof runAgentLoop>[0]> = {}) {
  return collect(
    runAgentLoop({
      adapter,
      request: {
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        webSearch: 'off',
        includeVeniceSystemPrompt: false,
      },
      tools: createToolRegistry([echo]),
      signal: new AbortController().signal,
      deadline: Date.now() + 60_000,
      ...over,
    }),
  )
}

const types = (events: HarnessEvent[]) => events.map((e) => e.type)

describe('runAgentLoop', () => {
  it('single step text turn', async () => {
    const { adapter } = scripted([textStep('Hello')])
    const events = await run(adapter)
    expect(types(events)).toEqual(['step-start', 'text-delta', 'step-end', 'usage', 'done'])
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'stop' })
  })

  it('passes tool specs and a per-step timeout to the adapter', async () => {
    const { adapter, requests } = scripted([textStep('x')])
    await run(adapter)
    expect(requests[0].tools).toEqual([echo.spec])
    expect(requests[0].timeoutMs).toBeGreaterThan(0)
    expect(requests[0].timeoutMs).toBeLessThanOrEqual(120_000)
  })

  it('tool round trip', async () => {
    const { adapter, requests } = scripted([toolStep('c1'), textStep('Done')])
    const events = await run(adapter)
    expect(types(events)).toEqual([
      'step-start',
      'text-delta',
      'tool-call',
      'tool-result',
      'step-end',
      'step-start',
      'text-delta',
      'step-end',
      'usage',
      'done',
    ])
    expect(events[2]).toEqual({ type: 'tool-call', id: 'c1', name: 'echo', args: '{"v":1}' })
    expect(events[3]).toEqual({
      type: 'tool-result',
      id: 'c1',
      result: { ok: true, content: 'echo {"v":1}', truncated: false },
    })
    expect(requests[1].messages.slice(-2)).toEqual([
      {
        role: 'assistant',
        content: 'Checking.',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'echo', arguments: '{"v":1}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'echo {"v":1}' },
    ])
  })

  it('a failing tool is reported to the model and the turn continues', async () => {
    const { adapter, requests } = scripted([toolStep('c1', 'ghost'), textStep('Sorry')])
    const events = await run(adapter)
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'stop' })
    expect(requests[1].messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'Unknown tool: ghost' })
  })

  it('stops at maxSteps with done max-steps', async () => {
    const { adapter, requests } = scripted([toolStep('c1')])
    const events = await run(adapter, { maxSteps: 3 })
    expect(requests).toHaveLength(3)
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'max-steps' })
  })

  it('aborted signal ends with done aborted', async () => {
    const ctrl = new AbortController()
    const adapter: LlmAdapter = {
      async *stream(req) {
        yield { type: 'text-delta', text: 'a' }
        ctrl.abort()
        if (req.signal.aborted) throw new LlmError('aborted')
      },
    }
    const events = await run(adapter, { signal: ctrl.signal })
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'aborted' })
    expect(types(events)).not.toContain('error')
  })

  it('LlmError 401 becomes error 502 with friendly message', async () => {
    const { adapter } = scripted([new LlmError('upstream', 401)])
    const events = await run(adapter)
    expect(events.at(-1)).toEqual({
      type: 'error',
      message: 'The chat could not authenticate with the model provider.',
      status: 502,
    })
  })

  it('timeout and empty errors get their own messages', async () => {
    expect((await run(scripted([new LlmError('timeout')]).adapter)).at(-1)).toEqual({
      type: 'error',
      message: 'The model provider took too long to answer. Try again.',
      status: 504,
    })
    expect((await run(scripted([new LlmError('empty')]).adapter)).at(-1)).toEqual({
      type: 'error',
      message: 'The model returned an empty response. Try again.',
      status: 502,
    })
  })

  it('a non-LlmError is reported as a generic 502, not thrown', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const adapter: LlmAdapter = {
      async *stream() {
        throw new Error('bug')
      },
    }
    expect((await run(adapter)).at(-1)).toEqual({
      type: 'error',
      message: 'The chat could not reach the model provider. Try again.',
      status: 502,
    })
  })

  it('usage is summed across steps and costed', async () => {
    const { adapter } = scripted([toolStep('c1'), textStep('ok')])
    const events = await run(adapter, { pricing: { inputUsd: 1, outputUsd: 2, cachedInputUsd: 0.5 } })
    const u = events.filter((e) => e.type === 'usage')
    expect(u).toEqual([
      {
        type: 'usage',
        usage: { inputTokens: 15, outputTokens: 3, cachedInputTokens: 0 },
        costUsd: (15 * 1 + 3 * 2) / 1e6,
      },
    ])
  })

  it('usage cost is null without pricing', async () => {
    const events = await run(scripted([textStep('x')]).adapter)
    expect(events.find((e) => e.type === 'usage')).toMatchObject({ costUsd: null })
  })

  it('beforeStep false ends with 503 error before calling adapter', async () => {
    const { adapter, requests } = scripted([textStep('x')])
    const events = await run(adapter, { beforeStep: () => false })
    expect(requests).toHaveLength(0)
    expect(events).toEqual([
      { type: 'error', message: 'The harness is at capacity for today. Try again tomorrow.', status: 503 },
    ])
  })

  it('ends with done length when the deadline is too close for another step', async () => {
    const { adapter, requests } = scripted([toolStep('c1'), textStep('never')])
    let now = 0
    const events = await run(adapter, {
      deadline: 5000,
      now: () => {
        const t = now
        now += 4500
        return t
      },
    })
    expect(requests).toHaveLength(1)
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'length' })
  })

  it('re-emits citations and meta', async () => {
    const { adapter } = scripted([
      [
        { type: 'meta', balanceUsd: 4 },
        { type: 'citations', citations: [{ title: 'A', url: 'https://a.example' }] },
        ...textStep('x'),
      ],
    ])
    const events = await run(adapter)
    expect(types(events)).toEqual(['step-start', 'meta', 'citations', 'text-delta', 'step-end', 'usage', 'done'])
  })
})
