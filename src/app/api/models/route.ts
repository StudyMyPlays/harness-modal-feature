import { NextResponse, type NextRequest } from 'next/server'
import { jsonError } from '@/lib/api-response'
import { getModelCatalog } from '@/lib/harness/catalog'
import { guardRequest } from '@/lib/harness/guard'
import { LlmError } from '@/lib/harness/llm/types'
import { downstreamStatus, upstreamMessage } from '@/lib/harness/llm/venice'

export const runtime = 'nodejs'

/** The allow-listed models with capabilities and prices, plus the defaults the client needs. */
export async function GET(req: NextRequest) {
  const guard = await guardRequest(req, { name: 'models', limit: 60, windowMs: 60_000, budgetUnits: 0 })
  if (!guard.ok) return guard.response
  const { cfg } = guard
  try {
    const models = await getModelCatalog({ key: cfg.veniceKey!, allow: cfg.models })
    return NextResponse.json({
      models,
      defaultModel: cfg.defaultModel,
      utilityModel: cfg.utilityModel,
      compactAtTokens: cfg.compactAtTokens,
    })
  } catch (err) {
    const status = err instanceof LlmError && err.status !== undefined ? err.status : 502
    return jsonError(upstreamMessage(status, 'The model list'), downstreamStatus(status))
  }
}
