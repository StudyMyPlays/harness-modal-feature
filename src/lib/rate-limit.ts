interface Bucket {
  count: number
  resetAt: number
}
const buckets = new Map<string, Bucket>()
/**
 * Hard cap on tracked keys, so a stream of distinct keys cannot grow the map
 * without bound. Only *expired* buckets are ever dropped to make room: evicting
 * a live one would reset that caller's count, which is exactly what someone
 * rotating keys wants. When the map is full of live buckets a new key is
 * refused instead (fail closed).
 */
const MAX_TRACKED_KEYS = 10_000
function sweepExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key)
  }
}

export interface RateLimitRule {
  key: string
  limit: number
  windowMs: number
}

/**
 * Applies every rule or none of them: the request is admitted only if all
 * buckets have room, and only then are they all incremented. Checking and
 * charging separately meant a caller refused by the tighter (deep) bucket had
 * still spent a slot in the looser one.
 */
export function checkRateLimits(rules: RateLimitRule[]): boolean {
  const now = Date.now()
  for (const rule of rules) {
    const bucket = buckets.get(rule.key)
    if (bucket && now < bucket.resetAt) {
      if (bucket.count >= rule.limit) return false
    } else if (!bucket && buckets.size >= MAX_TRACKED_KEYS) {
      sweepExpired(now)
      if (buckets.size >= MAX_TRACKED_KEYS) return false
    }
  }
  for (const rule of rules) {
    const bucket = buckets.get(rule.key)
    if (bucket && now < bucket.resetAt) {
      bucket.count += 1
    } else {
      buckets.set(rule.key, { count: 1, resetAt: now + rule.windowMs })
    }
  }
  return true
}

/** Test hook: forget every bucket and the spend budget. */
export function resetRateLimits(): void {
  buckets.clear()
  budget = { day: 0, used: 0 }
}

/**
 * Process-wide ceiling on upstream model calls per UTC day — a circuit breaker
 * for the key's spend, independent of who is calling. Per-caller limits bound
 * one caller; this bounds the total if many callers (or many spoofed ones)
 * show up at once. Per process, like the rest of this file.
 */
let budget = { day: 0, used: 0 }
export function consumeBudget(units: number, dailyLimit: number): boolean {
  const day = Math.floor(Date.now() / 86_400_000)
  if (budget.day !== day) budget = { day, used: 0 }
  if (budget.used + units > dailyLimit) return false
  budget.used += units
  return true
}

/**
 * Caller identifier for use as a rate-limit key, or `null` when the caller
 * cannot be identified.
 *
 * Forwarding headers are set by the *client* unless a trusted proxy overwrites
 * them. `x-vercel-forwarded-for` is only trustworthy when the request really
 * came through Vercel's edge, which strips any client-supplied copy — off
 * Vercel a client can send it with any value and mint a fresh identity per
 * request. So it is honored only when `VERCEL` is set. Behind a different
 * reverse proxy, set TRUST_PROXY_HEADERS=1 — but only if that proxy overwrites
 * `x-forwarded-for` rather than appending to it.
 *
 * With no trustworthy identity this returns `null` in production and the
 * caller must refuse the request: a shared fallback bucket let one client
 * lock everyone else out. Outside production a fixed key is returned so local
 * development works without a proxy.
 *
 * Prefer a session user id over this wherever one is available.
 */
export function getClientIp(req: Request): string | null {
  if (process.env.VERCEL) {
    const vercel = req.headers.get('x-vercel-forwarded-for')
    if (vercel) return vercel.split(',')[0].trim()
  }
  if (process.env.TRUST_PROXY_HEADERS === '1') {
    const forwarded = req.headers.get('x-forwarded-for')
    if (forwarded) return forwarded.split(',')[0].trim()
    const real = req.headers.get('x-real-ip')
    if (real) return real.trim()
  }
  return process.env.NODE_ENV === 'production' ? null : 'local-dev'
}
