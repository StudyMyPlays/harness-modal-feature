import type { SessionEvent } from './format'
import { liveEvents } from './projection'

/**
 * Compaction (DeepSeek Harness's `compaction-basic`): when the projected
 * history is too big for comfort or for the request limit, older turns are
 * summarised by the utility model and the summary stands in for them.
 */
export function shouldCompact(p: { estimatedTokens: number; overBudget: boolean }, compactAtTokens: number): boolean {
  return p.overBudget || p.estimatedTokens > compactAtTokens
}

export function selectCompactionRange(
  events: SessionEvent[],
  keepLast = 6,
): { toSummarize: SessionEvent[]; throughEventId: string } | null {
  const { live } = liveEvents(events)
  if (live.length <= keepLast) return null
  const older = live.slice(0, live.length - keepLast)
  let previous: SessionEvent | null = null
  for (const e of events) if (e.type === 'compaction') previous = e
  return {
    toSummarize: previous ? [previous, ...older] : older,
    throughEventId: older[older.length - 1].id,
  }
}
