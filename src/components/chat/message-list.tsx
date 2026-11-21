'use client'

import { useEffect, useRef } from 'react'
import type { SessionEvent } from '@/lib/harness/session/format'
import { AssistantMessage } from './assistant-message'
import { UserMessage } from './user-message'

/** The conversation, kept scrolled to the bottom while the reader is at the bottom. */
export function MessageList({
  events,
  evictedIds,
  streaming,
  onRetry,
}: {
  events: SessionEvent[]
  evictedIds: string[]
  streaming: boolean
  onRetry: () => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  useEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [events, streaming])

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
      className="flex-1 overflow-y-auto"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
        {events.map((e) => {
          if (e.type === 'user-message') return <UserMessage key={e.id} event={e} evictedIds={evictedIds} />
          if (e.type === 'assistant-message') return <AssistantMessage key={e.id} event={e} onRetry={onRetry} />
          return (
            <div key={e.id} className="text-text-3 type-label flex items-center gap-3" role="separator">
              <span className="h-px flex-1 bg-white/10" />
              Earlier messages summarised for the model
              <span className="h-px flex-1 bg-white/10" />
            </div>
          )
        })}
      </div>
    </div>
  )
}
