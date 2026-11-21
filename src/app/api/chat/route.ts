import type { NextRequest } from 'next/server'
import { invalidBody, jsonError } from '@/lib/api-response'
import { runAgentLoop } from '@/lib/harness/agent-loop'
import { getModelCatalog, type ModelInfo } from '@/lib/harness/catalog'
import { guardRequest } from '@/lib/harness/guard'
import { readJsonBody } from '@/lib/harness/http'
import { withRetry } from '@/lib/harness/llm/retry'
import type { LlmMessage } from '@/lib/harness/llm/types'
import { createVeniceAdapter } from '@/lib/harness/llm/venice'
import { harnessPreamble } from '@/lib/harness/prompts'
import { eventsToResponse } from '@/lib/harness/protocol'
import { chatRequestSchema, type ChatRequest } from '@/lib/harness/schemas'
import { loadMcpTools, parseMcpServers } from '@/lib/harness/tools/mcp'
import { createToolRegistry } from '@/lib/harness/tools/registry'
import { consumeBudget } from '@/lib/rate-limit'

export const runtime = 'nodejs'
// A turn can run several model calls and tools. 300 s is the Vercel ceiling
// for Hobby with Fluid compute (vercel.com/docs/functions/configuring-functions/duration);
// lower it if the project's plan allows less.
export const maxDuration = 300
// The loop stops itself before the platform does, so the browser gets a
// `done` instead of a dropped connection.
const DEADLINE_MARGIN_MS = 8_000
// Vercel refuses request bodies over 4.5 MB before the function runs.
const MAX_BODY_BYTES = 4_400_000

function hasImages(messages: LlmMessage[]): boolean {
  return messages.some(
    (m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'),
  )
}

/**
 * One chat turn. The browser sends the projected history; the server runs the
 * agent loop against Venice and streams typed events back. Nothing is stored
 * here: the session log lives with the client.
 */
export async function POST(req: NextRequest) {
  const guard = await guardRequest(req, { name: 'chat', limit: 20, windowMs: 60_000, budgetUnits: 1 })
  if (!guard.ok) return guard.response
  const { cfg } = guard

  const body = await readJsonBody(req, MAX_BODY_BYTES)
  if (!body.ok) return body.response
  const parsed = chatRequestSchema.safeParse(body.value)
  if (!parsed.success) return invalidBody(parsed.error.issues[0]?.message ?? 'Invalid request body.')
  const { model, messages, settings } = parsed.data as ChatRequest

  if (!cfg.models.includes(model)) return jsonError('Unsupported model.', 400)
  if (messages.slice(1).some((m) => m.role === 'system')) {
    return invalidBody('Only the first message may be a system message.')
  }

  let info: ModelInfo | undefined
  try {
    info = (await getModelCatalog({ key: cfg.veniceKey!, allow: [model] }))[0]
  } catch (err) {
    console.error('Model catalog unavailable; chatting without pricing.', err)
  }
  if (info && !info.supportsVision && hasImages(messages)) {
    return jsonError('This model can’t read images.', 400)
  }
  const reasoningEffort =
    settings.reasoningEffort && info?.reasoningEffortOptions.includes(settings.reasoningEffort)
      ? settings.reasoningEffort
      : undefined

  const servers = parseMcpServers(cfg.mcpServersRaw)
  const { tools } = await loadMcpTools(servers, settings.mcpServers)
  const registry = createToolRegistry(tools)

  const clientSystem = messages[0].role === 'system' ? messages[0].content.trim() : ''
  const preamble = harnessPreamble({
    now: new Date(),
    webSearch: settings.webSearch,
    toolNames: tools.map((t) => t.spec.name),
  })
  const history = messages[0].role === 'system' ? messages.slice(1) : messages
  const system: LlmMessage = { role: 'system', content: clientSystem ? `${clientSystem}\n\n${preamble}` : preamble }

  let firstStep = true
  const events = runAgentLoop({
    adapter: withRetry(createVeniceAdapter({ key: cfg.veniceKey! })),
    request: {
      model,
      messages: [system, ...history],
      webSearch: settings.webSearch,
      includeVeniceSystemPrompt: settings.includeVeniceSystemPrompt,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
    },
    tools: registry,
    signal: req.signal,
    deadline: Date.now() + maxDuration * 1000 - DEADLINE_MARGIN_MS,
    pricing: info?.pricing ?? null,
    // The guard paid for the first call; every further step costs one more.
    beforeStep: () => {
      if (firstStep) {
        firstStep = false
        return true
      }
      return consumeBudget(1, cfg.dailyBudget)
    },
  })
  return eventsToResponse(events)
}
