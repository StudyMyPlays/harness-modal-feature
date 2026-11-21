import { jsonError, notConfigured, unauthorized } from '@/lib/api-response'
import type { HarnessConfig } from './config'

/**
 * The passcode gate. There are no accounts yet, so a deployment either has a
 * passcode (and every API call needs a signed session cookie from
 * `/api/unlock`) or is explicitly public. Production with neither refuses,
 * because an open URL spends the owner's Venice credit for anyone.
 */
export const SESSION_COOKIE = 'harness_session'
export const SESSION_TTL_MS = 30 * 24 * 3600_000

const encoder = new TextEncoder()

function base64url(bytes: ArrayBuffer): string {
  let bin = ''
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(data)))
}

/** Constant-time comparison of two byte strings of possibly different length. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

export async function signSession(secret: string, now: number): Promise<string> {
  const expiresAt = now + SESSION_TTL_MS
  return `${expiresAt}.${await hmac(secret, String(expiresAt))}`
}

export async function verifySession(token: string | undefined, secret: string, now: number): Promise<boolean> {
  if (!token) return false
  const dot = token.indexOf('.')
  if (dot <= 0) return false
  const exp = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!/^\d+$/.test(exp) || Number(exp) <= now) return false
  const expected = await hmac(secret, exp)
  return timingSafeEqual(encoder.encode(sig), encoder.encode(expected))
}

export function checkPasscode(given: string, expected: string): boolean {
  if (!given) return false
  return timingSafeEqual(encoder.encode(given), encoder.encode(expected))
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}

export async function isUnlocked(req: Request, cfg: HarnessConfig): Promise<boolean> {
  if (!cfg.passcode) return true
  if (!cfg.sessionSecret) return false
  return verifySession(readCookie(req, SESSION_COOKIE), cfg.sessionSecret, Date.now())
}

/** null when the request may proceed; otherwise the response to send. */
export async function checkAccess(req: Request, cfg: HarnessConfig): Promise<Response | null> {
  if (cfg.passcode) {
    if (!cfg.sessionSecret) {
      console.error('HARNESS_PASSCODE is set but HARNESS_SESSION_SECRET is not.')
      return notConfigured('The harness isn’t configured: set HARNESS_SESSION_SECRET.')
    }
    return (await isUnlocked(req, cfg)) ? null : unauthorized('Enter the passcode to continue.')
  }
  if (cfg.isProduction && !cfg.isPublic) {
    return jsonError('Set HARNESS_PASSCODE (or HARNESS_PUBLIC=1) before deploying.', 503)
  }
  return null
}
