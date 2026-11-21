import { invalidBody, jsonError } from '@/lib/api-response'

/**
 * Browsers attach Origin to cross-site POSTs and a page on another site cannot
 * forge it, so a mismatch means a third-party page is driving the request —
 * spending this visitor's rate-limit slots and this deployment's key. Callers
 * with no Origin (curl, servers) are not browsers and are left to the limiter.
 */
export function isCrossSite(req: Request): boolean {
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
 */
async function readBodyLimited(req: Request, max: number): Promise<string | null> {
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

/** A JSON body, checked for content type and size before it is parsed. */
export async function readJsonBody(
  req: Request,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return { ok: false, response: jsonError('Send the request as application/json.', 415) }
  }
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, response: jsonError('That request is too large.', 413) }
  }
  const text = await readBodyLimited(req, maxBytes)
  if (text === null) return { ok: false, response: jsonError('That request is too large.', 413) }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, response: invalidBody() }
  }
}
