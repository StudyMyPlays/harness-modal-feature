import { describe, expect, it } from 'vitest'
import { getHarnessConfig } from './config'

const DEEPSEEK = 'deepseek-v4-1-flash-1017-uncensored'
const GLM = 'glm-5-3-flash-uncensored'

describe('getHarnessConfig', () => {
  it('defaults when env is empty', () => {
    const c = getHarnessConfig({})
    expect(c.models).toEqual([DEEPSEEK, GLM])
    expect(c.defaultModel).toBe(DEEPSEEK)
    expect(c.utilityModel).toBe(GLM)
    expect(c.dailyBudget).toBe(2000)
    expect(c.compactAtTokens).toBe(150000)
    expect(c.veniceKey).toBeNull()
    expect(c.passcode).toBeNull()
    expect(c.sessionSecret).toBeNull()
    expect(c.isPublic).toBe(false)
    expect(c.isProduction).toBe(false)
  })

  it('HARNESS_MODELS is trimmed and de-duplicated', () => {
    expect(getHarnessConfig({ HARNESS_MODELS: ' a, b ,a,' }).models).toEqual(['a', 'b'])
  })

  it('default model must be in the allow-list', () => {
    const c = getHarnessConfig({ HARNESS_MODELS: 'a,b', HARNESS_DEFAULT_MODEL: 'x' })
    expect(c.defaultModel).toBe('a')
    expect(getHarnessConfig({ HARNESS_MODELS: 'a,b', HARNESS_DEFAULT_MODEL: 'b' }).defaultModel).toBe('b')
  })

  it('non-numeric budgets fall back to defaults', () => {
    const c = getHarnessConfig({ HARNESS_DAILY_CALL_BUDGET: 'lots', COMPACT_AT_TOKENS: '-5' })
    expect(c.dailyBudget).toBe(2000)
    expect(c.compactAtTokens).toBe(150000)
    expect(getHarnessConfig({ COMPACT_AT_TOKENS: '2000' }).compactAtTokens).toBe(2000)
  })

  it('HARNESS_PUBLIC=1 sets isPublic', () => {
    expect(getHarnessConfig({ HARNESS_PUBLIC: '1' }).isPublic).toBe(true)
    expect(getHarnessConfig({ HARNESS_PUBLIC: 'true' }).isPublic).toBe(false)
  })

  it('reads key, passcode and production flag, treating blanks as unset', () => {
    const c = getHarnessConfig({
      VENICE_API_KEY: ' k ',
      HARNESS_PASSCODE: '',
      HARNESS_SESSION_SECRET: 's',
      NODE_ENV: 'production',
    })
    expect(c.veniceKey).toBe('k')
    expect(c.passcode).toBeNull()
    expect(c.sessionSecret).toBe('s')
    expect(c.isProduction).toBe(true)
  })
})
