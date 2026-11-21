import type { Usage } from '@/lib/harness/llm/types'

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

export function formatUsd(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(n < 1 ? 3 : 2)}`
}

/** `1.2k in · 340 out · $0.0012` */
export function UsageBadge({ usage, costUsd }: { usage: Usage | null; costUsd: number | null }) {
  if (!usage) return null
  const parts = [`${formatTokens(usage.inputTokens)} in`, `${formatTokens(usage.outputTokens)} out`]
  if (costUsd !== null) parts.push(formatUsd(costUsd))
  return <span className="text-text-3 type-label tabular-nums">{parts.join(' · ')}</span>
}
