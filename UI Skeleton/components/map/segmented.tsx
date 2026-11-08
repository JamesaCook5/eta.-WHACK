'use client'

import { cn } from '@/lib/utils'

interface SegmentedProps<T extends string> {
  label: string
  options: readonly { id: T; label: string }[]
  value: T
  onChange: (value: T) => void
}

export function Segmented<T extends string>({ label, options, value, onChange }: SegmentedProps<T>) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-white">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 rounded-md bg-white/5 p-1">
        {options.map((option) => {
          const active = option.id === value
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.id)}
              className={cn(
                'h-8 flex-1 rounded-md px-2 text-xs whitespace-nowrap transition-colors',
                active ? 'bg-white text-[#0e0e0e]' : 'text-white hover:bg-white/10 hover:text-white',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
