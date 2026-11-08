'use client'

import type { AsteroidRecord } from '@/lib/asteroids/types'

const fmt = (v: number | null, digits: number, unit = '') =>
  v === null ? '–' : `${v.toFixed(digits)}${unit}`

function rows(r: AsteroidRecord): [string, string][] {
  return [
    ['Number', r.number !== null ? String(r.number) : '–'],
    ['Name', r.name ?? '–'],
    ['Type', r.taxonomy_class ?? '–'],
    ['Diameter', fmt(r.diameter_km, 2, ' km')],
    ['Albedo', fmt(r.albedo, 3)],
    ['Distance from the Sun', fmt(r.a, 2, ' AU')],
    ['Eccentricity', fmt(r.e, 3)],
    ['Inclination', fmt(r.i, 1, '°')],
  ]
}

export function SelectedPanel({
  record,
  category,
  onClear,
}: {
  record: AsteroidRecord | null
  category: string | null
  onClear: () => void
}) {
  return (
    <section aria-labelledby="selected-label" aria-live="polite" className="glass rounded-md p-5">
      <div className="flex items-center justify-between">
        <p id="selected-label" className="text-sm font-medium text-white">
          Selected asteroid
        </p>
        {record && (
          <button type="button" onClick={onClear} className="text-xs text-white hover:opacity-70">
            Clear
          </button>
        )}
      </div>
      {record ? (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs tabular-nums">
          {[...rows(record), ['Group', category ?? '–'] as [string, string]].map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-white">{k}</dt>
              <dd className="truncate text-right text-white">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 text-sm text-white">Click an asteroid on the map to see it here.</p>
      )}
    </section>
  )
}
