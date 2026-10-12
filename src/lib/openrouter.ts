import { jsonError } from '@/lib/api-response'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Upstream failures are mapped to a small set of our own messages. OpenRouter's
 * text routinely names account state ("insufficient credits", key prefixes,
 * org-level limits), and returning it verbatim leaked that to any caller.
 *
 * `feature` names the surface the caller is using, so the sentence reads for
 * whichever route hit the failure.
 */
export function upstreamMessage(status: number, feature = 'The request'): string {
  if (status === 401 || status === 403) return `${feature} could not authenticate with the model provider.`
  if (status === 402) return `${feature} is temporarily unavailable. Please try again later.`
  if (status === 429) return `${feature} is busy right now. Try again in a moment.`
  if (status >= 500) return 'The model provider is having trouble. Try again in a moment.'
  return `${feature} could not process that request.`
}

/**
 * The status we answer with, which is not the status we received.
 *
 * A 401 or 403 from OpenRouter means *our* key is wrong — a server
 * misconfiguration. Relaying it unchanged told the browser the caller was
 * unauthenticated, which is what a client-side interceptor reads as "your
 * session expired", so a billing problem on the server presented as a sign-out.
 * Anything upstream that isn't the caller's fault is reported as a bad gateway.
 */
export function downstreamStatus(status: number): number {
  if (status === 429) return 429
  return 502
}

export function stripFences(text: string): string {
  return text
    .replace(/^```[^\n]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim()
}

export interface OpenRouterRequest {
  key: string
  model: string
  messages: ChatMessage[]
  maxTokens: number
  /** Set `{ type: 'json_object' }` when the caller is going to JSON.parse the reply. */
  responseFormat?: { type: 'json_object' }
  /**
   * Hard ceiling for this call. A hung provider otherwise holds the request
   * until the platform kills the whole function, and the browser then gets a
   * gateway page instead of one of our errors.
   */
  timeoutMs: number
}

export type OpenRouterResult =
  /**
   * `truncated` is true when the provider stopped because it hit `max_tokens`.
   * A reply cut off mid-object never parses, and without this the caller could
   * only report it as "unusable" — sending an admin to retry a call that will
   * be cut off at exactly the same place.
   */
  | { ok: true; text: string; truncated: boolean }
  /** OpenRouter answered with an error status. */
  | { ok: false; reason: 'upstream'; status: number }
  /** OpenRouter answered 200 with no content — a different failure, and not the provider's fault in the way a 5xx is. */
  | { ok: false; reason: 'empty' }
  /** The call outlived `timeoutMs` and was aborted. */
  | { ok: false; reason: 'timeout' }

/**
 * One call to OpenRouter, with the response reduced to "text, or the status
 * that went wrong". Callers map that status through `upstreamMessage` and
 * `downstreamStatus` rather than reading the upstream body themselves — the
 * body is exactly what must not reach a client.
 *
 * Throws only on transport failure, which the caller reports as a bad gateway.
 * A timeout is not a throw: it comes back as `reason: 'timeout'`.
 */
export async function callOpenRouter(req: OpenRouterRequest): Promise<OpenRouterResult> {
  // Attribution is configured by whoever deploys the app. It used to echo the
  // caller's own Origin header, which any client could set to anything.
  const siteUrl = process.env.OPENROUTER_SITE_URL
  let res: Response
  try {
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${req.key}`,
        ...(siteUrl ? { 'HTTP-Referer': siteUrl } : {}),
        'X-Title': 'Promptful',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        ...(req.responseFormat ? { response_format: req.responseFormat } : {}),
        messages: req.messages,
      }),
      signal: AbortSignal.timeout(Math.max(1, req.timeoutMs)),
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return { ok: false, reason: 'timeout' }
    }
    throw err
  }
  // A gateway in front of the provider can answer with an HTML error page;
  // that is an upstream failure, not a reason to throw.
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    console.error('OpenRouter error:', res.status, data?.error?.message ?? data?.error)
    return { ok: false, reason: 'upstream', status: res.status }
  }
  const choice = data?.choices?.[0]
  const text: string = choice?.message?.content ?? ''
  if (!text.trim()) return { ok: false, reason: 'empty' }
  return {
    ok: true,
    text,
    truncated: choice?.finish_reason === 'length' || choice?.native_finish_reason === 'max_tokens',
  }
}

/**
 * The failed half of `callOpenRouter`, turned into the response we answer with.
 *
 * `feature` is the subject of the sentence the caller sees, e.g. "The
 * optimizer".
 */
export function openRouterErrorResponse(
  result: Extract<OpenRouterResult, { ok: false }>,
  feature: string,
) {
  if (result.reason === 'empty') {
    return jsonError('The model returned an empty response. Try again.', 502)
  }
  if (result.reason === 'timeout') {
    return jsonError('The model provider took too long to answer. Try again.', 504)
  }
  return jsonError(upstreamMessage(result.status, feature), downstreamStatus(result.status))
}
