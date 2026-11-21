'use client'

import { Brain, ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'
import { cn } from '@/lib/utils'

/** The model's reasoning, collapsed by default. */
export function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="my-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="text-text-2 hover:text-text-1 inline-flex items-center gap-1.5 text-[13px] transition"
      >
        <Brain className={cn('size-3.5', streaming && 'text-primary animate-pulse')} />
        {streaming ? 'Thinking…' : 'Thought for a moment'}
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div
          id={id}
          className="text-text-2 mt-2 border-l-2 border-white/10 pl-3 text-[13.5px] leading-6 whitespace-pre-wrap"
        >
          {text}
        </div>
      )}
    </div>
  )
}
