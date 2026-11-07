'use client'

import { Slider } from '@/components/ui/slider'
import type { RangeFilter } from '@/lib/asteroids/filters'

interface RangeFieldProps {
  id: string
  label: string
  range: RangeFilter
  step: number
  format: (v: number) => string
  onChange: (value: [number, number]) => void
  disabled?: boolean
}

export function RangeField({ id, label, range, step, format, onChange, disabled }: RangeFieldProps) {
  const [lo, hi] = range.value
  const loText = lo <= range.domain[0] ? `≤ ${format(lo)}` : format(lo)
  const hiText = hi >= range.domain[1] ? `≥ ${format(hi)}` : format(hi)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span id={`${id}-label`} className="text-white/80">
          {label}
        </span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {loText} – {hiText}
        </span>
      </div>
      <Slider
        aria-labelledby={`${id}-label`}
        min={range.domain[0]}
        max={range.domain[1]}
        step={step}
        value={range.value}
        disabled={disabled}
        onValueChange={(value) => {
          if (Array.isArray(value) && value.length === 2) onChange([value[0], value[1]])
        }}
      />
    </div>
  )
}

interface ValueFieldProps {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (value: number) => void
}

export function ValueField({ id, label, value, min, max, step, format, onChange }: ValueFieldProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span id={`${id}-label`} className="text-white/80">
          {label}
        </span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{format(value)}</span>
      </div>
      <Slider
        aria-labelledby={`${id}-label`}
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : (v as number))}
      />
    </div>
  )
}
