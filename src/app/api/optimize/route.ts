import { NextRequest, NextResponse } from 'next/server'
import {
  ALLOWED_MODELS,
  MAX_CTX_CHARS,
  MAX_RAW_CHARS,
  isOptimizerMode,
} from '@/lib/optimizer/optimizer'
import { runOptimize, toResponse } from '@/lib/optimizer/refine'
import { checkRateLimits, consumeBudget, getClientIp } from '@/lib/rate-limit'
import {
  invalidBody,
  jsonError,
  notConfigured,
  rateLimited,
} from '@/lib/api-response'
export const runtime = 'nodejs'
// A deep-optimize request runs up to 7 sequential/parallel LLM calls; give it
// real headroom instead of the platform's default short function timeout.
export const maxDuration = 60
// Wall for the whole pipeline. It sits inside maxDuration so the route can
// still answer with a JSON error instead of being killed with a gateway page.
const PIPELINE_BUDGET_MS = 52_000
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5'
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60_000
// Deep-optimize costs several times what a normal request does, so it gets
// its own tighter ceiling on top of the base one — both checks apply.
const DEEP_RATE_LIMIT = 5
const DEEP_RATE_WINDOW_MS = 60_000
// Upstream calls a request can make: generate + two judges, or — deep — up to
// two more revise + judge pairs. Charged against the daily budget up front.
const CALLS_NORMAL = 3
const CALLS_DEEP = 7
const DEFAULT_DAILY_CALL_BUDGET = 5_000
// The two text fields together are at most 12k characters; this leaves room
// for JSON escaping and generous slack while refusing anything absurd before
// it is parsed.
const MAX_BODY_CHARS = 64 * 1024

/**
 * Whether the caller gets the Pro-only detail (score breakdown, issues, the
 * first draft). There are no accounts here, so this is a deployment-level
 * switch, decided on the server: OPTIMIZER_PRO=1 grants it, 0 withholds it,
 * and unset means on outside production so local development shows the whole
 * feature. When accounts exist this becomes a per-user check.
 */
function isPro(): boolean {
  const flag = process.env.OPTIMIZER_PRO
  if (flag === '1') return true
  if (flag === '0') return false
  return process.env.NODE_ENV !== 'production'
}

/**
 * Browsers attach Origin to cross-site POSTs and a page on another site cannot
 * forge it, so a mismatch means a third-party page is driving the request —
 * spending this visitor's rate-limit slots and this deployment's key. Callers
 * with no Origin (curl, servers) are not browsers and are left to the limiter.
 */
function isCrossSite(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  const allowed = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  if (origin && allowed.includes(origin)) return false
  if (req.headers.get('sec-fetch-site') === 'cross-site') return true
  if (!origin) return false
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return true
  }
  return host !== (req.headers.get('x-forwarded-host') ?? req.headers.get('host'))
}

/**
 * Reads the body as text but gives up as soon as it passes `max` bytes, so a
 * chunked upload with no (or a false) Content-Length is never buffered whole.
 * Returns null when the limit is exceeded.
 */
async function readBodyLimited(req: NextRequest, max: number): Promise<string | null> {
  if (!req.body) return ''
  const reader = req.body.getReader()
  const decoder = new TextDecoder()
  let received = 0
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    out += decoder.decode(value, { stream: true })
  }
  return out + decoder.decode()
}

/**
 * In the app this was extracted from, the gate on this route was a signed-in
 * user: the OpenRouter key is billable, and the session id was both the
 * authorization and the rate-limit key. This repo has no auth, so the caller is
 * identified by IP instead — the same limit, keyed on the best identifier
 * available here — and a process-wide daily call budget caps total spend.
 *
 * That is weaker on purpose, not by oversight: an IP is shared by everyone
 * behind a NAT and rotated freely by anyone who wants more than 20 calls a
 * minute. Before this is deployed anywhere the key can be spent by the public,
 * put an account check back in front of it (see README).
 */
export async function POST(req: NextRequest) {
  if (isCrossSite(req)) {
    return jsonError('Cross-site requests are not allowed.', 403)
  }
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return jsonError('Send the request as application/json.', 415)
  }
  const declaredLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_CHARS) {
    return jsonError('That request is too large.', 413)
  }
  const text = await readBodyLimited(req, MAX_BODY_CHARS)
  if (text === null) {
    return jsonError('That request is too large.', 413)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return invalidBody()
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return invalidBody()
  }
  // The body is untrusted JSON: every field is checked for its runtime type
  // here, so nothing downstream can be handed a number where it calls .trim().
  const { mode, raw, ctx, model, deepOptimize } = parsed as Record<string, unknown>
  if (typeof mode !== 'string' || !isOptimizerMode(mode)) {
    return jsonError('Unknown mode.', 400)
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    return jsonError('Add a request above.', 400)
  }
  if (raw.length > MAX_RAW_CHARS) {
    return jsonError(
      `That request is too long — keep it under ${MAX_RAW_CHARS.toLocaleString()} characters.`,
      400,
    )
  }
  if (ctx != null && typeof ctx !== 'string') {
    return jsonError('Context must be text.', 400)
  }
  if (typeof ctx === 'string' && ctx.length > MAX_CTX_CHARS) {
    return jsonError(
      `That context is too long — keep it under ${MAX_CTX_CHARS.toLocaleString()} characters.`,
      400,
    )
  }
  if (model != null && typeof model !== 'string') {
    return jsonError('Unsupported model.', 400)
  }
  if (deepOptimize != null && typeof deepOptimize !== 'boolean') {
    return jsonError('deepOptimize must be true or false.', 400)
  }
  const requestedModel = model?.trim()
  if (requestedModel && requestedModel !== DEFAULT_MODEL && !ALLOWED_MODELS.has(requestedModel)) {
    return jsonError('Unsupported model.', 400)
  }
  const key = process.env.OPENROUTER_API_KEY
  if (!key) {
    return notConfigured('Prompt optimization isn’t configured on this server.')
  }
  const ip = getClientIp(req)
  if (!ip) {
    // No trustworthy caller identity: refusing is safer than putting everyone
    // in one shared bucket. See TRUST_PROXY_HEADERS in .env.example.
    console.error(
      'Optimize request refused: no trusted client IP. Deploy on Vercel or set TRUST_PROXY_HEADERS=1 behind a proxy that overwrites x-forwarded-for.',
    )
    return notConfigured('Prompt optimization isn’t available on this server right now.')
  }
  const deep = deepOptimize === true
  // Both buckets are checked before either is charged, so a request refused
  // for the deep limit does not also use up a normal slot.
  const allowed = checkRateLimits([
    { key: `optimize:${ip}`, limit: RATE_LIMIT, windowMs: RATE_WINDOW_MS },
    ...(deep
      ? [{ key: `optimize:deep:${ip}`, limit: DEEP_RATE_LIMIT, windowMs: DEEP_RATE_WINDOW_MS }]
      : []),
  ])
  if (!allowed) {
    return rateLimited()
  }
  const dailyBudget = Number(process.env.OPTIMIZER_DAILY_CALL_BUDGET) || DEFAULT_DAILY_CALL_BUDGET
  if (!consumeBudget(deep ? CALLS_DEEP : CALLS_NORMAL, dailyBudget)) {
    return notConfigured('Prompt optimization is at capacity for today. Try again tomorrow.')
  }
  try {
    const outcome = await runOptimize({
      key,
      mode,
      raw,
      ctx: ctx ?? undefined,
      model: requestedModel || DEFAULT_MODEL,
      deepOptimize: deep,
      deadline: Date.now() + PIPELINE_BUDGET_MS,
    })
    if (!outcome.ok) return outcome.response
    return NextResponse.json(toResponse(outcome.result, isPro()))
  } catch (err) {
    console.error('Optimize request failed:', err)
    return jsonError('The optimizer could not reach the model provider. Try again.', 502)
  }
}
