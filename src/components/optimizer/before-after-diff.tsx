'use client'
import { useMemo, useState } from 'react'
import { diffWords } from 'diff'
import { ChevronDown, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BeforeAfterDiffProps {
  /** Pre-refinement draft (draft0). Absent when the server withheld it. */
  before?: string
  /** Final draft after Deep Optimize's revision passes. */
  after: string
  isPro: boolean
}

/**
 * Word-level diff between the pre- and post-refinement drafts. Only ever
 * compares two drafts of the same mode's template, not the raw input against
 * the output — those are structurally unrelated texts and a word diff
 * between them would be almost entirely "added," which shows nothing useful.
 * This view exists to show what the self-critique loop actually changed.
 */
export function BeforeAfterDiff({ before, after, isPro }: BeforeAfterDiffProps) {
  const [expanded, setExpanded] = useState(false)
  // Only diffed once opened, and only when there is something real to show:
  // a caller who is not entitled never receives the first draft at all, so the
  // locked view below is a placeholder, not the real text behind a blur.
  const unlocked = isPro && before !== undefined
  const parts = useMemo(
    () => (expanded && unlocked ? diffWords(before ?? '', after) : []),
    [expanded, unlocked, before, after],
  )
  return (
    <div className="mt-4 border-t border-border/40 pt-3">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform duration-200', expanded && 'rotate-180')}
        />
        View changes from Deep Optimize
      </button>
      {expanded && (
        <div className="relative mt-2 animate-in fade-in-0 slide-in-from-top-1 duration-200">
          <div
            className={cn(
              'rounded-lg border border-border/50 bg-background/40 p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap',
              !unlocked && 'pointer-events-none select-none blur-sm',
            )}
            aria-hidden={!unlocked}
          >
            {!unlocked && 'Word-level changes between the first draft and the final one appear here. '.repeat(3)}
            {parts.map((part, i) => (
              <span
                key={i}
                className={cn(
                  part.added && 'bg-emerald-500/15 text-emerald-300',
                  part.removed && 'bg-red-500/15 text-red-400/70 line-through',
                  !part.added && !part.removed && 'text-foreground/70',
                )}
              >
                {part.value}
              </span>
            ))}
          </div>
          {!unlocked && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
                <Lock className="h-3 w-3" />
                Pro preview — see word-level changes
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
