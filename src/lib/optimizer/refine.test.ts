import { afterEach, describe, expect, it, vi } from 'vitest'
import { runOptimize, toResponse } from '@/lib/optimizer/refine'

/** Scripted OpenRouter: write calls pop from `drafts`, judge calls pop from `scores`. */
function script(drafts: { text: string; truncated?: boolean; fail?: boolean }[], scores: (number | null)[]) {
  const d = [...drafts]
  const s = [...scores]
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      if (body.response_format) {
        calls.push('judge')
        const n = s.shift() ?? null
        if (n === null) return Response.json({ choices: [{ message: { content: 'garbage' } }] })
        const q = Math.floor(n / 4)
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  score: n,
                  breakdown: { specificity: q, completeness: q, clarity: q, structure: n - 3 * q },
                  issues: ['fix it'],
                }),
              },
            },
          ],
        })
      }
      calls.push('write')
      const next = d.shift()!
      if (next.fail) return new Response('{}', { status: 500 })
      return Response.json({
        choices: [{ message: { content: next.text }, finish_reason: next.truncated ? 'length' : 'stop' }],
      })
    }),
  )
  return calls
}

const args = (deep: boolean, ms = 60_000) => ({
  key: 'k',
  mode: 'co-work' as const,
  raw: 'do a thing',
  model: 'm',
  deepOptimize: deep,
  deadline: Date.now() + ms,
})

afterEach(() => vi.unstubAllGlobals())

describe('runOptimize deep mode', () => {
  it('returns the best-scoring draft, not the last one', async () => {
    // baseline 20 (parallel with write), draft0 70, rev1 60 (worse -> stop)
    script([{ text: 'draft0' }, { text: 'worse' }], [20, 70, 60])
    const out = await runOptimize(args(true))
    if (!out.ok) throw new Error('expected ok')
    expect(out.result.text).toBe('draft0')
    expect(out.result.score?.score).toBe(70)
    expect(out.result.refinement?.notice).toMatch(/best draft was kept/)
  })

  it('keeps an improvement and runs the second pass', async () => {
    script([{ text: 'd0' }, { text: 'd1' }, { text: 'd2' }], [20, 50, 60, 80])
    const out = await runOptimize(args(true))
    if (!out.ok) throw new Error('expected ok')
    expect(out.result.text).toBe('d2')
    expect(out.result.refinement?.iterations).toHaveLength(2)
  })

  it('does not let an unscorable revision replace a scored draft', async () => {
    script([{ text: 'd0' }, { text: 'd1' }], [20, 70, null])
    const out = await runOptimize(args(true))
    if (!out.ok) throw new Error('expected ok')
    expect(out.result.text).toBe('d0')
  })

  it('discards a truncated revision and keeps the complete draft', async () => {
    script([{ text: 'd0' }, { text: 'cut off mid-sen', truncated: true }], [20, 50])
    const out = await runOptimize(args(true))
    if (!out.ok) throw new Error('expected ok')
    expect(out.result.text).toBe('d0')
    expect(out.result.truncated).toBe(false)
    expect(out.result.refinement?.notice).toMatch(/cut off/)
  })

  it('reports a truncated first draft', async () => {
    script([{ text: 'partial', truncated: true }], [20, 50])
    const out = await runOptimize(args(false))
    if (!out.ok) throw new Error('expected ok')
    expect(out.result.truncated).toBe(true)
  })

  it('stops refining when too little time is left', async () => {
    const calls = script([{ text: 'd0' }], [20, 50])
    const out = await runOptimize(args(true, 5_000))
    if (!out.ok) throw new Error('expected ok')
    expect(calls.filter((c) => c === 'write')).toHaveLength(1)
    expect(out.result.refinement?.notice).toMatch(/not enough time/)
  })

  it('returns draft0 with a notice when the reviser is down', async () => {
    script([{ text: 'd0' }, { text: '', fail: true }], [20, 50])
    const out = await runOptimize(args(true))
    if (!out.ok) throw new Error('expected ok')
    expect(out.result.text).toBe('d0')
    expect(out.result.refinement?.notice).toMatch(/reviser was unavailable/)
  })

  it('fails hard only on the first generate call', async () => {
    script([{ text: '', fail: true }], [20])
    const out = await runOptimize(args(false))
    expect(out.ok).toBe(false)
  })
})

describe('toResponse', () => {
  const result = {
    text: 'final',
    truncated: false,
    score: { score: 80, breakdown: { specificity: 20, completeness: 20, clarity: 20, structure: 20 }, issues: ['a'] },
    baseline: { score: 20, breakdown: { specificity: 5, completeness: 5, clarity: 5, structure: 5 }, issues: ['b'] },
    refinement: { draft0: 'first', draft0Score: null, iterations: [{ score: null }] },
  }

  it('leaves out Pro-only detail entirely for a caller who is not entitled', () => {
    const json = JSON.stringify(toResponse(result, false))
    expect(json).not.toContain('breakdown')
    expect(json).not.toContain('issues')
    expect(json).not.toContain('first')
    expect(toResponse(result, false).score).toEqual({ score: 80 })
    expect(toResponse(result, false).refinement).toMatchObject({ applied: true, passes: 1 })
  })

  it('includes the detail when entitled', () => {
    const r = toResponse(result, true)
    expect(r.score?.breakdown).toBeDefined()
    expect(r.refinement?.draft0).toBe('first')
  })
})
