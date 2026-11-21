import { NextRequest } from 'next/server'
import { vi } from 'vitest'
import { resetRateLimits } from '@/lib/rate-limit'
import { resetCatalogCache } from '@/lib/harness/catalog'
import { resetMcpCache } from '@/lib/harness/tools/mcp'

export const DEEPSEEK = 'deepseek-v4-1-flash-1017-uncensored'
export const GLM = 'glm-5-3-flash-uncensored'

/** Fresh limiter, caches and env for a harness route test. */
export function setupRouteEnv() {
  resetRateLimits()
  resetCatalogCache()
  resetMcpCache()
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('VENICE_API_KEY', 'sk-test')
  vi.stubEnv('VERCEL', '')
  vi.stubEnv('HARNESS_PASSCODE', '')
  vi.stubEnv('HARNESS_MODELS', '')
  vi.stubEnv('MCP_SERVERS', '')
  vi.spyOn(console, 'error').mockImplementation(() => {})
}

export function jsonPost(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'localhost:3000' },
    body: JSON.stringify(body),
  })
}

export function get(url: string) {
  return new NextRequest(url, { headers: { host: 'localhost:3000' } })
}
