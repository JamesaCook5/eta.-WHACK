'use client'

import { cn } from '@/lib/utils'
import type { AsteroidDataset } from '@/lib/asteroids/types'
import type { RankedCandidate } from '@/lib/mission/rank'

export function asteroidLabel(dataset: AsteroidDataset, index: number) {
  const r = dataset.records[index]
  if (r.number !== null && r.name) return `(${r.number}) ${r.name}`
  return r.name ?? (r.number !== null ? `(${r.number})` : `Record ${index}`)
}

interface CandidatesPanelProps {
  dataset: AsteroidDataset | null
  candidates: RankedCandidate[]
  selected: number
  onSelect: (index: number) => void
  onHover: (index: number) => void
}

export function CandidatesPanel({ dataset, candidates, selected, onSelect, onHover }: CandidatesPanelProps) {
  return (
    <section aria-labelledby="candidates-label" className="glass flex min-h-0 flex-col rounded-md">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <p id="candidates-label" className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Candidate stations
        </p>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{candidates.length}</span>
      </div>
      {!dataset ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">No data loaded.</p>
      ) : candidates.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">
          No asteroid matches the filters and the composition the product needs.
        </p>
      ) : (
        <ol className="flex min-h-0 flex-col gap-1 overflow-y-auto px-2 pb-2">
          {candidates.map((c, rank) => {
            const active = c.index === selected
            return (
              <li key={c.index}>
                <button
                  type="button"
                  onClick={() => onSelect(c.index)}
                  onMouseEnter={() => onHover(c.index)}
                  onMouseLeave={() => onHover(-1)}
                  onFocus={() => onHover(c.index)}
                  onBlur={() => onHover(-1)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full flex-col gap-2 rounded-md px-3 py-3 text-left transition-colors',
                    active ? 'bg-white/12' : 'hover:bg-white/6',
                  )}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className={cn('truncate text-sm', active ? 'text-signal' : 'text-white')}>
                      <span className="sr-only">Rank {rank + 1}: </span>
                      {asteroidLabel(dataset, c.index)}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {c.score.toFixed(3)}
                    </span>
                  </span>
                  <dl className="grid grid-cols-3 gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums">
                    {c.drivers.map((d) => (
                      <div key={d.label} className={cn('flex min-w-0 gap-1', d.label === 'Region' && 'col-span-3', d.value.includes('(') && 'col-span-2')}>
                        <dt className="text-muted-foreground">{d.label}</dt>
                        <dd className="truncate text-white/85">{d.value}</dd>
                      </div>
                    ))}
                  </dl>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
