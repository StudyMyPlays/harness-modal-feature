import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkRateLimits, consumeBudget, getClientIp, resetRateLimits } from '@/lib/rate-limit'

const req = (headers: Record<string, string> = {}) => new Request('http://x/', { headers })

describe('getClientIp', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('ignores x-vercel-forwarded-for when not running on Vercel', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL', '')
    expect(getClientIp(req({ 'x-vercel-forwarded-for': '1.2.3.4' }))).toBeNull()
  })

  it('trusts x-vercel-forwarded-for on Vercel', () => {
    vi.stubEnv('VERCEL', '1')
    expect(getClientIp(req({ 'x-vercel-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('1.2.3.4')
  })

  it('reads x-forwarded-for only with TRUST_PROXY_HEADERS=1', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(getClientIp(req({ 'x-forwarded-for': '9.9.9.9' }))).toBeNull()
    vi.stubEnv('TRUST_PROXY_HEADERS', '1')
    expect(getClientIp(req({ 'x-forwarded-for': '9.9.9.9' }))).toBe('9.9.9.9')
  })

  it('returns null in production with no identity instead of a shared bucket', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(getClientIp(req())).toBeNull()
  })

  it('uses a fixed key outside production so local dev works', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(getClientIp(req())).toBe('local-dev')
  })
})

const checkRateLimit = (key: string, limit: number, windowMs: number) =>
  checkRateLimits([{ key, limit, windowMs }])

describe('checkRateLimits', () => {
  beforeEach(() => {
    resetRateLimits()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('admits up to the limit then refuses, and resets after the window', () => {
    for (let i = 0; i < 3; i++) expect(checkRateLimit('k', 3, 1000)).toBe(true)
    expect(checkRateLimit('k', 3, 1000)).toBe(false)
    vi.advanceTimersByTime(1001)
    expect(checkRateLimit('k', 3, 1000)).toBe(true)
  })

  it('does not charge the looser bucket when the tighter one refuses', () => {
    const rules = [
      { key: 'base', limit: 10, windowMs: 1000 },
      { key: 'deep', limit: 1, windowMs: 1000 },
    ]
    expect(checkRateLimits(rules)).toBe(true)
    expect(checkRateLimits(rules)).toBe(false)
    // base was charged once, not twice: nine more plain requests still fit.
    for (let i = 0; i < 9; i++) expect(checkRateLimit('base', 10, 1000)).toBe(true)
    expect(checkRateLimit('base', 10, 1000)).toBe(false)
  })

  it('does not reset an active caller when many new keys arrive', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('victim', 3, 60_000)
    for (let i = 0; i < 10_050; i++) checkRateLimit(`flood:${i}`, 1, 60_000)
    expect(checkRateLimit('victim', 3, 60_000)).toBe(false)
  })
})

describe('consumeBudget', () => {
  beforeEach(() => resetRateLimits())

  it('refuses once the daily budget is spent', () => {
    expect(consumeBudget(7, 10)).toBe(true)
    expect(consumeBudget(7, 10)).toBe(false)
    expect(consumeBudget(3, 10)).toBe(true)
  })
})
