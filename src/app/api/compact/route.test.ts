import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import modelsFixture from '@/lib/harness/__fixtures__/models.json'
import { COMPACT_PROMPT } from '@/lib/harness/prompts'
import { GLM, jsonPost, setupRouteEnv } from '@/test/routes'
import { sseResponse } from '@/test/streams'

const { POST } = await import('@/app/api/compact/route')
const URL_ = 'http://localhost:3000/api/compact'

beforeEach(setupRouteEnv)
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('POST /api/compact', () => {
  it('compact returns summary', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('/models')) return Response.json(modelsFixture)
        bodies.push(JSON.parse(String(init?.body)))
        return sseResponse([
          { choices: [{ index: 0, delta: { content: '## Goals\n' }, finish_reason: null }] },
          { choices: [{ index: 0, delta: { content: 'Plan a trip.' }, finish_reason: 'stop' }] },
        ])
      }),
    )
    const res = await POST(
      jsonPost(URL_, {
        messages: [
          { role: 'user', content: 'plan lisbon' },
          { role: 'assistant', content: 'ok' },
        ],
      }),
    )
    expect(await res.json()).toEqual({ summary: '## Goals\nPlan a trip.' })
    expect(bodies[0]).toMatchObject({ model: GLM, max_tokens: 4000 })
    const sent = bodies[0].messages as { role: string; content: string }[]
    expect(sent[0]).toEqual({ role: 'system', content: COMPACT_PROMPT })
  })

  it('compact 400 when a message has array content', async () => {
    const res = await POST(jsonPost(URL_, { messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] }))
    expect(res.status).toBe(400)
  })
})
