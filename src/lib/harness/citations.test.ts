import { describe, expect, it } from 'vitest'
import { CITATION_TITLE, linkCitations } from './citations'

const cites = [
  { title: 'A', url: 'https://a.example/x' },
  { title: 'B', url: 'https://b.example/y' },
]

describe('linkCitations', () => {
  it('^1^ becomes a link to citations[0].url', () => {
    expect(linkCitations('Cats purr.^1^', cites)).toBe(`Cats purr.[1](https://a.example/x "${CITATION_TITLE}")`)
  })

  it('^1,2^ becomes two links', () => {
    expect(linkCitations('Both.^1,2^', cites)).toBe(
      `Both.[1](https://a.example/x "${CITATION_TITLE}")[2](https://b.example/y "${CITATION_TITLE}")`,
    )
  })

  it('^5^ with 2 citations stays as is', () => {
    expect(linkCitations('Huh^5^', cites)).toBe('Huh^5^')
    expect(linkCitations('Mixed^2,5^', cites)).toBe(`Mixed[2](https://b.example/y "${CITATION_TITLE}")^5^`)
  })

  it('text in backticks is untouched', () => {
    expect(linkCitations('Use `x^1^` here^1^', cites)).toBe(`Use \`x^1^\` here[1](https://a.example/x "${CITATION_TITLE}")`)
    const fenced = '```\na^1^\n```\nafter^2^'
    expect(linkCitations(fenced, cites)).toBe(`\`\`\`\na^1^\n\`\`\`\nafter[2](https://b.example/y "${CITATION_TITLE}")`)
  })

  it('returns text unchanged with no citations', () => {
    expect(linkCitations('a^1^', [])).toBe('a^1^')
  })

  it('escapes parentheses and spaces in urls so the link stays intact', () => {
    expect(linkCitations('x^1^', [{ title: 'W', url: 'https://w.example/a (b)' }])).toBe(
      `x[1](https://w.example/a%20%28b%29 "${CITATION_TITLE}")`,
    )
  })
})
