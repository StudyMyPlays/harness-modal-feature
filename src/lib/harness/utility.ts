import { jsonError } from '@/lib/api-response'
import { getModelCatalog } from './catalog'
import type { HarnessConfig } from './config'
import { completeText } from './llm/complete'
import { withRetry } from './llm/retry'
import { LlmError, type LlmMessage } from './llm/types'
import { createVeniceAdapter, downstreamStatus, upstreamMessage } from './llm/venice'

/**
 * One non-interactive call to the utility model (titles, compaction), with the
 * lowest reasoning effort the model offers — these jobs don't need thought.
 */
export async function runUtilityCall(
  cfg: HarnessConfig,
  signal: AbortSignal,
  opts: { messages: LlmMessage[]; maxTokens: number; temperature?: number; timeoutMs: number; feature: string },
): Promise<{ ok: true; text: string } | { ok: false; response: Response }> {
  let lowestEffort: string | undefined
  try {
    const [info] = await getModelCatalog({ key: cfg.veniceKey!, allow: [cfg.utilityModel] })
    lowestEffort = info?.reasoningEffortOptions[0]
  } catch {
    // No catalog: call without a reasoning setting.
  }
  try {
    const text = await completeText(withRetry(createVeniceAdapter({ key: cfg.veniceKey! })), {
      model: cfg.utilityModel,
      messages: opts.messages,
      maxTokens: opts.maxTokens,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(lowestEffort ? { reasoningEffort: lowestEffort } : {}),
      webSearch: 'off',
      includeVeniceSystemPrompt: false,
      signal,
      timeoutMs: opts.timeoutMs,
    })
    return { ok: true, text }
  } catch (err) {
    if (err instanceof LlmError && err.kind === 'upstream' && err.status !== undefined) {
      return { ok: false, response: jsonError(upstreamMessage(err.status, opts.feature), downstreamStatus(err.status)) }
    }
    if (err instanceof LlmError && err.kind === 'timeout') {
      return { ok: false, response: jsonError('The model provider took too long to answer. Try again.', 504) }
    }
    if (!(err instanceof LlmError)) console.error(`${opts.feature} failed:`, err)
    return { ok: false, response: jsonError(`${opts.feature} could not reach the model provider. Try again.`, 502) }
  }
}
