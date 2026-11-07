'use client'

import type { AsteroidRecord } from '@/lib/asteroids/types'

const fmt = (v: number | null, digits: number, unit = '') =>
  v === null ? '—' : `${v.toFixed(digits)}${unit}`

function rows(r: AsteroidRecord): [string, string][] {
  return [
    ['number', r.number !== null ? String(r.number) : '—'],
    ['name', r.name ?? '—'],
    ['x', fmt(r.x, 4, ' au')],
    ['y', fmt(r.y, 4, ' au')],
    ['z', fmt(r.z, 4, ' au')],
    ['a', fmt(r.a, 4, ' au')],
    ['e', fmt(r.e, 4)],
    ['i', fmt(r.i, 3, '°')],
    ['taxonomy_class', r.taxonomy_class ?? '—'],
    ['diameter_km', fmt(r.diameter_km, 3)],
    ['albedo', fmt(r.albedo, 3)],
  ]
}

export function SelectedPanel({ record, onClear }: { record: AsteroidRecord | null; onClear: () => void }) {
  return (
    <section aria-labelledby="selected-label" aria-live="polite" className="glass rounded-md p-5">
      <div className="flex items-center justify-between">
        <p id="selected-label" className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Selected
        </p>
        {record && (
          <button type="button" onClick={onClear} className="text-xs text-muted-foreground hover:text-white">
            Clear
          </button>
        )}
      </div>
      {record ? (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-xs tabular-nums">
          {rows(record).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="truncate text-right text-white">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">None</p>
      )}
    </section>
  )
}
