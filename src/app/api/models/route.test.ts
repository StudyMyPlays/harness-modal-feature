import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import modelsFixture from '@/lib/harness/__fixtures__/models.json'
import { DEEPSEEK, GLM, get, setupRouteEnv } from '@/test/routes'

const { GET } = await import('@/app/api/models/route')

beforeEach(setupRouteEnv)
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('GET /api/models', () => {
  it('models returns allowed models in order', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(modelsFixture)))
    vi.stubEnv('COMPACT_AT_TOKENS', '5000')
    const res = await GET(get('http://localhost:3000/api/models'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.models.map((m: { id: string }) => m.id)).toEqual([DEEPSEEK, GLM])
    expect(body).toMatchObject({ defaultModel: DEEPSEEK, utilityModel: GLM, compactAtTokens: 5000 })
  })

  it('models 503 when VENICE_API_KEY missing', async () => {
    vi.stubEnv('VENICE_API_KEY', '')
    expect((await GET(get('http://localhost:3000/api/models'))).status).toBe(503)
  })

  it('maps a catalog failure to a friendly 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 401 })))
    const res = await GET(get('http://localhost:3000/api/models'))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'The model list could not authenticate with the model provider.' })
  })
})
