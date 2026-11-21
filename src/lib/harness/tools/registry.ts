import type { LlmToolCall, ToolSpec } from '../llm/types'

/**
 * The tool seam (DeepSeek Harness's `core/tools` + `tool-executor-native`).
 * A tool is a spec the model sees and a function the server runs.
 */
export interface HarnessTool {
  spec: ToolSpec
  execute(args: unknown, ctx: { signal: AbortSignal }): Promise<string>
}

export interface ToolRegistry {
  specs(): ToolSpec[]
  get(name: string): HarnessTool | undefined
}

export interface ToolResult {
  ok: boolean
  content: string
  truncated: boolean
}

export function createToolRegistry(tools: HarnessTool[]): ToolRegistry {
  const byName = new Map<string, HarnessTool>()
  for (const t of tools) {
    if (byName.has(t.spec.name)) throw new Error(`Duplicate tool name: ${t.spec.name}`)
    byName.set(t.spec.name, t)
  }
  return {
    specs: () => [...byName.values()].map((t) => t.spec),
    get: (name) => byName.get(name),
  }
}

const fail = (content: string): ToolResult => ({ ok: false, content, truncated: false })

/**
 * Runs one tool call and reports the outcome as data the model can read.
 * It never throws: a broken tool, bad arguments or a timeout become a failed
 * result, so the turn continues and the model can recover.
 */
export async function executeToolCall(
  registry: ToolRegistry,
  call: LlmToolCall,
  opts: { signal: AbortSignal; timeoutMs?: number; maxChars?: number },
): Promise<ToolResult> {
  const timeoutMs = opts.timeoutMs ?? 20_000
  const maxChars = opts.maxChars ?? 16_000
  const tool = registry.get(call.function.name)
  if (!tool) return fail(`Unknown tool: ${call.function.name}`)

  let args: unknown
  try {
    args = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {}
  } catch (err) {
    return fail(`Invalid JSON arguments: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (opts.signal.aborted) return fail('Cancelled')

  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort(opts.signal.reason)
  opts.signal.addEventListener('abort', onAbort, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined

  const timedOut = Symbol('timeout')
  const cancelled = Symbol('cancelled')
  try {
    const outcome = await Promise.race([
      tool.execute(args, { signal: ctrl.signal }),
      new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), timeoutMs)
      }),
      new Promise<typeof cancelled>((resolve) => {
        ctrl.signal.addEventListener('abort', () => resolve(cancelled), { once: true })
      }),
    ])
    if (outcome === timedOut) {
      ctrl.abort(new Error('timeout'))
      return fail(`Tool timed out after ${Math.round(timeoutMs / 1000)}s`)
    }
    if (outcome === cancelled) return fail('Cancelled')
    const content = String(outcome)
    if (content.length <= maxChars) return { ok: true, content, truncated: false }
    return {
      ok: true,
      content: `${content.slice(0, maxChars)}\n[truncated: ${content.length - maxChars} more characters]`,
      truncated: true,
    }
  } catch (err) {
    if (opts.signal.aborted) return fail('Cancelled')
    return fail(`Tool failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timer)
    opts.signal.removeEventListener('abort', onAbort)
  }
}
