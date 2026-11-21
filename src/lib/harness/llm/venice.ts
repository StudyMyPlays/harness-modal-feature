import { parseSse } from './sse'
import {
  LlmError,
  type Citation,
  type FinishReason,
  type LlmAdapter,
  type LlmEvent,
  type LlmRequest,
  type LlmToolCall,
} from './types'

/**
 * The Venice adapter (DeepSeek Harness's `llm-deepseek`, for Venice).
 *
 * Venice is OpenAI-compatible, plus `venice_parameters` (web search,
 * citations, its own system prompt), a separate `reasoning_content` delta,
 * and account balance in response headers.
 */
export const VENICE_BASE_URL = 'https://api.venice.ai/api/v1'

/**
 * Upstream failures are mapped to a small set of our own messages. The
 * provider's text routinely names account state ("insufficient balance", key
 * prefixes), and returning it verbatim would leak that to any caller.
 */
export function upstreamMessage(status: number, feature = 'The request'): string {
  if (status === 401 || status === 403) return `${feature} could not authenticate with the model provider.`
  if (status === 402) return `${feature} is temporarily unavailable. Please try again later.`
  if (status === 429) return `${feature} is busy right now. Try again in a moment.`
  if (status >= 500) return 'The model provider is having trouble. Try again in a moment.'
  return `${feature} could not process that request.`
}

/**
 * The status we answer with, which is not the status we received. A 401 from
 * Venice means *our* key is wrong; relaying it would tell the browser the
 * caller is unauthenticated. Anything that isn't the caller's fault is a 502.
 */
export function downstreamStatus(status: number): number {
  return status === 429 ? 429 : 502
}

export function buildVeniceBody(req: LlmRequest): Record<string, unknown> {
  return {
    model: req.model,
    messages: req.messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(req.tools?.length
      ? {
          tools: req.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        }
      : {}),
    ...(req.reasoningEffort ? { reasoning_effort: req.reasoningEffort } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
    venice_parameters: {
      enable_web_search: req.webSearch,
      enable_web_citations: req.webSearch !== 'off',
      include_venice_system_prompt: req.includeVeniceSystemPrompt,
    },
  }
}

const BALANCE_HEADERS = ['x-venice-balance-usd', 'x-venice-balance-diem']

function readBalance(headers: Headers): number | null {
  for (const name of BALANCE_HEADERS) {
    const raw = headers.get(name)
    if (raw === null) continue
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function finishReason(raw: unknown): FinishReason {
  return raw === 'stop' || raw === 'length' || raw === 'tool_calls' ? raw : 'other'
}

function toCitations(raw: unknown): Citation[] {
  if (!Array.isArray(raw)) return []
  const out: Citation[] = []
  for (const item of raw) {
    if (!item || typeof item.url !== 'string' || typeof item.title !== 'string') continue
    out.push({
      title: item.title,
      url: item.url,
      ...(typeof item.content === 'string' ? { content: item.content } : {}),
      ...(typeof item.date === 'string' ? { date: item.date } : {}),
    })
  }
  return out
}

interface PartialToolCall {
  id: string
  name: string
  arguments: string
}

export function createVeniceAdapter(opts: { key: string; fetchImpl?: typeof fetch }): LlmAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch

  return {
    async *stream(req: LlmRequest): AsyncIterable<LlmEvent> {
      const timeout = AbortSignal.timeout(Math.max(1, req.timeoutMs))
      const signal = AbortSignal.any([req.signal, timeout])
      // Which signal fired decides the error: the caller's is a cancellation,
      // the timer's is the provider taking too long.
      const abortError = () => new LlmError(req.signal.aborted ? 'aborted' : 'timeout')

      let res: Response
      try {
        res = await fetchImpl(`${VENICE_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.key}` },
          body: JSON.stringify(buildVeniceBody(req)),
          signal,
        })
      } catch {
        throw signal.aborted ? abortError() : new LlmError('transport')
      }

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '')
        console.error('Venice error:', res.status, detail.slice(0, 500))
        res.body?.cancel().catch(() => {})
        throw new LlmError('upstream', res.status)
      }

      yield { type: 'meta', balanceUsd: readBalance(res.headers) }

      const tools = new Map<number, PartialToolCall>()
      let produced = false
      let finish: FinishReason | null = null
      try {
        for await (const payload of parseSse(res.body)) {
          let chunk: Record<string, unknown>
          try {
            chunk = JSON.parse(payload)
          } catch {
            continue
          }
          if (!chunk || typeof chunk !== 'object') continue

          const vp = chunk.venice_parameters as Record<string, unknown> | undefined
          const citations = toCitations(vp?.web_search_citations)
          if (citations.length) yield { type: 'citations', citations }

          const choice = (chunk.choices as Array<Record<string, unknown>> | undefined)?.[0]
          const delta = choice?.delta as Record<string, unknown> | undefined
          if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) {
            produced = true
            yield { type: 'reasoning-delta', text: delta.reasoning_content }
          }
          if (typeof delta?.content === 'string' && delta.content) {
            produced = true
            yield { type: 'text-delta', text: delta.content }
          }
          if (Array.isArray(delta?.tool_calls)) {
            for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
              const index = typeof tc.index === 'number' ? tc.index : 0
              const fn = (tc.function ?? {}) as Record<string, unknown>
              const entry = tools.get(index) ?? { id: '', name: '', arguments: '' }
              if (typeof tc.id === 'string' && !entry.id) entry.id = tc.id
              if (typeof fn.name === 'string' && !entry.name) entry.name = fn.name
              if (typeof fn.arguments === 'string') entry.arguments += fn.arguments
              tools.set(index, entry)
            }
          }
          if (choice?.finish_reason) finish = finishReason(choice.finish_reason)

          const usage = chunk.usage as Record<string, unknown> | undefined
          if (usage && typeof usage === 'object') {
            const details = usage.prompt_tokens_details as Record<string, unknown> | null | undefined
            yield {
              type: 'usage',
              usage: {
                inputTokens: Number(usage.prompt_tokens) || 0,
                outputTokens: Number(usage.completion_tokens) || 0,
                cachedInputTokens: Number(details?.cached_tokens) || 0,
              },
            }
          }
        }
      } catch (err) {
        if (err instanceof LlmError) throw err
        throw signal.aborted ? abortError() : new LlmError('transport')
      }
      if (signal.aborted) throw abortError()

      if (tools.size) {
        const calls: LlmToolCall[] = [...tools.entries()]
          .sort(([a], [b]) => a - b)
          .map(([index, t]) => ({
            id: t.id || `call_${index}`,
            type: 'function',
            function: { name: t.name, arguments: t.arguments },
          }))
        produced = true
        yield { type: 'tool-calls', calls }
      }
      if (!produced) throw new LlmError('empty')
      yield { type: 'finish', reason: finish ?? (tools.size ? 'tool_calls' : 'stop') }
    },
  }
}
