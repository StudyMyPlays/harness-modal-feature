'use client'

import { Check, Copy } from 'lucide-react'
import { isValidElement, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { copyToClipboard } from '@/lib/clipboard'
import { CITATION_TITLE } from '@/lib/harness/citations'

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="group/code surface-inner relative my-3 overflow-hidden">
      <button
        type="button"
        aria-label="Copy code"
        onClick={async () => {
          if (await copyToClipboard(textOf(children).replace(/\n$/, ''))) {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }
        }}
        className="text-text-2 hover:text-text-1 absolute top-2 right-2 rounded-md p-1.5 opacity-70 transition hover:bg-white/5 group-hover/code:opacity-100 focus-visible:opacity-100"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed">{children}</pre>
    </div>
  )
}

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  // Never load images from model output: a prompt-injected image URL could
  // carry the conversation to a third party just by being rendered.
  img: ({ alt }) => <span className="text-text-3">[image{alt ? `: ${alt}` : ''}]</span>,
  a: ({ href, title, children }) => {
    const link = (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={
          title === CITATION_TITLE
            ? 'bg-primary/15 text-primary hover:bg-primary/25 mx-0.5 rounded px-1 text-[10px] font-semibold no-underline'
            : 'text-primary underline-offset-2 hover:underline'
        }
      >
        {children}
      </a>
    )
    return title === CITATION_TITLE ? <sup>{link}</sup> : link
  },
  code: ({ className, children }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="bg-btn rounded px-1.5 py-0.5 font-mono text-[0.9em]">{children}</code>
    ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
}

/** Model output as markdown. Raw HTML is skipped, never rendered. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown text-text-1 text-[15px] leading-7">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
