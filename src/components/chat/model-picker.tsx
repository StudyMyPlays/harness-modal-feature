'use client'

import { Eye, Globe, Wrench } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ModelInfo } from '@/lib/harness/catalog'

function price(n: number): string {
  return n < 1 ? `$${n.toFixed(n < 0.1 ? 3 : 2)}` : `$${n.toFixed(2)}`
}

/** The chat's model, from the server's allow-list, with capabilities and price per 1M tokens. */
export function ModelPicker({
  models,
  value,
  onChange,
  disabled,
}: {
  models: ModelInfo[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const current = models.find((m) => m.id === value)
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled || models.length === 0}>
      <SelectTrigger
        aria-label="Model"
        className="text-text-1 h-9 max-w-[60vw] gap-2 border-none bg-transparent px-2 text-sm font-medium shadow-none hover:bg-white/5 sm:max-w-xs"
      >
        <SelectValue placeholder={current?.name ?? value}>{current?.name ?? value}</SelectValue>
      </SelectTrigger>
      <SelectContent className="surface-card min-w-[18rem] border-none">
        {models.map((m) => (
          <SelectItem key={m.id} value={m.id} className="rounded-[var(--radius-row)] py-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-text-1 text-sm">{m.name}</span>
              <span className="text-text-3 flex items-center gap-2 text-[11px]">
                {m.supportsVision && <Eye aria-label="Reads images" className="size-3" />}
                {m.supportsTools && <Wrench aria-label="Uses tools" className="size-3" />}
                {m.supportsWebSearch && <Globe aria-label="Web search" className="size-3" />}
                <span className="tabular-nums">
                  {price(m.pricing.inputUsd)} in · {price(m.pricing.outputUsd)} out / 1M
                </span>
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
