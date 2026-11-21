import { describe, expect, it } from 'vitest'
import { SESSION_COOKIE, SESSION_TTL_MS, checkAccess, checkPasscode, signSession, verifySession } from './auth'
import { getHarnessConfig } from './config'

const SECRET = 'test-secret'

function reqWithCookie(token?: string) {
  return new Request('http://localhost/api/chat', {
    headers: token ? { cookie: `other=1; ${SESSION_COOKIE}=${token}` } : {},
  })
}

describe('session tokens', () => {
  it('signed token verifies until expiry and fails after', async () => {
    const token = await signSession(SECRET, 1000)
    expect(await verifySession(token, SECRET, 1000 + SESSION_TTL_MS - 1)).toBe(true)
    expect(await verifySession(token, SECRET, 1000 + SESSION_TTL_MS)).toBe(false)
  })

  it('tampered signature fails', async () => {
    const token = await signSession(SECRET, 1000)
    const [exp, sig] = token.split('.')
    expect(await verifySession(`${exp}.${sig.slice(0, -2)}xx`, SECRET, 1000)).toBe(false)
    expect(await verifySession(`${Number(exp) + 1}.${sig}`, SECRET, 1000)).toBe(false)
    expect(await verifySession(token, 'other-secret', 1000)).toBe(false)
    expect(await verifySession(undefined, SECRET, 1000)).toBe(false)
    expect(await verifySession('garbage', SECRET, 1000)).toBe(false)
  })

  it('is 30 days long', () => {
    expect(SESSION_TTL_MS).toBe(30 * 24 * 3600_000)
  })
})

describe('checkPasscode', () => {
  it('checkPasscode true/false and different lengths false', () => {
    expect(checkPasscode('open sesame', 'open sesame')).toBe(true)
    expect(checkPasscode('open sesamf', 'open sesame')).toBe(false)
    expect(checkPasscode('open', 'open sesame')).toBe(false)
    expect(checkPasscode('', 'x')).toBe(false)
  })
})

describe('checkAccess', () => {
  it('passes with no passcode outside production', async () => {
    expect(await checkAccess(reqWithCookie(), getHarnessConfig({}))).toBeNull()
  })

  it('refuses production without a passcode unless HARNESS_PUBLIC=1', async () => {
    const res = await checkAccess(reqWithCookie(), getHarnessConfig({ NODE_ENV: 'production' }))
    expect(res?.status).toBe(503)
    expect(await res?.json()).toEqual({ error: 'Set HARNESS_PASSCODE (or HARNESS_PUBLIC=1) before deploying.' })
    expect(await checkAccess(reqWithCookie(), getHarnessConfig({ NODE_ENV: 'production', HARNESS_PUBLIC: '1' }))).toBeNull()
  })

  it('refuses with a passcode but no session secret', async () => {
    const res = await checkAccess(reqWithCookie(), getHarnessConfig({ HARNESS_PASSCODE: 'p' }))
    expect(res?.status).toBe(503)
  })

  it('with a passcode, needs a valid session cookie', async () => {
    const cfg = getHarnessConfig({ HARNESS_PASSCODE: 'p', HARNESS_SESSION_SECRET: SECRET })
    const denied = await checkAccess(reqWithCookie(), cfg)
    expect(denied?.status).toBe(401)
    expect(await denied?.json()).toEqual({ error: 'Enter the passcode to continue.' })
    expect((await checkAccess(reqWithCookie('1.bad'), cfg))?.status).toBe(401)
    const token = await signSession(SECRET, Date.now())
    expect(await checkAccess(reqWithCookie(token), cfg)).toBeNull()
  })
})
