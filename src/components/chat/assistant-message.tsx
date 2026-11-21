'use client'

import { AlertTriangle, Check, ChevronRight, Copy, RotateCcw, Wrench } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { copyToClipboard } from '@/lib/clipboard'
import { linkCitations } from '@/lib/harness/citations'
import type { AssistantMessageEvent, AssistantStep } from '@/lib/harness/session/format'
import { cn } from '@/lib/utils'
import { Markdown } from './markdown'
import { Sources } from './sources'
import { ThinkingBlock } from './thinking-block'
import { UsageBadge } from './usage-badge'

type ToolCall = AssistantStep['toolCalls'][number]

function ToolCallRow({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false)
  const failed = call.result && !call.result.ok
  return (
    <div className="surface-card my-2 overflow-hidden text-[13px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="text-text-2 hover:text-text-1 flex w-full items-center gap-2 px-3 py-2 text-left transition"
      >
        <Wrench className={cn('size-3.5 shrink-0', failed ? 'text-destructive' : 'text-primary')} />
        <span className="truncate font-mono">{call.name}</span>
        <span className="text-text-3 ml-auto shrink-0">{call.result ? (failed ? 'failed' : 'done') : 'running…'}</span>
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-white/5 px-3 py-2">
          <pre className="text-text-2 overflow-x-auto font-mono text-xs whitespace-pre-wrap">{call.args || '{}'}</pre>
          {call.result && (
            <pre
              className={cn(
                'max-h-64 overflow-auto font-mono text-xs whitespace-pre-wrap',
                failed ? 'text-destructive' : 'text-text-1',
              )}
            >
              {call.result.content}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export function AssistantMessage({ event, onRetry }: { event: AssistantMessageEvent; onRetry: () => void }) {
  const [copied, setCopied] = useState(false)
  const streaming = event.status === 'streaming'
  const citations = event.steps.flatMap((s) => s.citations)
  const fullText = event.steps.map((s) => s.text).filter(Boolean).join('\n\n')
  const empty = !event.steps.some((s) => s.text || s.reasoning || s.toolCalls.length)

  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
      {empty && streaming && (
        <div className="typing-dots text-text-2 py-2 text-xl leading-none" aria-label="Waiting for the reply">
          <span>•</span>
          <span>•</span>
          <span>•</span>
        </div>
      )}
      {event.steps.map((step, i) => {
        const isLast = i === event.steps.length - 1
        return (
          <div key={i}>
            {step.reasoning && <ThinkingBlock text={step.reasoning} streaming={streaming && isLast && !step.text} />}
            {step.toolCalls.map((c) => (
              <ToolCallRow key={c.id} call={c} />
            ))}
            {step.text && <Markdown text={linkCitations(step.text, citations)} />}
          </div>
        )
      })}

      <Sources citations={citations} />

      {event.status === 'interrupted' && <p className="text-text-3 mt-2 text-[13px]">Stopped.</p>}
      {event.finishReason === 'max-steps' && (
        <p className="text-text-3 mt-2 text-[13px]">Stopped after 8 tool steps.</p>
      )}
      {event.status === 'error' && event.error && (
        <div className="border-destructive/30 bg-destructive/10 mt-2 flex items-start gap-2 rounded-[var(--radius-row)] border px-3 py-2 text-[13.5px]">
          <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
          <p className="text-text-1 flex-1">{event.error.message}</p>
          <Button size="sm" variant="ghost" onClick={onRetry} className="h-7 shrink-0">
            <RotateCcw className="size-3.5" />
            Retry
          </Button>
        </div>
      )}

      {!streaming && (fullText || event.usage) && (
        <div className="mt-2 flex items-center gap-3">
          {fullText && (
            <button
              type="button"
              aria-label="Copy reply"
              onClick={async () => {
                if (await copyToClipboard(fullText)) {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }
              }}
              className="text-text-3 hover:text-text-1 rounded p-1 transition"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
          )}
          <UsageBadge usage={event.usage} costUsd={event.costUsd} />
        </div>
      )}
    </div>
  )
}
