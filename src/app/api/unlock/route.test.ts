import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetRateLimits } from '@/lib/rate-limit'
import { SESSION_COOKIE, signSession } from '@/lib/harness/auth'

const { GET, POST } = await import('@/app/api/unlock/route')

const URL_ = 'http://localhost:3000/api/unlock'

function post(body: unknown) {
  return POST(
    new NextRequest(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'localhost:3000' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  resetRateLimits()
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('VERCEL', '')
  vi.stubEnv('HARNESS_PASSCODE', 'correct horse')
  vi.stubEnv('HARNESS_SESSION_SECRET', 'secret')
})
afterEach(() => vi.unstubAllEnvs())

describe('/api/unlock', () => {
  it('correct passcode sets HttpOnly SameSite=Strict cookie', async () => {
    const res = await post({ passcode: 'correct horse' })
    expect(res.status).toBe(204)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=\\d+\\.`))
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=2592000')
    expect(cookie).not.toContain('Secure')
  })

  it('adds Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('TRUST_PROXY_HEADERS', '1')
    const res = await POST(
      new NextRequest(URL_, {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'localhost:3000', 'x-forwarded-for': '1.2.3.4' },
        body: JSON.stringify({ passcode: 'correct horse' }),
      }),
    )
    expect(res.headers.get('set-cookie')).toContain('Secure')
  })

  it('wrong passcode 401', async () => {
    const res = await post({ passcode: 'nope' })
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('missing passcode field 400', async () => {
    expect((await post({})).status).toBe(400)
  })

  it('6th attempt in a minute 429', async () => {
    for (let i = 0; i < 5; i++) await post({ passcode: 'nope' })
    expect((await post({ passcode: 'correct horse' })).status).toBe(429)
  })

  it('GET reports required/unlocked', async () => {
    const locked = await GET(new NextRequest(URL_, { headers: { host: 'localhost:3000' } }))
    expect(await locked.json()).toEqual({ required: true, unlocked: false })
    const token = await signSession('secret', Date.now())
    const open = await GET(
      new NextRequest(URL_, { headers: { host: 'localhost:3000', cookie: `${SESSION_COOKIE}=${token}` } }),
    )
    expect(await open.json()).toEqual({ required: true, unlocked: true })
    vi.stubEnv('HARNESS_PASSCODE', '')
    const none = await GET(new NextRequest(URL_, { headers: { host: 'localhost:3000' } }))
    expect(await none.json()).toEqual({ required: false, unlocked: true })
  })
})
