import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import modelsFixture from '@/lib/harness/__fixtures__/models.json'
import { GLM, jsonPost, setupRouteEnv } from '@/test/routes'
import { sseResponse } from '@/test/streams'

const { POST } = await import('@/app/api/title/route')
const URL_ = 'http://localhost:3000/api/title'

function stub(text: string) {
  const bodies: Record<string, unknown>[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/models')) return Response.json(modelsFixture)
      bodies.push(JSON.parse(String(init?.body)))
      return sseResponse([{ choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }] }])
    }),
  )
  return bodies
}

beforeEach(setupRouteEnv)
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('POST /api/title', () => {
  it('title returns sanitized title', async () => {
    const bodies = stub('"Planning A Trip To Lisbon."')
    const res = await POST(jsonPost(URL_, { userText: 'help me plan lisbon', assistantText: 'Sure!' }))
    expect(await res.json()).toEqual({ title: 'Planning A Trip To Lisbon' })
    expect(bodies[0]).toMatchObject({ model: GLM, max_tokens: 30, temperature: 0.3, reasoning_effort: 'low' })
    expect((bodies[0].venice_parameters as Record<string, unknown>).enable_web_search).toBe('off')
  })

  it('cuts each text to 2000 characters before sending', async () => {
    const bodies = stub('T')
    await POST(jsonPost(URL_, { userText: 'u'.repeat(5000), assistantText: 'a'.repeat(5000) }))
    const content = JSON.stringify(bodies[0].messages)
    expect(content).not.toContain('u'.repeat(2001))
    expect(content).not.toContain('a'.repeat(2001))
  })

  it('title 400 on missing userText', async () => {
    stub('x')
    expect((await POST(jsonPost(URL_, { assistantText: 'x' }))).status).toBe(400)
  })

  it('502 when the model gives nothing usable', async () => {
    stub('   ')
    expect((await POST(jsonPost(URL_, { userText: 'hi', assistantText: '' }))).status).toBe(502)
  })
})
