'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { HierarchyResult } from '@/lib/stations/api'

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
  colors: string[]
  feedstockColors: string[]
  onHoverStation: (k: number) => void
  onPinStation: (k: number) => void
}

/** Right-hand panel for the production-chain plan: mining stations and the station you click. */
export function HierarchyPanel({ result, error, asteroidCounts, miningStations, focusStation, pinnedStation, colors, feedstockColors, onHoverStation, onPinStation }: Props) {
  const [stationFilter, setStationFilter] = useState('')
  if (error) return <p className="glass rounded-md p-4 text-sm text-red-200">Production plan failed: {error}</p>
  if (!result) return <p className="glass rounded-md p-5 text-sm text-white">Planning the production chain…</p>
  if (result.stations.length === 0) return <p className="glass rounded-md p-5 text-sm text-white">No asteroid-sourced stations could be placed for this product and filter.</p>

  const k = pinnedStation >= 0 && pinnedStation < result.stations.length ? pinnedStation : -1
  const s = k >= 0 ? result.stations[k] : null
  const mining = s ? miningStations.includes(k) : false
  const miningSet = new Set(miningStations)
  const entries = (values?: Record<string, number>) =>
    Object.entries(values ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, amount]) => `${prettyMaterial(name)} ${amount.toPrecision(3)} t`).join(' · ') || 'none'
  const query = stationFilter.trim().toLowerCase()
  const processingStations = result.stations.flatMap((station, index) =>
    miningSet.has(index) ? [] : [{ station, index }],
  )
  const matchingStations = processingStations.filter(({ station, index }) =>
    !query || `s${index + 1} ${station.material} ${station.process ?? ''}`.toLowerCase().includes(query),
  )
  const shownStations = matchingStations.slice(0, 40)

  return (
    <section aria-labelledby="hierarchy-label" className="glass flex min-h-0 flex-col rounded-md">
      <p id="hierarchy-label" className="px-5 pt-5 pb-3 text-sm font-medium text-white">
        Where the stations go
      </p>
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
        {result.production && (
          <p className="text-xs text-white">
            Modeled output: {result.production.availableKg.toPrecision(3)} kg of {result.production.demandKg.toPrecision(3)} kg
            {' '}({(result.production.coverage * 100).toFixed(1)}% supplied)
          </p>
        )}
        {result.quantitiesInferred && (
          <p className="rounded-md bg-amber-200/10 p-2 text-xs text-amber-100">
            Some recipe quantities are missing; those steps use a 1 kg per kg target estimate.
          </p>
        )}
        {s ? (
          <div className="flex flex-col gap-2 rounded-md bg-white/4 p-3" style={{ boxShadow: `inset 0 0 0 1.5px ${colors[k] ?? '#ffffff'}` }}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm text-white">
                <span aria-hidden="true" className="size-2.5 rotate-45 rounded-[1px]" style={{ backgroundColor: mining ? feedstockColors[k] ?? colors[k] ?? '#ffffff' : colors[k] ?? '#ffffff' }} />
                S{k + 1}
              </span>
              <button type="button" onClick={() => onPinStation(k)} className="text-xs text-white hover:opacity-70">
                Close
              </button>
            </div>
            <p className="text-sm text-white">{mining ? 'Mining station' : prettyMaterial(s.material)}</p>
            <p className="text-xs text-white">Process: {s.process ?? 'Raw asteroid extraction'}</p>
            <p className="text-xs text-white">Inputs: {entries(s.inputs)}</p>
            <p className="text-xs text-white">Outputs: {entries(s.output)}</p>
            {mining && (
              <>
                <p className="text-2xl font-medium text-white tabular-nums">{asteroidCounts[k].toLocaleString()} asteroids</p>
                <p className="text-xs text-white">connected to this station</p>
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
                    <span aria-hidden="true" className="size-2.5 rotate-45 rounded-[1px]" style={{ backgroundColor: feedstockColors[i] ?? colors[i] ?? '#ffffff' }} />
                    S{i + 1}
                  </span>
                  <span className="tabular-nums">{asteroidCounts[i].toLocaleString()} asteroids</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
        {processingStations.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="hierarchy-station-search" className="text-xs font-medium text-white">
              Processing stations ({processingStations.length})
            </label>
            <input
              id="hierarchy-station-search"
              type="search"
              value={stationFilter}
              onChange={(event) => setStationFilter(event.target.value)}
              placeholder="Search material, process or S number"
              className="h-8 rounded-md border border-white/10 bg-white/5 px-2 text-xs text-white placeholder:text-white/45"
            />
            <p className="text-[11px] text-white/70">
              {matchingStations.length > shownStations.length
                ? `Showing ${shownStations.length} of ${matchingStations.length}; search material, process or station number to narrow the list.`
                : `${matchingStations.length} matching stations`}
            </p>
            <ol className="flex max-h-56 flex-col gap-1 overflow-y-auto">
              {shownStations.map(({ station, index }) => (
                <li key={index}>
                  <button
                    type="button"
                    aria-pressed={pinnedStation === index}
                    onClick={() => onPinStation(index)}
                    onMouseEnter={() => onHoverStation(index)}
                    onMouseLeave={() => onHoverStation(-1)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-white transition-colors',
                      focusStation === index ? 'bg-white/12' : 'hover:bg-white/8',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden="true" className="size-2.5 shrink-0 rotate-45 rounded-[1px]" style={{ backgroundColor: colors[index] ?? '#ffffff' }} />
                      <span className="truncate">S{index + 1} · {prettyMaterial(station.material)}</span>
                    </span>
                    <span className="shrink-0 text-white/65">{station.members} suppliers</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
        <p className="text-xs text-white">
          Select a station here to focus it on the map and inspect its inputs and outputs.
        </p>
      </div>
    </section>
  )
}
