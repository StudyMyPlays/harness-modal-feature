import { VENICE_BASE_URL } from './llm/venice'
import { LlmError, type Usage } from './llm/types'

/** USD per one million tokens. */
export interface ModelPricing {
  inputUsd: number
  outputUsd: number
  cachedInputUsd: number
}

export interface ModelInfo {
  id: string
  name: string
  contextTokens: number
  maxOutputTokens: number
  supportsVision: boolean
  supportsTools: boolean
  supportsWebSearch: boolean
  reasoningEffortOptions: string[]
  defaultReasoningEffort: string | null
  pricing: ModelPricing
}

const CACHE_TTL_MS = 10 * 60_000

let cache: { at: number; byId: Map<string, ModelInfo> } | null = null

export function resetCatalogCache(): void {
  cache = null
}

type Json = Record<string, unknown>

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function toModelInfo(raw: Json): ModelInfo | null {
  if (typeof raw.id !== 'string') return null
  const spec = (raw.model_spec ?? {}) as Json
  const caps = (spec.capabilities ?? {}) as Json
  const pricing = (spec.pricing ?? {}) as Json
  const usd = (key: string) => (pricing[key] as Json | undefined)?.usd
  const inputUsd = num(usd('input'))
  return {
    id: raw.id,
    name: typeof spec.name === 'string' ? spec.name : raw.id,
    contextTokens: num(spec.availableContextTokens),
    maxOutputTokens: num(spec.maxCompletionTokens),
    supportsVision: caps.supportsVision === true,
    supportsTools: caps.supportsFunctionCalling === true,
    supportsWebSearch: caps.supportsWebSearch === true,
    reasoningEffortOptions: Array.isArray(caps.reasoningEffortOptions)
      ? caps.reasoningEffortOptions.filter((o): o is string => typeof o === 'string')
      : [],
    defaultReasoningEffort: typeof caps.defaultReasoningEffort === 'string' ? caps.defaultReasoningEffort : null,
    pricing: {
      inputUsd,
      outputUsd: num(usd('output')),
      cachedInputUsd: num(usd('cache_input'), inputUsd),
    },
  }
}

/**
 * The allow-listed models as Venice describes them right now: names, context
 * size, capabilities and prices. Venice adds and retires models often, so this
 * is read from `/models` (cached for ten minutes per process) rather than
 * hard-coded. A failed refresh serves the previous list if there is one.
 */
export async function getModelCatalog(opts: {
  key: string
  allow: string[]
  fetchImpl?: typeof fetch
  now?: () => number
}): Promise<ModelInfo[]> {
  const now = (opts.now ?? Date.now)()
  if (!cache || now - cache.at >= CACHE_TTL_MS) {
    try {
      cache = { at: now, byId: await fetchCatalog(opts.key, opts.fetchImpl ?? fetch) }
    } catch (err) {
      if (!cache) throw err
      console.error('Venice /models refresh failed; serving the cached list.', err)
    }
  }
  const byId = cache.byId
  return opts.allow.map((id) => byId.get(id)).filter((m): m is ModelInfo => m !== undefined)
}

async function fetchCatalog(key: string, fetchImpl: typeof fetch): Promise<Map<string, ModelInfo>> {
  let res: Response
  try {
    res = await fetchImpl(`${VENICE_BASE_URL}/models?type=text`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new LlmError('transport')
  }
  if (!res.ok) {
    res.body?.cancel().catch(() => {})
    throw new LlmError('upstream', res.status)
  }
  const data = (await res.json().catch(() => null)) as { data?: unknown } | null
  const byId = new Map<string, ModelInfo>()
  for (const raw of Array.isArray(data?.data) ? data.data : []) {
    const info = raw && typeof raw === 'object' ? toModelInfo(raw as Json) : null
    if (info) byId.set(info.id, info)
  }
  return byId
}

export function costUsd(usage: Usage, pricing: ModelPricing): number {
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens)
  return (
    ((usage.inputTokens - cached) * pricing.inputUsd +
      cached * pricing.cachedInputUsd +
      usage.outputTokens * pricing.outputUsd) /
    1e6
  )
}
