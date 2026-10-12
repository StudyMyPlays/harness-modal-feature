import { NextResponse } from 'next/server'
import { callOpenRouter, openRouterErrorResponse, stripFences } from '@/lib/openrouter'
import { MODES, buildUserContent, type OptimizerMode, type ModeConfig } from '@/lib/optimizer/optimizer'
import { judgeText, type QualityScore, type ScoreSummary } from '@/lib/optimizer/score'

/**
 * Fixed at two passes, not user-adjustable in this pass. Each pass is a
 * revise + judge call, so this already doubles the call count of an opted-in
 * request — a knob for "how many" is a later refinement, not a launch need.
 */
const REFINE_ITERATIONS = 2

/** Ceilings for a single upstream call, before the overall deadline trims them. */
const GENERATE_TIMEOUT_MS = 40_000
const JUDGE_TIMEOUT_MS = 15_000
/** A revise pass is a write plus a judge; don't start one that cannot finish. */
const MIN_REVISE_BUDGET_MS = 20_000
/** Below this a judge call would just time out, so it is skipped. */
const MIN_JUDGE_BUDGET_MS = 2_000

export interface RefinementIteration {
  score: ScoreSummary | null
}

export interface OptimizeResult {
  text: string
  score: QualityScore | null
  baseline: QualityScore | null
  /** The shipped text was cut off by the output-token cap. */
  truncated: boolean
  /** Present only when deepOptimize ran. */
  refinement?: {
    draft0: string
    draft0Score: QualityScore | null
    iterations: { score: QualityScore | null }[]
    /** Why the loop stopped before REFINE_ITERATIONS, or what it did instead. */
    notice?: string
  }
}

/** What goes over the wire. `pro` decides how much of the detail is included. */
export interface OptimizeResponse {
  text: string
  truncated: boolean
  /** Whether this response carries the Pro-only detail. The client renders from this, not from its own flag. */
  pro: boolean
  score: ScoreSummary | null
  baseline: ScoreSummary | null
  refinement?: {
    /** The final text differs from the first draft. */
    applied: boolean
    passes: number
    notice?: string
    draft0?: string
    draft0Score?: ScoreSummary | null
    iterations?: RefinementIteration[]
  }
}

function summarize(score: QualityScore | null, pro: boolean): ScoreSummary | null {
  if (!score) return null
  return pro ? score : { score: score.score }
}

/**
 * Shapes a result for a caller. Entitlement is decided here, on the server: the
 * breakdown, the issues list and the first draft are left out of the response
 * entirely for a caller who is not entitled to them, rather than sent and
 * hidden by the UI.
 */
export function toResponse(result: OptimizeResult, pro: boolean): OptimizeResponse {
  const { refinement } = result
  return {
    text: result.text,
    truncated: result.truncated,
    pro,
    score: summarize(result.score, pro),
    baseline: summarize(result.baseline, pro),
    ...(refinement
      ? {
          refinement: {
            applied: refinement.draft0 !== result.text,
            passes: refinement.iterations.length,
            ...(refinement.notice ? { notice: refinement.notice } : {}),
            ...(pro
              ? {
                  draft0: refinement.draft0,
                  draft0Score: summarize(refinement.draft0Score, true),
                  iterations: refinement.iterations.map((it) => ({ score: summarize(it.score, true) })),
                }
              : {}),
          },
        }
      : {}),
  }
}

/**
 * Appended to, not substituted for, the mode's own system prompt — the
 * mode's OUTPUT FORMAT / OUTPUT RULES / ⚠️ convention must still apply to the
 * revised draft, or a revision "fixes" the content while breaking the shape
 * the renderer and the user's paste target both depend on.
 */
function buildReviseSystem(cfg: ModeConfig, issues: string[]): string {
  return `${cfg.system}

# REVISION MODE
You already wrote a draft for this request below. A separate reviewer scored it and found issues. Revise the draft to fix every issue listed while keeping the exact same OUTPUT FORMAT and OUTPUT RULES given above. Do not restart from scratch — keep what already works and change only what the issues call out.
ISSUES TO FIX
${issues.length ? issues.map((i) => `- ${i}`).join('\n') : '- (none — make only small clarity or specificity improvements)'}
Output ONLY the revised draft, in the same format as the original. No commentary about what changed.`
}

/**
 * Whether a revision should replace the draft held so far. A scored draft
 * beats an unscored one, so a judge hiccup cannot demote a good draft; when
 * neither can be scored there is nothing to compare, so the newer one wins.
 * A tie keeps the incumbent: the revision earned nothing.
 */
function isBetter(candidate: QualityScore | null, incumbent: QualityScore | null): boolean {
  if (!candidate) return !incumbent
  if (!incumbent) return true
  return candidate.score > incumbent.score
}

/**
 * Owns the whole optimize call sequence, so the route stays a thin HTTP
 * wrapper — the same split `openrouter.ts` (transport) and `route.ts` (HTTP)
 * already have.
 *
 * Only the initial generate call is fail-hard, matching the single-call
 * behaviour this replaces. Every judge and revise call after it is
 * best-effort: a judge failure degrades a score to null rather than failing
 * a request that already has a usable draft, and a revise failure stops the
 * refinement loop early and returns the best draft so far instead of erroring
 * out from under a user who was about to get a working result.
 *
 * `deadline` is an epoch-ms wall: every call is trimmed to what is left, and
 * a refinement pass that could not finish before it is not started. The
 * platform kills the function at its own limit with no JSON body, so the
 * deadline sits safely inside it.
 */
export async function runOptimize(args: {
  key: string
  mode: OptimizerMode
  raw: string
  ctx?: string
  model: string
  deepOptimize: boolean
  deadline: number
}): Promise<{ ok: true; result: OptimizeResult } | { ok: false; response: NextResponse }> {
  const { key, mode, raw, ctx, model, deepOptimize, deadline } = args
  const cfg = MODES[mode]
  const userContent = buildUserContent(raw, ctx, cfg.contextLabel)
  const remaining = () => deadline - Date.now()
  const judge = (text: string): Promise<QualityScore | null> =>
    remaining() < MIN_JUDGE_BUDGET_MS
      ? Promise.resolve(null)
      : judgeText({ key, text, timeoutMs: Math.min(JUDGE_TIMEOUT_MS, remaining()) })

  // The raw-input score never depends on the generated draft, so it runs
  // alongside the generate call instead of after it — free scoring latency.
  const [generateResult, baseline] = await Promise.all([
    callOpenRouter({
      key,
      model,
      maxTokens: cfg.maxTokens,
      timeoutMs: Math.min(GENERATE_TIMEOUT_MS, remaining()),
      messages: [
        { role: 'system', content: cfg.system },
        { role: 'user', content: userContent },
      ],
    }),
    judge(raw),
  ])

  if (!generateResult.ok) {
    return { ok: false, response: openRouterErrorResponse(generateResult, 'The optimizer') }
  }

  const draft0 = stripFences(generateResult.text)
  const draft0Score = await judge(draft0)

  if (!deepOptimize) {
    return {
      ok: true,
      result: { text: draft0, score: draft0Score, baseline, truncated: generateResult.truncated },
    }
  }

  // The best draft so far, not the latest: a revision that scores lower, or
  // that the judge could not score, must not replace one that did better.
  let best = { text: draft0, score: draft0Score, truncated: generateResult.truncated }
  const iterations: { score: QualityScore | null }[] = []
  let notice: string | undefined

  for (let i = 0; i < REFINE_ITERATIONS; i++) {
    if (remaining() < MIN_REVISE_BUDGET_MS) {
      notice = `Stopped after ${i} of ${REFINE_ITERATIONS} refinement passes — there was not enough time left for another.`
      break
    }
    // The judge's own issues list from the previous pass IS the critique —
    // no separate critique call needed.
    const issues = best.score?.issues ?? []
    const reviseResult = await callOpenRouter({
      key,
      model,
      maxTokens: cfg.maxTokens,
      timeoutMs: Math.min(GENERATE_TIMEOUT_MS, remaining()),
      messages: [
        { role: 'system', content: buildReviseSystem(cfg, issues) },
        { role: 'user', content: `${userContent}\n\nPREVIOUS DRAFT:\n${best.text}` },
      ],
    })
    if (!reviseResult.ok) {
      notice = `Stopped after ${i} of ${REFINE_ITERATIONS} refinement passes — the reviser was unavailable.`
      break
    }
    if (reviseResult.truncated) {
      // A revision that hit the token cap is cut off mid-section; keeping the
      // complete draft is better than shipping it.
      notice = `Stopped after ${i} of ${REFINE_ITERATIONS} refinement passes — the revised draft was cut off, so it was discarded.`
      break
    }
    const revised = stripFences(reviseResult.text)
    const revisedScore = await judge(revised)
    iterations.push({ score: revisedScore })
    if (!isBetter(revisedScore, best.score)) {
      notice = 'A further pass did not improve the score, so the best draft was kept.'
      break
    }
    best = { text: revised, score: revisedScore, truncated: false }
  }

  return {
    ok: true,
    result: {
      text: best.text,
      score: best.score,
      baseline,
      truncated: best.truncated,
      refinement: { draft0, draft0Score, iterations, notice },
    },
  }
}
