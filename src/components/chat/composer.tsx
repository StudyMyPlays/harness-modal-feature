'use client'

import { ArrowUp, FileText, Globe, ImageIcon, Paperclip, Square, X } from 'lucide-react'
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { classifyFile } from '@/lib/harness/client/files'
import type { WebSearchMode } from '@/lib/harness/llm/types'
import { cn } from '@/lib/utils'

const NEXT_SEARCH: Record<WebSearchMode, WebSearchMode> = { off: 'auto', auto: 'on', on: 'off' }
const SEARCH_LABEL: Record<WebSearchMode, string> = { off: 'Search off', auto: 'Search auto', on: 'Search on' }

export interface ComposerProps {
  /** May resolve false when the message was refused; the composer then restores what was typed. */
  onSend: (text: string, files: File[]) => void | boolean | Promise<boolean>
  onStop: () => void
  streaming: boolean
  supportsVision: boolean
  webSearch: WebSearchMode
  onWebSearchChange: (mode: WebSearchMode) => void
  disabled?: boolean
}

/** The message box: text, attachments, web search, send / stop. */
export function Composer({
  onSend,
  onStop,
  streaming,
  supportsVision,
  webSearch,
  onWebSearchChange,
  disabled = false,
}: ComposerProps) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  // Auto-grow up to a ceiling, then scroll.
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text])

  const canSend = !streaming && !disabled && (text.trim().length > 0 || files.length > 0)

  function addFiles(list: FileList | File[]) {
    const accepted: File[] = []
    let firstError: string | null = null
    for (const f of Array.from(list)) {
      const check = classifyFile(f, supportsVision)
      if (check.ok) accepted.push(f)
      else firstError ??= check.error
    }
    setError(firstError)
    if (accepted.length) setFiles((prev) => [...prev, ...accepted])
  }

  function send() {
    if (!canSend) return
    const sentText = text
    const sentFiles = files
    setText('')
    setFiles([])
    setError(null)
    // Clear at once (the reply can take a while), but give the message back if it was refused.
    void Promise.resolve(onSend(sentText.trim(), sentFiles)).then((accepted) => {
      if (accepted !== false) return
      setText((t) => (t ? t : sentText))
      setFiles((f) => (f.length ? f : sentFiles))
    })
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (e.clipboardData.files.length) {
      e.preventDefault()
      addFiles(e.clipboardData.files)
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
  }

  return (
    <div
      className="group/composer relative"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div
        aria-hidden
        className="module-glow pointer-events-none absolute -inset-px rounded-[calc(var(--radius-card)+1px)] opacity-0 blur-[2px] transition-opacity duration-300 group-focus-within/composer:opacity-100"
      />
      <div className={cn('surface-card relative px-3 pt-3 pb-2', dragging && '[--card-ring:var(--color-primary)]')}>
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                className="bg-btn text-text-2 inline-flex max-w-full items-center gap-1.5 rounded-[var(--radius-chip)] py-1 pr-1 pl-2 text-xs"
              >
                {f.type.startsWith('image/') ? <ImageIcon className="size-3.5" /> : <FileText className="size-3.5" />}
                <span className="max-w-[12rem] truncate">{f.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="hover:text-text-1 rounded p-0.5"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={input}
          aria-label="Message"
          rows={1}
          value={text}
          disabled={disabled}
          placeholder="Message…"
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          className="text-text-1 placeholder:text-text-3 block max-h-60 w-full resize-none bg-transparent px-1 text-[15px] leading-6 outline-none"
        />

        {error && (
          <p role="alert" className="text-destructive mt-1 px-1 text-xs">
            {error}
          </p>
        )}

        <div className="mt-2 flex items-center gap-1">
          <input
            ref={picker}
            type="file"
            multiple
            aria-label="Attach files"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            aria-label="Attach"
            disabled={disabled}
            onClick={() => picker.current?.click()}
            className="text-text-2 hover:text-text-1 tap-target inline-flex size-8 items-center justify-center rounded-lg transition hover:bg-white/5"
          >
            <Paperclip className="size-4" />
          </button>
          <button
            type="button"
            aria-label={`Web search: ${webSearch}`}
            onClick={() => onWebSearchChange(NEXT_SEARCH[webSearch])}
            className={cn(
              'tap-target inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs transition hover:bg-white/5',
              webSearch === 'off' ? 'text-text-2' : 'text-primary bg-primary/10',
            )}
          >
            <Globe className="size-3.5" />
            {SEARCH_LABEL[webSearch]}
          </button>

          <div className="ml-auto">
            {streaming ? (
              <button
                type="button"
                aria-label="Stop"
                onClick={onStop}
                className="bg-text-1 text-background tap-target inline-flex size-8 items-center justify-center rounded-full transition hover:opacity-90"
              >
                <Square className="size-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                aria-label="Send"
                disabled={!canSend}
                onClick={send}
                className="bg-primary text-primary-foreground tap-target inline-flex size-8 items-center justify-center rounded-full transition hover:opacity-90 disabled:opacity-30"
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
