import { jsonError, notConfigured, rateLimited } from '@/lib/api-response'
import { checkRateLimits, consumeBudget, getClientIp } from '@/lib/rate-limit'
import { checkAccess } from './auth'
import { getHarnessConfig, type HarnessConfig } from './config'
import { isCrossSite } from './http'

export const CAPACITY_MESSAGE = 'The harness is at capacity for today. Try again tomorrow.'

/**
 * Everything every harness API route checks before doing work, in order:
 * cross-site, passcode, Venice key, caller identity, rate limit, daily budget.
 */
export async function guardRequest(
  req: Request,
  opts: { name: string; limit: number; windowMs: number; budgetUnits: number },
): Promise<{ ok: true; cfg: HarnessConfig; ip: string } | { ok: false; response: Response }> {
  if (isCrossSite(req)) return { ok: false, response: jsonError('Cross-site requests are not allowed.', 403) }
  const cfg = getHarnessConfig()
  const denied = await checkAccess(req, cfg)
  if (denied) return { ok: false, response: denied }
  if (!cfg.veniceKey) {
    return { ok: false, response: notConfigured('The harness isn’t configured: set VENICE_API_KEY.') }
  }
  const ip = getClientIp(req)
  if (!ip) {
    console.error(
      'Harness request refused: no trusted client IP. Deploy on Vercel or set TRUST_PROXY_HEADERS=1 behind a proxy that overwrites x-forwarded-for.',
    )
    return { ok: false, response: notConfigured('The harness isn’t available on this server right now.') }
  }
  if (!checkRateLimits([{ key: `${opts.name}:${ip}`, limit: opts.limit, windowMs: opts.windowMs }])) {
    return { ok: false, response: rateLimited() }
  }
  if (opts.budgetUnits > 0 && !consumeBudget(opts.budgetUnits, cfg.dailyBudget)) {
    return { ok: false, response: notConfigured(CAPACITY_MESSAGE) }
  }
  return { ok: true, cfg, ip }
}
