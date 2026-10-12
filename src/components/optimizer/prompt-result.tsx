'use client'
import { useEffect, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, RotateCw, Check, Copy, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty'
import { cn } from '@/lib/utils'
import { copyToClipboard } from '@/lib/clipboard'
import { MODES, MODE_ACCENT, type OptimizerMode } from '@/lib/optimizer/optimizer'
import { QualityScore } from '@/components/optimizer/quality-score'
import { BeforeAfterDiff } from '@/components/optimizer/before-after-diff'
import type { OptimizeResponse } from '@/lib/optimizer/refine'
export type PromptStatus = 'idle' | 'loading' | 'success' | 'error'
interface PromptResultProps {
  status: PromptStatus
  mode: OptimizerMode
  prompt?: string
  /** The finished response, tied to `mode` by the caller. */
  data?: OptimizeResponse
  error?: string
  onRetry?: () => void
  onReset?: () => void
}
/**
 * Lines that read as a labelled key rather than a heading or a bullet: Comet's
 * approval rules, ChatGPT's numbered tasks, and the input/output pairs of a
 * Gem's few-shot examples. They get the label in accent small-caps and the
 * value in body type, so the structure of the block survives the paste-preview.
 */
const SUBKEY = /^(Ask before:|Auto-proceed for:|TASK \d+:|Input:|Output:)/
/**
 * Renders the optimized output with structure-aware formatting: section
 * headings (bare caps for the task and Project modes, "# Heading" for Gems),
 * "- " bullets, labelled sub-keys, and ⚠️ highlights.
 */
function OutputBlock({ text, mode }: { text: string; mode: OptimizerMode }) {
  const headings = MODES[mode].headings
  const accent = MODE_ACCENT[mode]
  const lines = text.split('\n')
  return (
    <div className="flex flex-col">
      {lines.map((line, i) => {
        const trimmed = line.trim()
        // A "# Heading" is a heading whether or not the model matched the
        // canonical wording — falling through to body type would flatten the
        // one structural cue a Gem block has.
        const isHeading = headings.has(trimmed) || /^#{1,3} \S/.test(trimmed)
        const isBullet = line.startsWith('- ')
        const isSubkey = SUBKEY.test(line)
        const hasWarn = line.includes('⚠️')
        if (isHeading) {
          return (
            <div
              key={i}
              className={cn(
                'flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.13em]',
                accent.heading,
                i === 0 ? 'mt-0' : 'mt-5',
                'mb-2',
              )}
            >
              {trimmed.replace(/^#{1,3} /, '')}
              <span className={cn('h-px flex-1', accent.rule)} />
            </div>
          )
        }
        if (isBullet) {
          return (
            <div key={i} className="mb-1 flex gap-2.5 pl-0.5">
              <span className="mt-px shrink-0 font-mono text-[13px] leading-[1.65] text-primary/70">
                –
              </span>
              <span
                className={cn(
                  'font-mono text-[13.5px] font-light leading-[1.65]',
                  hasWarn ? accent.warn : 'text-foreground/90',
                )}
              >
                {line.slice(2)}
              </span>
            </div>
          )
        }
        if (isSubkey) {
          const ci = line.indexOf(':')
          return (
            <div key={i} className="mb-1 pl-0.5">
              <span className={cn('font-mono text-[10px] font-semibold uppercase tracking-[0.1em]', accent.subkey)}>
                {line.slice(0, ci + 1)}
              </span>
              <span
                className={cn(
                  'font-mono text-[13.5px] font-light leading-[1.65]',
                  hasWarn ? accent.warn : 'text-foreground/90',
                )}
              >
                {line.slice(ci + 1)}
              </span>
            </div>
          )
        }
        if (trimmed === '') return <div key={i} className="h-1" />
        return (
          <div
            key={i}
            className={cn(
              'mb-0.5 font-mono text-[13.5px] font-light leading-[1.68]',
              hasWarn ? accent.warn : 'text-foreground/90',
            )}
          >
            {line}
          </div>
        )
      })}
    </div>
  )
}
export function PromptResult({
  status,
  mode,
  prompt,
  data,
  error,
  onRetry,
  onReset,
}: PromptResultProps) {
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
  }, [])
  const cfg = MODES[mode]
  const accent = MODE_ACCENT[mode]
  const result = data?.text
  const refinement = data?.refinement
  // Via the shared helper, which falls back to execCommand where the async
  // clipboard API is unavailable (insecure context, older Safari) and reports
  // failure instead of rejecting. The raw `.writeText().then()` this replaced
  // dropped its rejection: a denied clipboard left the button reading "Copy"
  // forever with nothing said about why.
  const handleCopy = async () => {
    if (!result) return
    if (!(await copyToClipboard(result))) return
    setCopied(true)
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div
      aria-live="polite"
      aria-busy={status === 'loading'}
      className="w-full max-w-4xl mx-auto"
    >
      {status === 'loading' && (
        <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
          <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-lg">
            <div className="flex items-center gap-2 mb-4">
              <Skeleton className="h-7 w-7 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </div>
            <div className="space-y-3">
              <Skeleton className="shimmer h-4 w-[92%]" />
              <Skeleton className="shimmer h-4 w-[78%]" />
              <Skeleton className="shimmer h-4 w-[85%]" />
              <Skeleton className="shimmer h-4 w-[60%]" />
            </div>
          </div>
        </div>
      )}
      {status === 'success' && data && result && (
        <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
          <div
            className={cn(
              'group relative overflow-hidden rounded-2xl border border-white/10 p-5',
              'bg-gradient-to-b from-white/[0.04] to-transparent bg-card',
              'shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_18px_40px_-24px_rgba(0,0,0,0.9)]',
              'transition-all duration-300 hover:border-white/20',
            )}
          >
            <div
              aria-hidden="true"
              className={cn('pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent', accent.hairline)}
            />
            <div className="mb-4 flex items-center gap-2.5">
              <span className="relative flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-white/[0.03]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground shadow-[0_0_8px_2px] shadow-foreground/40" />
              </span>
              <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em]', accent.badge)}>
                {cfg.readyLabel}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 px-2.5 text-xs"
                  onClick={handleCopy}
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </>
                  )}
                </Button>
                {/* Copying is only half the job for a workspace block — it has
                    to land in the Project or Gem settings screen to do
                    anything, so the card offers the door. */}
                {cfg.destination && (
                  <Button asChild size="sm" variant="ghost" className="h-7 gap-1.5 px-2.5 text-xs">
                    <a
                      href={cfg.destination.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {cfg.destination.label}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                )}
                {onReset && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2.5 text-xs text-muted-foreground"
                    onClick={onReset}
                  >
                    Reset
                  </Button>
                )}
              </div>
            </div>
            {prompt && (
              <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">
                Request: {prompt}
              </p>
            )}
            {data.truncated && (
              <p
                role="alert"
                className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-300"
              >
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                This output hit the length limit and is cut off. Don’t paste it as is — shorten the request or try again.
              </p>
            )}
            {(data.score || data.baseline) && (
              <QualityScore
                score={data.score}
                baseline={data.baseline}
                isPro={data.pro}
                refinement={refinement}
              />
            )}
            {refinement?.notice && (
              <p className="mb-3 text-xs text-amber-400/90">{refinement.notice}</p>
            )}
            <OutputBlock text={result} mode={mode} />
            {refinement?.applied && (
              <BeforeAfterDiff before={refinement.draft0} after={result} isPro={data.pro} />
            )}
            <p className="mt-4 text-xs font-light leading-relaxed text-muted-foreground/80">
              {cfg.tip}
            </p>
          </div>
        </div>
      )}
      {status === 'error' && (
        <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
          <Empty className="border border-dashed border-destructive/40 bg-destructive/5">
            <EmptyHeader>
              <EmptyMedia
                variant="icon"
                className="bg-destructive/10 text-destructive"
              >
                <AlertCircle />
              </EmptyMedia>
              <EmptyTitle>Optimization failed</EmptyTitle>
              <EmptyDescription>
                {error || 'Something went wrong. Please try again.'}
              </EmptyDescription>
            </EmptyHeader>
            {onRetry && (
              <EmptyContent>
                <Button variant="outline" onClick={onRetry} className="gap-2">
                  <RotateCw className="h-4 w-4" />
                  Try again
                </Button>
              </EmptyContent>
            )}
          </Empty>
        </div>
      )}
    </div>
  )
}
