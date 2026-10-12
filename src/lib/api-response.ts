import { NextResponse } from 'next/server'

/**
 * The shapes every API route here answers failures with.
 *
 * The body is always `{ error }` — that is what the client reads, so the shape
 * is fixed here rather than re-asserted per call site.
 */
export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/** 429. */
export function rateLimited() {
  return jsonError('Too many requests. Try again in a minute.', 429)
}

/** 400, for a body that would not parse as JSON. */
export function invalidBody(message = 'Invalid request body.') {
  return jsonError(message, 400)
}

/** 401, for a route that needs a signed-in caller. */
export function unauthorized(message = 'You must be signed in.') {
  return jsonError(message, 401)
}

/**
 * 503, for a feature whose server-side credentials are absent. Distinct from a
 * failure: nothing is wrong with the request, the deployment just cannot serve
 * it, and the client shows that differently.
 */
export function notConfigured(message: string) {
  return jsonError(message, 503)
}
