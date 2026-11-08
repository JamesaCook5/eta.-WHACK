'use client'

import { cn } from '@/lib/utils'
import type { HierarchyResult } from '@/lib/stations/api'
import { stationColor } from '@/lib/stations/colors'

/** "mfg_water_feed" → "Water feed". */
export function prettyMaterial(id: string) {
  const s = id.replace(/^(mfg|ext)_/, '').replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

interface Props {
  result: HierarchyResult | null
  error: string | null
  /** Station index → asteroids assigned to it (mining stations only, else 0). */
  asteroidCounts: number[]
  miningStations: number[]
  focusStation: number
  pinnedStation: number
  onHoverStation: (k: number) => void
  onPinStation: (k: number) => void
}

/** Right-hand panel for the production-chain plan: mining stations and the station you click. */
export function HierarchyPanel({ result, error, asteroidCounts, miningStations, focusStation, pinnedStation, onHoverStation, onPinStation }: Props) {
  if (error) return <p className="glass rounded-md p-4 text-sm text-red-200">Production plan failed: {error}</p>
  if (!result) return <p className="glass rounded-md p-5 text-sm text-white">Planning the production chain…</p>

  const k = pinnedStation >= 0 && pinnedStation < result.stations.length ? pinnedStation : -1
  const s = k >= 0 ? result.stations[k] : null
  const mining = s ? miningStations.includes(k) : false

  return (
    <section aria-labelledby="hierarchy-label" className="glass flex min-h-0 flex-col rounded-md">
      <p id="hierarchy-label" className="px-5 pt-5 pb-3 text-sm font-medium text-white">
        Where the stations go
      </p>
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
        {s ? (
          <div className="flex flex-col gap-2 rounded-md bg-white/4 p-3" style={{ boxShadow: `inset 0 0 0 1.5px ${stationColor(k)}` }}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm text-white">
                <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: stationColor(k) }} />
                S{k + 1}
              </span>
              <button type="button" onClick={() => onPinStation(k)} className="text-xs text-white hover:opacity-70">
                Close
              </button>
            </div>
            <p className="text-sm text-white">{mining ? 'Mining station' : prettyMaterial(s.material)}</p>
            {mining && (
              <>
                <p className="text-2xl font-medium text-white tabular-nums">{asteroidCounts[k].toLocaleString()} asteroids</p>
                <p className="text-xs text-white">connected to this station · {(s.share * 100).toFixed(1)}% of supply</p>
              </>
            )}
            <p className="text-xs text-white tabular-nums">{s.a.toFixed(2)} AU from the Sun</p>
          </div>
        ) : (
          <p className="text-sm text-white">Click a station on the map to see how many asteroids it is connected to.</p>
        )}

        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-white">Mining stations</p>
          <ol className="flex flex-col gap-1">
            {miningStations.map((i) => (
              <li key={i}>
                <button
                  type="button"
                  aria-pressed={pinnedStation === i}
                  onClick={() => onPinStation(i)}
                  onMouseEnter={() => onHoverStation(i)}
                  onMouseLeave={() => onHoverStation(-1)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm text-white transition-colors',
                    focusStation === i ? 'bg-white/12' : 'hover:bg-white/8',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: stationColor(i) }} />
                    S{i + 1}
                  </span>
                  <span className="tabular-nums">{asteroidCounts[i].toLocaleString()} asteroids</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
        <p className="text-xs text-white">
          {result.stations.length - miningStations.length} processing stations turn their output into{' '}
          {result.productLabel.toLowerCase()}.
        </p>
      </div>
    </section>
  )
}
