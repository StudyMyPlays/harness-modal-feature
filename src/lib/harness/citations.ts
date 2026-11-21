import type { Citation } from './llm/types'

/** Link title that marks a markdown link as a citation, so the renderer can draw it as a superscript. */
export const CITATION_TITLE = 'citation'

function safeUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  } catch {
    return null
  }
  return encodeURI(decodeURI(url)).replace(/\(/g, '%28').replace(/\)/g, '%29')
}

/**
 * Venice cites web sources as `^1^` or `^1,2^`. Rewrite those into markdown
 * links (outside code), leaving indices with no matching source as written.
 */
export function linkCitations(text: string, citations: Citation[]): string {
  if (!citations.length) return text
  const link = (n: number) => {
    const c = citations[n - 1]
    const url = c && safeUrl(c.url)
    return url ? `[${n}](${url} "${CITATION_TITLE}")` : `^${n}^`
  }
  const rewrite = (chunk: string) =>
    chunk.replace(/\^(\d+(?:\s*,\s*\d+)*)\^/g, (_m, list: string) =>
      list
        .split(',')
        .map((s) => link(Number(s.trim())))
        .join(''),
    )
  // Split out fenced blocks and inline code spans; only rewrite the prose between them.
  return text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 === 1 ? part : rewrite(part)))
    .join('')
}
