import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get, setupRouteEnv } from '@/test/routes'

const { GET } = await import('@/app/api/tools/route')

beforeEach(setupRouteEnv)
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/tools', () => {
  it('returns [] when no servers are configured', async () => {
    expect(await (await GET(get('http://localhost:3000/api/tools'))).json()).toEqual({ servers: [], tools: [] })
  })

  it('tools lists status for configured servers', async () => {
    // Nothing listens on this port, so the server is reported as failing — not thrown.
    vi.stubEnv('MCP_SERVERS', JSON.stringify([{ name: 'local', url: 'http://localhost:1/mcp' }]))
    const body = await (await GET(get('http://localhost:3000/api/tools'))).json()
    expect(body.tools).toEqual([])
    expect(body.servers).toHaveLength(1)
    expect(body.servers[0]).toMatchObject({ name: 'local', ok: false, toolCount: 0 })
  })
})
