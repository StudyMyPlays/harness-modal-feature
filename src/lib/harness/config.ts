/**
 * Everything the harness reads from the environment, in one place.
 *
 * Read on every request rather than once at import, so a test (or a redeploy
 * with new variables) never sees a stale value. Pass `env` explicitly in tests.
 */
export interface HarnessConfig {
  veniceKey: string | null
  /** Server-side allow-list; the client can never request a model outside it. */
  models: string[]
  defaultModel: string
  /** Cheap model for titles and compaction summaries. */
  utilityModel: string
  /** Upstream calls per UTC day for the whole process. */
  dailyBudget: number
  compactAtTokens: number
  passcode: string | null
  sessionSecret: string | null
  /** Explicit opt-out of the passcode requirement in production. */
  isPublic: boolean
  isProduction: boolean
  mcpServersRaw: string | undefined
}

export const DEFAULT_MODELS = ['deepseek-v4-1-flash-1017-uncensored', 'glm-5-3-flash-uncensored']
const DEFAULT_UTILITY_MODEL = 'glm-5-3-flash-uncensored'
const DEFAULT_DAILY_BUDGET = 2000
const DEFAULT_COMPACT_AT_TOKENS = 150_000

function text(value: string | undefined): string | null {
  const t = value?.trim()
  return t ? t : null
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

function list(value: string | undefined): string[] {
  const items = (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set(items)]
}

export type EnvLike = Record<string, string | undefined>

export function getHarnessConfig(env: EnvLike = process.env): HarnessConfig {
  const configured = list(env.HARNESS_MODELS)
  const models = configured.length ? configured : DEFAULT_MODELS
  const requestedDefault = text(env.HARNESS_DEFAULT_MODEL)
  const defaultModel =
    requestedDefault && models.includes(requestedDefault) ? requestedDefault : models[0]
  return {
    veniceKey: text(env.VENICE_API_KEY),
    models,
    defaultModel,
    utilityModel: text(env.HARNESS_UTILITY_MODEL) ?? DEFAULT_UTILITY_MODEL,
    dailyBudget: positiveInt(env.HARNESS_DAILY_CALL_BUDGET, DEFAULT_DAILY_BUDGET),
    compactAtTokens: positiveInt(env.COMPACT_AT_TOKENS, DEFAULT_COMPACT_AT_TOKENS),
    passcode: text(env.HARNESS_PASSCODE),
    sessionSecret: text(env.HARNESS_SESSION_SECRET),
    isPublic: env.HARNESS_PUBLIC === '1',
    isProduction: env.NODE_ENV === 'production',
    mcpServersRaw: env.MCP_SERVERS,
  }
}
