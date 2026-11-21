import { costUsd, type ModelPricing } from './catalog'
import { LlmError, type FinishReason, type LlmAdapter, type LlmMessage, type LlmRequest, type LlmToolCall, type Usage } from './llm/types'
import { downstreamStatus, upstreamMessage } from './llm/venice'
import type { HarnessEvent } from './protocol'
import { executeToolCall, type ToolRegistry } from './tools/registry'

/**
 * The agent loop (DeepSeek Harness's `core/agent-loop`).
 *
 * A turn is up to `maxSteps` steps; a step is one model request plus the tool
 * calls it asked for. The loop is stateless: everything it needs arrives in
 * `request.messages`, and everything it learns leaves as events.
 */
export interface AgentLoopOptions {
  adapter: LlmAdapter
  request: Omit<LlmRequest, 'tools' | 'signal' | 'timeoutMs'>
  tools: ToolRegistry
  signal: AbortSignal
  /** Epoch ms by which the turn must have finished. */
  deadline: number
  maxSteps?: number
  stepTimeoutMs?: number
  pricing?: ModelPricing | null
  /** Called before every step; false stops the turn (the daily budget is spent). */
  beforeStep?: () => boolean
  now?: () => number
}

const MIN_STEP_MS = 1000

function errorEvent(err: unknown): HarnessEvent {
  if (err instanceof LlmError) {
    if (err.kind === 'timeout') {
      return { type: 'error', message: 'The model provider took too long to answer. Try again.', status: 504 }
    }
    if (err.kind === 'empty') {
      return { type: 'error', message: 'The model returned an empty response. Try again.', status: 502 }
    }
    if (err.kind === 'upstream' && err.status !== undefined) {
      return { type: 'error', message: upstreamMessage(err.status, 'The chat'), status: downstreamStatus(err.status) }
    }
  } else {
    console.error('Agent loop failed:', err)
  }
  return { type: 'error', message: 'The chat could not reach the model provider. Try again.', status: 502 }
}

export async function* runAgentLoop(opts: AgentLoopOptions): AsyncIterable<HarnessEvent> {
  const maxSteps = opts.maxSteps ?? 8
  const stepTimeoutMs = opts.stepTimeoutMs ?? 120_000
  const now = opts.now ?? Date.now
  const messages: LlmMessage[] = [...opts.request.messages]
  const total: Usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }
  let sawUsage = false

  function* usageEvent(): Generator<HarnessEvent> {
    if (!sawUsage) return
    yield { type: 'usage', usage: { ...total }, costUsd: opts.pricing ? costUsd(total, opts.pricing) : null }
  }

  for (let step = 1; step <= maxSteps; step++) {
    if (opts.signal.aborted) {
      yield* usageEvent()
      yield { type: 'done', finishReason: 'aborted' }
      return
    }
    const remaining = opts.deadline - now()
    if (remaining < MIN_STEP_MS) {
      yield* usageEvent()
      yield { type: 'done', finishReason: 'length' }
      return
    }
    if (opts.beforeStep && !opts.beforeStep()) {
      yield* usageEvent()
      yield { type: 'error', message: 'The harness is at capacity for today. Try again tomorrow.', status: 503 }
      return
    }

    yield { type: 'step-start', step }
    let text = ''
    let calls: LlmToolCall[] = []
    let finish: FinishReason = 'stop'
    try {
      for await (const e of opts.adapter.stream({
        ...opts.request,
        messages,
        tools: opts.tools.specs(),
        signal: opts.signal,
        timeoutMs: Math.min(stepTimeoutMs, remaining),
      })) {
        switch (e.type) {
          case 'text-delta':
            text += e.text
            yield e
            break
          case 'reasoning-delta':
          case 'citations':
          case 'meta':
            yield e
            break
          case 'tool-calls':
            calls = e.calls
            break
          case 'usage':
            sawUsage = true
            total.inputTokens += e.usage.inputTokens
            total.outputTokens += e.usage.outputTokens
            total.cachedInputTokens += e.usage.cachedInputTokens
            break
          case 'finish':
            finish = e.reason
            break
        }
      }
    } catch (err) {
      yield* usageEvent()
      if (opts.signal.aborted || (err instanceof LlmError && err.kind === 'aborted')) {
        yield { type: 'done', finishReason: 'aborted' }
      } else {
        yield errorEvent(err)
      }
      return
    }

    if (calls.length === 0) {
      yield { type: 'step-end', step, finishReason: finish }
      yield* usageEvent()
      yield { type: 'done', finishReason: finish }
      return
    }

    messages.push({ role: 'assistant', content: text || null, tool_calls: calls })
    for (const call of calls) {
      yield { type: 'tool-call', id: call.id, name: call.function.name, args: call.function.arguments }
      const result = await executeToolCall(opts.tools, call, { signal: opts.signal })
      yield { type: 'tool-result', id: call.id, result }
      messages.push({ role: 'tool', tool_call_id: call.id, content: result.content })
    }
    yield { type: 'step-end', step, finishReason: 'tool_calls' }
  }

  yield* usageEvent()
  yield { type: 'done', finishReason: 'max-steps' }
}
