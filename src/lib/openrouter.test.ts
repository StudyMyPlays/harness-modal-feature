import { afterEach, describe, expect, it, vi } from 'vitest'
import { callOpenRouter } from '@/lib/openrouter'

const base = { key: 'k', model: 'm', messages: [], maxTokens: 10, timeoutMs: 1000 }

describe('callOpenRouter', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('treats a non-JSON error page as an upstream failure, not a throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })))
    expect(await callOpenRouter(base)).toEqual({ ok: false, reason: 'upstream', status: 502 })
  })

  it('reports a timeout instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_u: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener('abort', () => rej(init.signal?.reason))
        }),
      ),
    )
    expect(await callOpenRouter({ ...base, timeoutMs: 20 })).toEqual({ ok: false, reason: 'timeout' })
  })

  it('flags a reply cut off by max_tokens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ choices: [{ message: { content: 'abc' }, finish_reason: 'length' }] })),
    )
    expect(await callOpenRouter(base)).toEqual({ ok: true, text: 'abc', truncated: true })
  })

  it('does not forward a caller-controlled Referer', async () => {
    const f = vi.fn(async () => Response.json({ choices: [{ message: { content: 'x' } }] }))
    vi.stubGlobal('fetch', f)
    vi.stubEnv('OPENROUTER_SITE_URL', '')
    await callOpenRouter(base)
    const headers = (f.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers['HTTP-Referer']).toBeUndefined()
    vi.unstubAllEnvs()
  })
})
