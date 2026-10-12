'use client'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ScoreSummary, ScoreBreakdown } from '@/lib/optimizer/score'
import type { OptimizeResponse } from '@/lib/optimizer/refine'

interface QualityScoreProps {
  score: ScoreSummary | null
  baseline: ScoreSummary | null
  isPro: boolean
  refinement?: OptimizeResponse['refinement']
}

const CATEGORIES: { key: keyof ScoreBreakdown; label: string }[] = [
  { key: 'specificity', label: 'Specificity' },
  { key: 'completeness', label: 'Completeness' },
  { key: 'clarity', label: 'Clarity' },
  { key: 'structure', label: 'Structure' },
]

/** Three fixed semantic bands — this is a universal metric, not a per-mode one, so it does not borrow the mode's accent color. */
function scoreBand(n: number): { text: string; bg: string } {
  if (n >= 75) return { text: 'text-emerald-400', bg: 'bg-emerald-500/10' }
  if (n >= 50) return { text: 'text-amber-400', bg: 'bg-amber-500/10' }
  return { text: 'text-red-400', bg: 'bg-red-500/10' }
}

function ScorePill({ label, value }: { label: string; value: ScoreSummary | null }) {
  if (!value) {
    return (
      <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        {label}: unavailable
      </span>
    )
  }
  const band = scoreBand(value.score)
  return (
    <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-semibold', band.text, band.bg)}>
      {label} {value.score}/100
    </span>
  )
}

function BreakdownRow({ label, breakdown }: { label: string; breakdown: ScoreBreakdown }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-11 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-1 gap-2">
        {CATEGORIES.map(({ key, label: catLabel }) => (
          <div key={key} className="flex-1" title={`${catLabel}: ${breakdown[key]}/25`}>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/70"
                style={{ width: `${(breakdown[key] / 25) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Always-visible score + delta between the raw request and the optimized
 * result. The category breakdown, issues, and refinement progression are
 * gated behind the `isPro` stub — the score and delta are the "on every
 * output" part of the feature and stay free.
 */
export function QualityScore({ score, baseline, isPro, refinement }: QualityScoreProps) {
  const delta = score && baseline ? score.score - baseline.score : null
  const progression = refinement
    ? [refinement.draft0Score?.score, ...(refinement.iterations ?? []).map((it) => it.score?.score)].filter(
        (v): v is number => typeof v === 'number',
      )
    : []
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <ScorePill label="Before" value={baseline} />
      <ScorePill label="After" value={score} />
      {delta !== null && (
        <span
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold',
            delta > 0
              ? 'bg-emerald-500/10 text-emerald-400'
              : delta < 0
                ? 'bg-red-500/10 text-red-400'
                : 'bg-muted text-muted-foreground',
          )}
        >
          {delta > 0 ? (
            <TrendingUp className="h-3 w-3" />
          ) : delta < 0 ? (
            <TrendingDown className="h-3 w-3" />
          ) : (
            <Minus className="h-3 w-3" />
          )}
          {delta > 0 ? `+${delta}` : delta}
        </span>
      )}
      {!isPro && (
        <span className="text-[11px] text-muted-foreground/70">
          Unlock category breakdown, issues, and the revision diff with Pro.
        </span>
      )}
      {isPro && (
        <div className="mt-1 w-full space-y-2">
          {baseline?.breakdown && <BreakdownRow label="Before" breakdown={baseline.breakdown} />}
          {score?.breakdown && <BreakdownRow label="After" breakdown={score.breakdown} />}
          {score?.issues && score.issues.length > 0 && (
            <ul className="list-inside list-disc space-y-0.5 text-[11px] text-muted-foreground">
              {score.issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}
          {refinement && progression.length > 1 && (
            <p className="text-[11px] text-muted-foreground">
              {refinement.passes} refinement pass
              {refinement.passes === 1 ? '' : 'es'} · {progression.join(' → ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
