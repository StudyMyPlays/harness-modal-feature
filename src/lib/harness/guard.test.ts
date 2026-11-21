import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetRateLimits } from '@/lib/rate-limit'
import { guardRequest } from './guard'

const opts = { name: 'chat', limit: 2, windowMs: 60_000, budgetUnits: 1 }

function req(headers: Record<string, string> = {}) {
  return new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { host: 'localhost:3000', ...headers },
  })
}

async function refusal(r: Awaited<ReturnType<typeof guardRequest>>) {
  if (r.ok) throw new Error('expected a refusal')
  return { status: r.response.status, body: await r.response.json() }
}

beforeEach(() => {
  resetRateLimits()
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('VENICE_API_KEY', 'sk-test')
  vi.stubEnv('VERCEL', '')
  vi.stubEnv('TRUST_PROXY_HEADERS', '')
  vi.stubEnv('HARNESS_PASSCODE', '')
  vi.stubEnv('HARNESS_DAILY_CALL_BUDGET', '')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.unstubAllEnvs())

describe('guardRequest', () => {
  it('passes and returns cfg and ip', async () => {
    const r = await guardRequest(req(), opts)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.ip).toBe('local-dev')
      expect(r.cfg.veniceKey).toBe('sk-test')
    }
  })

  it('refuses cross-site requests 403 first', async () => {
    vi.stubEnv('VENICE_API_KEY', '')
    expect(await refusal(await guardRequest(req({ origin: 'https://evil.example' }), opts))).toEqual({
      status: 403,
      body: { error: 'Cross-site requests are not allowed.' },
    })
  })

  it('refuses when the passcode gate says so', async () => {
    vi.stubEnv('HARNESS_PASSCODE', 'p')
    vi.stubEnv('HARNESS_SESSION_SECRET', 's')
    expect((await refusal(await guardRequest(req(), opts))).status).toBe(401)
  })

  it('refuses 503 when VENICE_API_KEY is missing', async () => {
    vi.stubEnv('VENICE_API_KEY', '')
    expect(await refusal(await guardRequest(req(), opts))).toEqual({
      status: 503,
      body: { error: 'The harness isn’t configured: set VENICE_API_KEY.' },
    })
  })

  it('refuses 503 in production with no trusted client IP', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('HARNESS_PUBLIC', '1')
    expect((await refusal(await guardRequest(req(), opts))).status).toBe(503)
  })

  it('refuses 429 past the rate limit', async () => {
    await guardRequest(req(), opts)
    await guardRequest(req(), opts)
    expect((await refusal(await guardRequest(req(), opts))).status).toBe(429)
  })

  it('keeps separate buckets per route name', async () => {
    await guardRequest(req(), opts)
    await guardRequest(req(), opts)
    expect((await guardRequest(req(), { ...opts, name: 'title' })).ok).toBe(true)
  })

  it('refuses 503 when the daily budget is spent', async () => {
    vi.stubEnv('HARNESS_DAILY_CALL_BUDGET', '1')
    await guardRequest(req(), { ...opts, limit: 10 })
    expect(await refusal(await guardRequest(req(), { ...opts, limit: 10 }))).toEqual({
      status: 503,
      body: { error: 'The harness is at capacity for today. Try again tomorrow.' },
    })
  })

  it('does not spend budget for budgetUnits 0', async () => {
    vi.stubEnv('HARNESS_DAILY_CALL_BUDGET', '1')
    await guardRequest(req(), { ...opts, budgetUnits: 0, limit: 10 })
    expect((await guardRequest(req(), { ...opts, limit: 10 })).ok).toBe(true)
  })
})
