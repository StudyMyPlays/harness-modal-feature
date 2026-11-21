import { beforeEach, describe, expect, it, vi } from 'vitest'
import modelsFixture from './__fixtures__/models.json'
import { costUsd, getModelCatalog, resetCatalogCache } from './catalog'
import { VENICE_BASE_URL } from './llm/venice'

const DEEPSEEK = 'deepseek-v4-1-flash-1017-uncensored'
const GLM = 'glm-5-3-flash-uncensored'

function fetchOk() {
  return vi.fn(async () => Response.json(modelsFixture))
}

beforeEach(() => {
  resetCatalogCache()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('getModelCatalog', () => {
  it('maps and orders allowed models', async () => {
    const fetchImpl = fetchOk()
    const models = await getModelCatalog({
      key: 'k',
      allow: [GLM, DEEPSEEK, 'missing-model'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VENICE_BASE_URL}/models?type=text`,
      expect.objectContaining({ headers: { Authorization: 'Bearer k' } }),
    )
    expect(models.map((m) => m.id)).toEqual([GLM, DEEPSEEK])
    expect(models[1]).toEqual({
      id: DEEPSEEK,
      name: 'DeepSeek V4.1 Flash 1017 Uncensored',
      contextTokens: 1000000,
      maxOutputTokens: 131072,
      supportsVision: true,
      supportsTools: true,
      supportsWebSearch: true,
      reasoningEffortOptions: ['none', 'low', 'high', 'max'],
      defaultReasoningEffort: 'high',
      pricing: { inputUsd: 0.33, outputUsd: 1.32, cachedInputUsd: 0.00825 },
    })
    expect(models[0].pricing).toEqual({ inputUsd: 0.165, outputUsd: 0.55, cachedInputUsd: 0.033 })
  })

  it('caches for 10 minutes', async () => {
    const fetchImpl = fetchOk() as unknown as typeof fetch
    let now = 1_000_000
    const opts = { key: 'k', allow: [DEEPSEEK], fetchImpl, now: () => now }
    await getModelCatalog(opts)
    now += 9 * 60_000
    await getModelCatalog(opts)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    now += 2 * 60_000
    await getModelCatalog(opts)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('serves stale cache when refresh fails', async () => {
    let now = 0
    const good = fetchOk() as unknown as typeof fetch
    await getModelCatalog({ key: 'k', allow: [DEEPSEEK], fetchImpl: good, now: () => now })
    now += 60 * 60_000
    const bad = vi.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch
    const models = await getModelCatalog({ key: 'k', allow: [DEEPSEEK], fetchImpl: bad, now: () => now })
    expect(models.map((m) => m.id)).toEqual([DEEPSEEK])
  })

  it('throws an upstream LlmError when there is no cache to fall back on', async () => {
    const bad = vi.fn(async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
    await expect(getModelCatalog({ key: 'k', allow: [DEEPSEEK], fetchImpl: bad })).rejects.toMatchObject({
      kind: 'upstream',
      status: 401,
    })
  })
})

describe('costUsd', () => {
  const deepseek = { inputUsd: 0.33, outputUsd: 1.32, cachedInputUsd: 0.00825 }

  it('prices input and output per million tokens', () => {
    expect(costUsd({ inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 1_000_000 }, deepseek)).toBeCloseTo(
      1.65,
      10,
    )
  })

  it('prices cached input at the cached rate', () => {
    expect(costUsd({ inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 0 }, deepseek)).toBeCloseTo(
      0.00825,
      10,
    )
  })
})
