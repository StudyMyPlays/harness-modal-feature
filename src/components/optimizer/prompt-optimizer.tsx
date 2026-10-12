'use client'
import { useEffect, useRef, useState } from 'react'
import { SearchInput, type OptimizeInput } from '@/components/optimizer/search-input'
import { PromptResult, type PromptStatus } from '@/components/optimizer/prompt-result'
import { MODES, type OptimizerMode } from '@/lib/optimizer/optimizer'
import type { OptimizeResponse } from '@/lib/optimizer/refine'

/** Everything a finished request produced, kept together with the mode that produced it. */
interface Output {
  mode: OptimizerMode
  prompt: string
  data: OptimizeResponse
}

/**
 * The route's own errors are JSON `{ error }`. A gateway timeout or an edge
 * error page is not, so a body that will not parse is described by its status
 * instead of being mistaken for a dropped connection.
 */
function failureMessage(status: number, body: { error?: unknown } | null): string {
  if (typeof body?.error === 'string' && body.error) return body.error
  if (status === 504 || status === 524 || status === 408) {
    return 'The request timed out before the model finished. Try again, or turn off Deep optimize.'
  }
  if (status >= 500) return 'The server had a problem. Try again in a moment.'
  return 'Optimization failed.'
}

/**
 * Prompt optimizer surface. Two things come out of it, depending on the mode:
 * a clean one-off task prompt for an agent (Co-Work, Comet), or the standing
 * instructions behind a saved workspace (Claude Projects, Gemini Gems, ChatGPT
 * Projects). Embedded at the top of the library, in place of the old Featured
 * carousel. Generation runs server-side via the /api/optimize route.
 */
export function PromptOptimizer() {
  const [status, setStatus] = useState<PromptStatus>('idle')
  // The mode picked in the composer. A result carries its own mode (`output`),
  // so changing this while a request runs, or after one finishes, never
  // re-labels or discards what was already generated.
  const [mode, setMode] = useState<OptimizerMode>('co-work')
  const [output, setOutput] = useState<Output | null>(null)
  const [error, setError] = useState('')
  const [lastInput, setLastInput] = useState<OptimizeInput | null>(null)
  // Bumped by Reset to remount the composer, which owns its own text.
  const [composerKey, setComposerKey] = useState(0)
  // Only the latest request may write state: a response that arrives after a
  // Reset, or after a newer submit, belongs to a request nobody is waiting on.
  const requestId = useRef(0)
  const inflight = useRef<AbortController | null>(null)
  useEffect(() => () => inflight.current?.abort(), [])

  const runOptimize = async (input: OptimizeInput) => {
    inflight.current?.abort()
    const controller = new AbortController()
    inflight.current = controller
    const id = ++requestId.current
    setLastInput(input)
    setStatus('loading')
    setError('')
    try {
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      })
      const data = await res.json().catch(() => null)
      if (id !== requestId.current) return
      if (!res.ok || !data || typeof data.text !== 'string') {
        setError(failureMessage(res.status, data))
        setStatus('error')
        return
      }
      setOutput({ mode: input.mode, prompt: input.raw, data: data as OptimizeResponse })
      setStatus('success')
    } catch {
      if (id !== requestId.current) return
      setError('Network error — check your connection and try again.')
      setStatus('error')
    }
  }
  const handleRetry = () => {
    if (lastInput) runOptimize(lastInput)
  }
  const handleReset = () => {
    inflight.current?.abort()
    requestId.current++
    setStatus('idle')
    setOutput(null)
    setError('')
    setLastInput(null)
    setComposerKey((k) => k + 1)
  }
  const hasActivity = status !== 'idle'
  return (
    <section className="w-full pt-2 pb-4">
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-5">
        {!hasActivity && (
          <header className="flex flex-col items-center gap-1.5 text-center">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              Promptful
            </h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              {MODES[mode].kind === 'workspace'
                ? 'Turn an idea for a workspace into the instructions that run it'
                : 'Turn rough requests into clean prompts for AI agents'}
            </p>
          </header>
        )}
        <SearchInput
          key={composerKey}
          onSubmit={runOptimize}
          isLoading={status === 'loading'}
          mode={mode}
          onModeChange={setMode}
        />
        {hasActivity && (
          <PromptResult
            status={status}
            // While a request is running, its result is not on screen yet;
            // once there is one it is shown under the mode that made it.
            mode={output?.mode ?? lastInput?.mode ?? mode}
            prompt={output?.prompt}
            data={output?.data}
            error={error}
            onRetry={handleRetry}
            onReset={handleReset}
          />
        )}
      </div>
    </section>
  )
}
