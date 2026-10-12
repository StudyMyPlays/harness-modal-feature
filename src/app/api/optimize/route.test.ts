import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetRateLimits } from '@/lib/rate-limit'

const { POST } = await import('@/app/api/optimize/route')

const URL_ = 'http://localhost:3000/api/optimize'
const good = { mode: 'co-work', raw: 'write me a thing' }

function post(body: unknown, headers: Record<string, string> = {}, rawBody?: string) {
  return POST(
    new NextRequest(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'localhost:3000', ...headers },
      body: rawBody ?? JSON.stringify(body),
    }),
  )
}

/** Upstream that answers every call: judges get a valid score, writes get text. */
function okUpstream() {
  const f = vi.fn(async (_u: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    const content = body.response_format
      ? JSON.stringify({ score: 40, breakdown: { specificity: 10, completeness: 10, clarity: 10, structure: 10 }, issues: ['x'] })
      : 'OUTPUT'
    return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] })
  })
  vi.stubGlobal('fetch', f)
  return f
}

beforeEach(() => {
  resetRateLimits()
  vi.stubEnv('OPENROUTER_API_KEY', 'sk-test')
  vi.stubEnv('NODE_ENV', 'development')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('request validation', () => {
  const cases: [string, unknown, string?][] = [
    ['null body', null],
    ['array body', []],
    ['raw is a number', { mode: 'co-work', raw: 123 }],
    ['raw is an array', { mode: 'co-work', raw: ['a'] }],
    ['raw is blank', { mode: 'co-work', raw: '   ' }],
    ['unknown mode', { mode: '__proto__', raw: 'x' }],
    ['mode is a number', { mode: 5, raw: 'x' }],
    ['ctx is a number', { mode: 'gpt-project', raw: 'x', ctx: 5 }],
    ['ctx is an object', { mode: 'gpt-project', raw: 'x', ctx: { a: 'b'.repeat(50_000) } }],
    ['ctx too long', { mode: 'gpt-project', raw: 'x', ctx: 'c'.repeat(4_001) }],
    ['raw too long', { mode: 'co-work', raw: 'r'.repeat(8_001) }],
    ['model is a number', { ...good, model: 5 }],
    ['premium model', { ...good, model: 'anthropic/claude-opus-5' }],
    ['deepOptimize is a string', { ...good, deepOptimize: 'true' }],
  ]
  it.each(cases)('rejects %s with a 400 and never calls upstream or spends quota', async (_n, body) => {
    const f = okUpstream()
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(typeof (await res.json()).error).toBe('string')
    expect(f).not.toHaveBeenCalled()
    // Quota untouched: a full 20 valid requests still fit afterwards.
    for (let i = 0; i < 20; i++) expect((await post(good)).status).toBe(200)
  })

  it('rejects unparseable JSON', async () => {
    expect((await post(null, {}, '{nope')).status).toBe(400)
  })

  it('requires application/json', async () => {
    expect((await post(good, { 'content-type': 'text/plain' })).status).toBe(415)
  })

  it('refuses an oversized body before parsing it', async () => {
    const f = okUpstream()
    const res = await post(null, {}, JSON.stringify({ ...good, pad: 'p'.repeat(70_000) }))
    expect(res.status).toBe(413)
    expect(f).not.toHaveBeenCalled()
  })

  it('refuses cross-site browser requests', async () => {
    const f = okUpstream()
    expect((await post(good, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await post(good, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect(f).not.toHaveBeenCalled()
  })

  it('lets an origin listed in ALLOWED_ORIGINS through', async () => {
    vi.stubEnv('ALLOWED_ORIGINS', 'https://partner.example')
    okUpstream()
    const h = { origin: 'https://partner.example', 'sec-fetch-site': 'cross-site' }
    expect((await post(good, h)).status).toBe(200)
  })

  it('accepts a same-origin browser request', async () => {
    okUpstream()
    expect((await post(good, { origin: 'http://localhost:3000' })).status).toBe(200)
  })
})

describe('caller identity and limits', () => {
  it('refuses in production when no trusted client IP exists', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const f = okUpstream()
    const res = await post(good, { 'x-vercel-forwarded-for': '1.2.3.4' })
    expect(res.status).toBe(503)
    expect(f).not.toHaveBeenCalled()
  })

  it('cannot be bypassed by rotating x-vercel-forwarded-for off Vercel', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    okUpstream()
    const statuses: number[] = []
    for (let i = 0; i < 22; i++) statuses.push((await post(good, { 'x-vercel-forwarded-for': `10.0.0.${i}` })).status)
    expect(statuses.filter((s) => s === 429)).toHaveLength(2)
  })

  it('does not spend a base slot on a request the deep limit refuses', async () => {
    okUpstream()
    for (let i = 0; i < 5; i++) expect((await post({ ...good, deepOptimize: true })).status).toBe(200)
    expect((await post({ ...good, deepOptimize: true })).status).toBe(429)
    // 5 deep requests used 5 base slots; 15 remain, the refused one cost none.
    for (let i = 0; i < 15; i++) expect((await post(good)).status).toBe(200)
    expect((await post(good)).status).toBe(429)
  })

  it('stops calling upstream once the daily budget is spent', async () => {
    vi.stubEnv('OPTIMIZER_DAILY_CALL_BUDGET', '3')
    const f = okUpstream()
    expect((await post(good)).status).toBe(200)
    const calls = f.mock.calls.length
    expect((await post(good)).status).toBe(503)
    expect(f.mock.calls.length).toBe(calls)
  })
})

describe('responses', () => {
  it('returns 503 when no key is configured', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    expect((await post(good)).status).toBe(503)
  })

  it('withholds Pro detail from the wire when OPTIMIZER_PRO=0', async () => {
    vi.stubEnv('OPTIMIZER_PRO', '0')
    okUpstream()
    const body = await (await post({ ...good, deepOptimize: true })).json()
    expect(body.pro).toBe(false)
    expect(JSON.stringify(body)).not.toMatch(/breakdown|issues|draft0/)
    expect(body.score).toEqual({ score: 40 })
  })

  it('includes it when OPTIMIZER_PRO=1', async () => {
    vi.stubEnv('OPTIMIZER_PRO', '1')
    okUpstream()
    const body = await (await post(good)).json()
    expect(body.pro).toBe(true)
    expect(body.score.breakdown).toBeDefined()
  })

  it('answers 504 with JSON when the provider times out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' }))),
    )
    const res = await post(good)
    expect(res.status).toBe(504)
    expect((await res.json()).error).toMatch(/too long/)
  })

  it('maps a transport failure to a 502', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('network'))))
    expect((await post(good)).status).toBe(502)
  })
})
