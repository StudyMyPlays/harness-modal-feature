import { NextResponse, type NextRequest } from 'next/server'
import { invalidBody, jsonError } from '@/lib/api-response'
import { guardRequest } from '@/lib/harness/guard'
import { readJsonBody } from '@/lib/harness/http'
import { COMPACT_PROMPT } from '@/lib/harness/prompts'
import { compactRequestSchema } from '@/lib/harness/schemas'
import { runUtilityCall } from '@/lib/harness/utility'

export const runtime = 'nodejs'
export const maxDuration = 120

/** A summary of older turns, which the client stores and sends in their place. */
export async function POST(req: NextRequest) {
  const guard = await guardRequest(req, { name: 'compact', limit: 10, windowMs: 60_000, budgetUnits: 1 })
  if (!guard.ok) return guard.response
  const body = await readJsonBody(req, 4_400_000)
  if (!body.ok) return body.response
  const parsed = compactRequestSchema.safeParse(body.value)
  if (!parsed.success) return invalidBody('Send { messages } with text content only.')

  const result = await runUtilityCall(guard.cfg, req.signal, {
    messages: [{ role: 'system', content: COMPACT_PROMPT }, ...parsed.data.messages],
    maxTokens: 4000,
    timeoutMs: 100_000,
    feature: 'Compaction',
  })
  if (!result.ok) return result.response
  const summary = result.text.trim()
  if (!summary) return jsonError('The model returned an empty summary.', 502)
  return NextResponse.json({ summary })
}
