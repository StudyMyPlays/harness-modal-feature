import { NextResponse, type NextRequest } from 'next/server'
import { invalidBody, jsonError, notConfigured, rateLimited, unauthorized } from '@/lib/api-response'
import { SESSION_COOKIE, SESSION_TTL_MS, checkPasscode, isUnlocked, signSession } from '@/lib/harness/auth'
import { getHarnessConfig } from '@/lib/harness/config'
import { isCrossSite, readJsonBody } from '@/lib/harness/http'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/** Whether the UI should show the unlock screen. */
export async function GET(req: NextRequest) {
  const cfg = getHarnessConfig()
  return NextResponse.json({ required: cfg.passcode !== null, unlocked: await isUnlocked(req, cfg) })
}

/** Trade the passcode for a signed, HttpOnly session cookie. */
export async function POST(req: NextRequest) {
  if (isCrossSite(req)) return jsonError('Cross-site requests are not allowed.', 403)
  const cfg = getHarnessConfig()
  if (!cfg.passcode || !cfg.sessionSecret) {
    return notConfigured('No passcode is configured on this server.')
  }
  const ip = getClientIp(req)
  if (!ip) return notConfigured('The harness isn’t available on this server right now.')
  // Tight: this is the one route a stranger can use to guess.
  if (!checkRateLimit(`unlock:${ip}`, 5, 60_000)) return rateLimited()

  const body = await readJsonBody(req, 4096)
  if (!body.ok) return body.response
  const passcode = (body.value as { passcode?: unknown } | null)?.passcode
  if (typeof passcode !== 'string') return invalidBody('Send { passcode }.')
  if (!checkPasscode(passcode, cfg.passcode)) return unauthorized('That passcode isn’t right.')

  const token = await signSession(cfg.sessionSecret, Date.now())
  const res = new NextResponse(null, { status: 204 })
  res.headers.set(
    'set-cookie',
    [
      `${SESSION_COOKIE}=${token}`,
      'HttpOnly',
      'SameSite=Strict',
      'Path=/',
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
      ...(cfg.isProduction ? ['Secure'] : []),
    ].join('; '),
  )
  return res
}
