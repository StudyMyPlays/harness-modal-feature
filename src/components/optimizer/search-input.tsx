'use client'
import { useState, useEffect } from 'react'
import { useReducedMotion } from 'framer-motion'
import Image from 'next/image'
import { ArrowUp, ChevronDown, Paperclip, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  MODES,
  MODE_ACCENT,
  MODE_GROUPS,
  MAX_RAW_CHARS,
  MAX_CTX_CHARS,
  type OptimizerMode,
} from '@/lib/optimizer/optimizer'
export interface OptimizeInput {
  raw: string
  mode: OptimizerMode
  ctx?: string
  deepOptimize?: boolean
}
interface SearchInputProps {
  onSubmit?: (input: OptimizeInput) => void
  isLoading?: boolean
  mode: OptimizerMode
  onModeChange: (mode: OptimizerMode) => void
}
export function SearchInput({
  onSubmit,
  isLoading = false,
  mode,
  onModeChange,
}: SearchInputProps) {
  const [value, setValue] = useState('')
  const [ctx, setCtx] = useState('')
  const [showCtx, setShowCtx] = useState(false)
  const [showExamples, setShowExamples] = useState(false)
  const [deepOptimize, setDeepOptimize] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [typed, setTyped] = useState('')
  const [typingDone, setTypingDone] = useState(false)
  const cfg = MODES[mode]
  const accent = MODE_ACCENT[mode]
  const baseText = 'Ask Promptful'
  const reduceMotion = useReducedMotion()
  useEffect(() => {
    if (reduceMotion) return
    let currentIndex = 0
    let timeoutId: ReturnType<typeof setTimeout>
    const typeNextChar = () => {
      currentIndex++
      setTyped(baseText.slice(0, currentIndex))
      if (currentIndex < baseText.length) {
        timeoutId = setTimeout(typeNextChar, 60)
      } else {
        setTypingDone(true)
      }
    }
    timeoutId = setTimeout(typeNextChar, 250)
    return () => clearTimeout(timeoutId)
  }, [reduceMotion])
  const displayTyped = reduceMotion ? baseText : typed
  const displayTypingDone = reduceMotion ? true : typingDone
  // The knowledge-base field only exists for the workspace modes. On a task
  // mode it is hidden and, more importantly, not submitted — any text left
  // staged there stays out of the request rather than silently riding along
  // with an unrelated Comet run. It is kept, not cleared, so switching modes
  // to compare two outputs doesn't cost the user their notes.
  const supportsContext = !!cfg.contextLabel
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || isLoading || trimmed.length > MAX_RAW_CHARS) return
    const trimmedCtx = ctx.trim()
    if (supportsContext && trimmedCtx.length > MAX_CTX_CHARS) return
    onSubmit?.({
      raw: trimmed,
      mode,
      ...(supportsContext && trimmedCtx ? { ctx: trimmedCtx } : {}),
      ...(deepOptimize ? { deepOptimize: true } : {}),
    })
  }
  const rawLength = value.trim().length
  const ctxLength = ctx.trim().length
  // Over the ceiling is an error the user can see and fix. A `maxLength`
  // attribute would instead cut a long paste off at the limit without a word.
  const rawOver = rawLength > MAX_RAW_CHARS
  const ctxOver = supportsContext && ctxLength > MAX_CTX_CHARS
  const canSubmit = rawLength > 0 && !rawOver && !ctxOver && !isLoading
  return (
    <form onSubmit={handleSubmit} className="w-full max-w-4xl mx-auto">
      <div className="relative">
        {!value && (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute -inset-[3px] rounded-[1.05rem] blur-lg bg-gradient-to-br ${accent.glow} module-glow`}
          />
        )}
        <div
          className={`relative flex flex-col gap-4 rounded-2xl border border-border/50 bg-card p-5 shadow-lg transition-all duration-300 ${
            isFocused
              ? 'ring-2 ring-ring/40 border-border shadow-[0_0_24px_-4px] shadow-primary/20'
              : 'hover:border-border'
          }`}
        >
          <div className="relative">
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              // The visible affordance is the typed "Ask Promptful" overlay,
              // which is decorative and says nothing about the selected mode.
              // The label carries the mode-specific ask instead, so a screen
              // reader hears "describe the Gem you want to build" rather than
              // a generic field name.
              aria-label={cfg.placeholder}
              aria-invalid={rawOver}
              aria-describedby="optimizer-count"
              className="relative w-full min-h-[80px] resize-none bg-transparent text-foreground focus:outline-none text-base leading-relaxed"
              rows={3}
            />
            {/* Pretype overlay: the typed base text, followed once typing is
                done by a steady animated ellipsis. */}
            {!value && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 select-none text-base leading-relaxed text-muted-foreground"
              >
                <span>{displayTyped}</span>
                {displayTypingDone && (
                  <span className="typing-dots">
                    <span>.</span>
                    <span>.</span>
                    <span>.</span>
                  </span>
                )}
              </div>
            )}
          </div>
          {/* There was an attachment control here — a paperclip, a file picker
              and removable chips. None of it was ever sent: the submit payload
              had no transport for a file. It read as a working feature while
              silently dropping the document a user's prompt was about, so it is
              gone until the optimizer can actually accept attachments. What
              stands in its place, for the workspace modes only, is a text
              description of the knowledge base — which the model genuinely can
              use, because it travels as `ctx` on the request. */}
          {supportsContext && showCtx && (
            <div className="animate-in fade-in-0 slide-in-from-top-1 duration-200">
              <label
                htmlFor="optimizer-context"
                className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
              >
                {cfg.contextLabel}
              </label>
              <textarea
                id="optimizer-context"
                value={ctx}
                onChange={(e) => setCtx(e.target.value)}
                placeholder={cfg.contextPlaceholder}
                aria-invalid={ctxOver}
                rows={2}
                className="w-full resize-none rounded-lg border border-border/60 bg-background/40 p-3 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:border-border focus:outline-none"
              />
              {ctxLength > MAX_CTX_CHARS * 0.9 && (
                <p
                  className={`mt-1 text-right text-xs ${ctxOver ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  {ctxLength.toLocaleString()} / {MAX_CTX_CHARS.toLocaleString()}
                  {ctxOver ? ' — too long' : ''}
                </p>
              )}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center">
              {supportsContext && (
                <button
                  type="button"
                  onClick={() => setShowCtx((s) => !s)}
                  aria-expanded={showCtx}
                  className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
                    showCtx || ctx.trim()
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  {cfg.contextLabel}
                  {!!ctx.trim() && (
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() => setDeepOptimize((d) => !d)}
                aria-pressed={deepOptimize}
                title="Run 2 extra critique-and-rewrite passes before returning a result. Slower, higher quality."
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
                  deepOptimize
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Deep optimize
              </button>
            </div>
            <div className="flex items-center gap-3">
              <Select
                value={mode}
                onValueChange={(v) => onModeChange(v as OptimizerMode)}
              >
                <SelectTrigger className="w-auto h-9 bg-secondary border border-border hover:bg-accent rounded-lg gap-2 px-3 transition-all duration-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="animate-in fade-in-0 zoom-in-95">
                  {MODE_GROUPS.map((group) => (
                    <SelectGroup key={group.kind}>
                      <SelectLabel className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {group.label}
                      </SelectLabel>
                      {group.modes.map((id) => {
                        const m = MODES[id]
                        return (
                          <SelectItem
                            key={m.id}
                            value={m.id}
                            className="transition-colors duration-150"
                          >
                            <div className="flex items-center gap-2">
                              <Image
                                src={m.icon}
                                alt={m.provider}
                                width={16}
                                height={16}
                                className="h-4 w-4"
                              />
                              <span>{m.label}</span>
                              <span className="text-xs text-muted-foreground">
                                {m.provider}
                              </span>
                            </div>
                          </SelectItem>
                        )
                      })}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="submit"
                size="icon"
                aria-busy={isLoading}
                className={`h-9 w-9 rounded-lg transition-all duration-300 data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:hover:bg-primary/90 data-[active=true]:scale-105 data-[active=false]:bg-muted data-[active=false]:text-muted-foreground data-[active=false]:hover:bg-accent ${canSubmit ? `shadow-[0_0_16px_-4px] ${accent.ring}` : ''}`}
                data-active={canSubmit}
                disabled={!canSubmit}
              >
                {isLoading ? (
                  <Spinner className="h-5 w-5" />
                ) : (
                  <ArrowUp className="h-5 w-5 transition-transform duration-200" />
                )}
                <span className="sr-only">Optimize</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center px-1">
        <button
          type="button"
          onClick={() => setShowExamples((s) => !s)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ${
              showExamples ? 'rotate-180' : ''
            }`}
          />
          Examples
        </button>
      </div>
      {showExamples && (
        <div className="mt-2 grid gap-2 animate-in fade-in-0 slide-in-from-top-1 duration-200 sm:grid-cols-2">
          {cfg.examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setValue(ex)
                setShowExamples(false)
              }}
              className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5 text-left text-[13px] leading-snug text-muted-foreground transition-all hover:border-border hover:bg-accent hover:text-foreground"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
      <div
        id="optimizer-count"
        className={`mt-2 h-4 px-1 text-right text-xs ${
          rawOver ? 'text-destructive' : 'text-muted-foreground'
        }`}
      >
        {rawLength > 0 && (
          <span>
            {rawLength.toLocaleString()} / {MAX_RAW_CHARS.toLocaleString()} characters
            {rawOver ? ' — too long to optimize, shorten it' : ''}
          </span>
        )}
      </div>
    </form>
  )
}
