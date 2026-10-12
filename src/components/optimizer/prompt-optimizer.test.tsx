// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PromptOptimizer } from '@/components/optimizer/prompt-optimizer'
import { BeforeAfterDiff } from '@/components/optimizer/before-after-diff'
import { MAX_RAW_CHARS } from '@/lib/optimizer/optimizer'
import type { OptimizeResponse } from '@/lib/optimizer/refine'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const response = (over: Partial<OptimizeResponse> = {}): OptimizeResponse => ({
  text: 'ROLE\nA finished prompt',
  truncated: false,
  pro: false,
  score: { score: 70 },
  baseline: { score: 30 },
  ...over,
})

/** A fetch whose responses the test resolves by hand, in any order. */
function deferredFetch() {
  const pending: { resolve: (r: Response) => void; reject: (e: unknown) => void; signal?: AbortSignal | null }[] = []
  const f = vi.fn(
    (_u: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        pending.push({ resolve, reject, signal: init.signal })
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
  )
  vi.stubGlobal('fetch', f)
  return { f, pending }
}

const json = (body: unknown, status = 200) => Response.json(body, { status })
const composer = () => screen.getByRole('textbox', { name: /Describe what you want Cowork/ }) as HTMLTextAreaElement
const submit = () => screen.getByRole('button', { name: /Optimize/ })

async function type(text: string) {
  await act(async () => {
    fireEvent.change(composer(), { target: { value: text } })
  })
}
async function send(text: string) {
  await type(text)
  await act(async () => {
    fireEvent.click(submit())
  })
}

describe('PromptOptimizer', () => {
  /** Radix Select mirrors its value into a hidden native <select>; changing that fires onValueChange. */
  const pickMode = async (value: string) => {
    const native = document.querySelector('select') as HTMLSelectElement
    await act(async () => {
      fireEvent.change(native, { target: { value } })
    })
  }

  it('shows the result under the mode that produced it, even if the picker changed mid-request', async () => {
    const { pending } = deferredFetch()
    render(<PromptOptimizer />)
    await send('hello')
    await pickMode('comet')
    // Changing the picker neither cancels the request nor flips it to idle.
    expect(pending[0].signal?.aborted).toBe(false)
    expect((submit() as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      pending[0].resolve(json(response()))
    })
    await waitFor(() => screen.getByText('Ready for Cowork'))
    expect(screen.queryByText('Ready for Comet')).toBeNull()
  })

  it('keeps a finished result when the picker changes afterwards', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(response())))
    render(<PromptOptimizer />)
    await send('hello')
    await waitFor(() => screen.getByText('A finished prompt'))
    await pickMode('comet')
    expect(screen.getByText('A finished prompt')).toBeTruthy()
    expect(screen.getByText('Ready for Cowork')).toBeTruthy()
  })

  it('Reset clears the result and the composer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(response())))
    render(<PromptOptimizer />)
    await send('hello')
    await waitFor(() => screen.getByText('A finished prompt'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    })
    expect(screen.queryByText('A finished prompt')).toBeNull()
    expect(composer().value).toBe('')
  })

  it('aborts the request when the component unmounts', async () => {
    const { pending } = deferredFetch()
    const { unmount } = render(<PromptOptimizer />)
    await send('hello')
    unmount()
    expect(pending[0].signal?.aborted).toBe(true)
  })

  it('Try again replaces an error with the new result', async () => {
    const { pending } = deferredFetch()
    render(<PromptOptimizer />)
    await send('first')
    await act(async () => {
      pending[0].resolve(json({ error: 'nope' }, 500))
    })
    await waitFor(() => screen.getByText('nope'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    })
    expect(pending).toHaveLength(2)
    await act(async () => {
      pending[1].resolve(json(response({ text: 'second answer' })))
    })
    await waitFor(() => screen.getByText('second answer'))
  })

  it('explains a non-JSON gateway timeout instead of blaming the network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>timeout</html>', { status: 504 })))
    render(<PromptOptimizer />)
    await send('hello')
    await waitFor(() => screen.getByText(/timed out/))
    expect(screen.queryByText(/Network error/)).toBeNull()
  })

  it('reports a real network failure as one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    render(<PromptOptimizer />)
    await send('hello')
    await waitFor(() => screen.getByText(/Network error/))
  })

  it('warns when the output was cut off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(response({ truncated: true }))))
    render(<PromptOptimizer />)
    await send('hello')
    await waitFor(() => screen.getByRole('alert'))
    expect(screen.getByRole('alert').textContent).toMatch(/cut off/)
  })

  it('shows the deep-optimize notice to everyone, not just Pro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(response({ pro: false, refinement: { applied: false, passes: 0, notice: 'Stopped after 0 of 2 refinement passes — the reviser was unavailable.' } })),
      ),
    )
    render(<PromptOptimizer />)
    await send('hello')
    await waitFor(() => screen.getByText(/reviser was unavailable/))
    expect(screen.queryByText(/View changes from Deep Optimize/)).toBeNull()
  })

  it('has no client-side Pro switch', () => {
    render(<PromptOptimizer />)
    expect(screen.queryByText(/Pro preview/)).toBeNull()
  })
})

describe('composer limits', () => {
  it('shows a persistent count and blocks submit over the limit instead of truncating', async () => {
    render(<PromptOptimizer />)
    await type('x'.repeat(MAX_RAW_CHARS + 5))
    expect(composer().value).toHaveLength(MAX_RAW_CHARS + 5)
    expect(screen.getByText(/too long to optimize/)).toBeTruthy()
    expect((submit() as HTMLButtonElement).disabled).toBe(true)
    await type('x'.repeat(MAX_RAW_CHARS))
    expect((submit() as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText(/8,000 \/ 8,000/)).toBeTruthy()
  })
})

describe('BeforeAfterDiff entitlement', () => {
  it('never puts the first draft in the DOM for a non-entitled caller', async () => {
    render(<BeforeAfterDiff after="final text" isPro={false} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /View changes/ }))
    })
    expect(document.body.textContent).not.toContain('final text')
    expect(screen.getByText(/Pro preview/)).toBeTruthy()
  })

  it('renders the diff for an entitled caller', async () => {
    render(<BeforeAfterDiff before="first draft" after="final draft" isPro />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /View changes/ }))
    })
    expect(document.body.textContent).toContain('first')
    expect(document.body.textContent).toContain('final')
  })
})
