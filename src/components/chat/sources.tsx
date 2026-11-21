import type { Citation } from '@/lib/harness/llm/types'

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Numbered chips for the web sources a reply drew on. */
export function Sources({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="text-text-3 type-label mr-1">Sources</span>
      {citations.map((c, i) => (
        <a
          key={`${i}-${c.url}`}
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          title={c.title}
          className="surface-inner text-text-2 hover:text-text-1 inline-flex max-w-[14rem] items-center gap-1.5 px-2 py-1 text-xs transition"
        >
          <span className="text-primary font-semibold">{i + 1}</span>
          <span className="truncate">{host(c.url)}</span>
        </a>
      ))}
    </div>
  )
}
