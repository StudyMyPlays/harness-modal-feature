import { NextResponse, type NextRequest } from 'next/server'
import { invalidBody, jsonError } from '@/lib/api-response'
import { guardRequest } from '@/lib/harness/guard'
import { readJsonBody } from '@/lib/harness/http'
import { TITLE_PROMPT, sanitizeTitle } from '@/lib/harness/prompts'
import { titleRequestSchema } from '@/lib/harness/schemas'
import { runUtilityCall } from '@/lib/harness/utility'

export const runtime = 'nodejs'
export const maxDuration = 30

const MAX_TEXT = 2000

/** A short title for a new chat, from its first exchange. */
export async function POST(req: NextRequest) {
  const guard = await guardRequest(req, { name: 'title', limit: 20, windowMs: 60_000, budgetUnits: 1 })
  if (!guard.ok) return guard.response
  const body = await readJsonBody(req, 64 * 1024)
  if (!body.ok) return body.response
  const parsed = titleRequestSchema.safeParse(body.value)
  if (!parsed.success) return invalidBody('Send { userText, assistantText }.')

  const conversation = `User: ${parsed.data.userText.slice(0, MAX_TEXT)}\n\nAssistant: ${parsed.data.assistantText.slice(0, MAX_TEXT)}`
  const result = await runUtilityCall(guard.cfg, req.signal, {
    messages: [
      { role: 'system', content: TITLE_PROMPT },
      { role: 'user', content: conversation },
    ],
    maxTokens: 30,
    temperature: 0.3,
    timeoutMs: 20_000,
    feature: 'The title',
  })
  if (!result.ok) return result.response
  const title = sanitizeTitle(result.text)
  if (!title) return jsonError('The model returned no title.', 502)
  return NextResponse.json({ title })
}
