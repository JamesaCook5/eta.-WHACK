'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import dynamic from 'next/dynamic'
import { cn } from '@/lib/utils'
import { DATASET_URL, DatasetMissingError, loadDataset } from '@/lib/asteroids/load'
import { applyFilters, defaultFilters, type AsteroidFilters } from '@/lib/asteroids/filters'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { MapCanvas } from './map-canvas'

// three.js is only downloaded when someone switches to the 3D view.
const Map3D = dynamic(() => import('./map-3d').then((m) => m.Map3D), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-md bg-[#070707] text-sm text-white">
      Loading 3D view…
    </div>
  ),
})
import { ControlsPanel } from './controls-panel'
import { StationsPanel } from './stations-panel'
import { SelectedPanel } from './selected-panel'
import { HierarchyPanel } from './hierarchy-panel'
import { CATEGORY_IDS, categoryLabel } from '@/lib/asteroids/class-colors'
import { PRODUCT_SUPPLY_URL, loadProductSupply, type ProductSupplyModel } from '@/lib/stations/product-supply'
import { packMask, requestHierarchy, type HierarchyResult } from '@/lib/stations/api'
import { DEFAULT_PLAN, MONTE_CARLO_DRAWS, type PlanSettings } from '@/lib/stations/settings'
import { useStationPlan } from '@/lib/stations/use-station-plan'
import { hexToRgb01, stationColor, type StationOverlay } from '@/lib/stations/colors'

const NO_STATIONS: StationOverlay[] = []
/** Above this many stations, only mining stations and the focused one get map pins. */
const PIN_LIMIT = 60
const OUTPUT_PALETTE = [
  ['#7f1d1d', '#b91c1c', '#ef4444'],
  ['#854d0e', '#ca8a04', '#facc15'],
  ['#14532d', '#16a34a', '#4ade80'],
  ['#1e3a8a', '#2563eb', '#60a5fa'],
]

/**
 * Full screen for the map and both sidebars. Uses the Fullscreen API where the
 * browser supports it on elements; otherwise (e.g. iPhone Safari) the shell is
 * pinned over the page with CSS.
 */
function useFullscreen(ref: React.RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false)
  const [native, setNative] = useState(false)

  useEffect(() => {
    const onChange = () => {
      const isFull = document.fullscreenElement === ref.current
      setNative(isFull)
      if (!isFull) setActive(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [ref])

  // CSS fallback: lock page scroll and close on Escape.
  useEffect(() => {
    if (!active || native) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setActive(false)
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [active, native])

  const toggle = useCallback(async () => {
    const el = ref.current
    if (!el) return
    if (active) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
      setActive(false)
      return
    }
    setActive(true)
    if (el.requestFullscreen && document.fullscreenEnabled) {
      await el.requestFullscreen().catch(() => setNative(false))
    }
  }, [active, ref])

  return { active, toggle }
}

export function MapSection() {
  const { data: dataset, error, isLoading } = useSWR(DATASET_URL, loadDataset, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
  })
  const { data: productModel } = useSWR<ProductSupplyModel>(PRODUCT_SUPPLY_URL, loadProductSupply, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const [filterState, setFilterState] = useState<AsteroidFilters | null>(null)
  const [view3d, setView3d] = useState(false)
  const [planSettings, setPlanSettings] = useState<PlanSettings>(DEFAULT_PLAN)
  // Station in focus on the map: hovered card wins over a pinned one.
  const [hoverStation, setHoverStation] = useState(-1)
  const [pinnedStation, setPinnedStation] = useState(-1)
  useEffect(() => setPinnedStation(-1), [planSettings.productId])
  const [hovered, setHovered] = useState(-1)
  const [selected, setSelected] = useState(-1)
  const shellRef = useRef<HTMLDivElement>(null)
  const fullscreen = useFullscreen(shellRef)
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
  useEffect(() => setPortalContainer(shellRef.current), [])

  // Memoised so the mask (and the station plan that depends on it) is not rebuilt on every render.
  const initialFilters = useMemo(() => defaultFilters(dataset ?? null), [dataset])
  const filters = filterState ?? initialFilters
  const deferredFilters = useDeferredValue(filters)

  const mask = useMemo(
    () => (dataset ? applyFilters(dataset, deferredFilters) : null),
    [dataset, deferredFilters],
  )

  // Station plan: computed by the Python planner (asteroid_industry/api.py) for the
  // product and the filtered asteroids; the UI only draws what it returns.
  const visibleProducts = productModel?.products.filter((p) => !/conceptual|future concept/i.test(p.label)) ?? null
  const product = visibleProducts?.find((p) => p.id === planSettings.productId) ?? null
  const packedMask = useMemo(() => (mask ? packMask(mask) : null), [mask])
  const planRequest = useMemo(
    () =>
      product && product.elements.length > 0 && packedMask
        ? {
            product: product.id,
            stations: planSettings.stations,
            trip_years: planSettings.tripYears,
            include_outer: planSettings.includeOuter,
            mask: packedMask,
          }
        : null,
    [product, packedMask, planSettings.stations, planSettings.tripYears, planSettings.includeOuter],
  )
  // The flat planner's one-product plan and Monte Carlo cloud are irrelevant in
  // hierarchical mode; only request it when that layer is selected.
  const plan = useStationPlan(planSettings.hierarchical ? null : planRequest, MONTE_CARLO_DRAWS)
  const [hierarchyResult, setHierarchyResult] = useState<HierarchyResult | null>(null)
  const [hierarchyError, setHierarchyError] = useState<string | null>(null)
  useEffect(() => {
    if (!planSettings.hierarchical || !planRequest) { setHierarchyResult(null); setHierarchyError(null); return }
    setHierarchyResult(null)
    setHierarchyError(null)
    const abort = new AbortController()
    const timer = window.setTimeout(() => requestHierarchy(planRequest, abort.signal).then(setHierarchyResult).catch((err) => {
      if (!abort.signal.aborted) setHierarchyError(err instanceof Error ? err.message : String(err))
    }), 200)
    return () => { clearTimeout(timer); abort.abort() }
  }, [planSettings.hierarchical, planRequest])
  const planKey = planRequest ? JSON.stringify(planRequest) : null
  // The plan on screen must belong to the current request, not an older product or filter set.
  const planStale = !plan.result || plan.key !== planKey
  const planResult = planStale ? null : plan.result
  const elementLabels = useMemo(
    () => Object.fromEntries((productModel?.elements ?? []).map((el) => [el.id, el.label])),
    [productModel],
  )
  const stationCount = planSettings.hierarchical ? hierarchyResult?.stations.length ?? 0 : planResult?.stations.length ?? 0
  useEffect(() => setHoverStation(-1), [stationCount])
  // A hovered pin can unmount without a mouseleave (fewer stations in the new plan), so check both against the count.
  const focusStation =
    hoverStation >= 0 && hoverStation < stationCount ? hoverStation : pinnedStation < stationCount ? pinnedStation : -1
  // Production chain: the mining (tier 0) stations are the ones the asteroid assignment
  // indexes, in order; count how many asteroids each is connected to.
  const miningStations = useMemo(
    () => (hierarchyResult ? hierarchyResult.stations.flatMap((s, k) => (s.tier === 0 && !s.process ? [k] : [])) : []),
    [hierarchyResult],
  )
  const asteroidCounts = useMemo(() => {
    const counts = new Array(hierarchyResult?.stations.length ?? 0).fill(0)
    if (!hierarchyResult) return counts
    const a = hierarchyResult.asteroidAssignment
    for (let j = 0; j < a.length; j++) {
      const k = miningStations[a[j]]
      if (a[j] !== 255 && k !== undefined) counts[k]++
    }
    return counts
  }, [hierarchyResult, miningStations])
  // Big production-chain plans have thousands of stations. Only mining stations and the
  // one in focus get a pin and orbit ring; the rest are drawn as plain dots.
  const pinnedIndices = useMemo(() => {
    if (!planSettings.hierarchical || !hierarchyResult) return null
    const n = hierarchyResult.stations.length
    if (n <= PIN_LIMIT) return null
    const keep = new Set(miningStations)
    if (focusStation >= 0) keep.add(focusStation)
    if (pinnedStation >= 0 && pinnedStation < n) keep.add(pinnedStation)
    return [...keep].sort((x, y) => x - y)
  }, [planSettings.hierarchical, hierarchyResult, miningStations, focusStation, pinnedStation])
  const outputStationColors = useMemo(() => {
    if (!hierarchyResult) return []
    const maxOutput = Math.max(0, ...hierarchyResult.stations.flatMap((s) => Object.values(s.output ?? {})))
    return hierarchyResult.stations.map((s, k) => {
      const largestOutput = Math.max(0, ...Object.values(s.output ?? {}))
      const colorBand = largestOutput > 0 && maxOutput > 0
        ? Math.min(3, Math.max(0, Math.floor(Math.log10(maxOutput / largestOutput) / 3 + 1e-10)))
        : 0
      return OUTPUT_PALETTE[colorBand][k % 3]
    })
  }, [hierarchyResult])
  const stationDots = useMemo(() => {
    if (!planSettings.hierarchical || !hierarchyResult || hierarchyResult.stations.length <= PIN_LIMIT) return null
    const groups = new Map<string, number[]>()
    const pinned = new Set(pinnedIndices ?? [])
    for (const [k, s] of hierarchyResult.stations.entries()) {
      if (pinned.has(k)) continue
      const color = outputStationColors[k] ?? stationColor(k)
      const points = groups.get(color) ?? []
      const lon = (s.longitude * Math.PI) / 180
      points.push(s.a * Math.cos(lon), s.a * Math.sin(lon))
      groups.set(color, points)
    }
    return [...groups].map(([color, points]) => ({ color, points: new Float32Array(points) }))
  }, [planSettings.hierarchical, hierarchyResult, pinnedIndices, outputStationColors])
  const stationOverlays = useMemo<StationOverlay[]>(() => {
    if (planSettings.hierarchical && hierarchyResult) {
      const indices = pinnedIndices ?? hierarchyResult.stations.map((_, k) => k)
      return indices.map((k) => {
        const s = hierarchyResult.stations[k]
        const mining = s.tier === 0 && !s.process
        const lon = (s.longitude * Math.PI) / 180
        const entries = (obj?: Record<string, number>) => Object.entries(obj ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, amount]) => `${name} ${amount.toPrecision(3)} t`).join(' · ') || 'none'
        return {
          label: `S${k + 1}`,
          color: outputStationColors[k] ?? stationColor(k),
          a: s.a,
          position: [s.a * Math.cos(lon), s.a * Math.sin(lon), 0] as [number, number, number],
          cloud: null,
          dim: focusStation >= 0 && focusStation !== k,
          active: focusStation === k,
          pinned: pinnedStation === k,
          compact: hierarchyResult.stations.length > 24,
          info: {
            title: `${s.material}${s.process ? ` · ${s.process}` : ''}`,
            lines: [
              `Process: ${s.process ?? 'Raw asteroid extraction'}`,
              `Inputs: ${entries(s.inputs)}`,
              `Outputs: ${entries(s.output)}`,
              mining ? `${asteroidCounts[k].toLocaleString()} asteroids connected` : `${s.members} suppliers · ${(s.share * 100).toFixed(1)}% of supply`,
              `${s.a.toFixed(2)} AU from the Sun`,
            ],
          },
        }
      })
    }
    if (planSettings.hierarchical) return NO_STATIONS
    if (!planResult) return NO_STATIONS
    const result = planResult
    const required = new Set(result.required)
    return result.stations.map((s, k) => {
      const lon = (s.longitude * Math.PI) / 180
      const total = s.output.reduce((sum, v) => sum + v, 0)
      const mix = s.output
        .map((v, e) => ({ id: result.elements[e], v }))
        .filter((x) => required.has(x.id))
        .sort((p, q) => q.v - p.v)
        .slice(0, 3)
        .map((x) => `${elementLabels[x.id] ?? x.id} ${total > 0 ? ((x.v / total) * 100).toFixed(1) : '0'}%`)
        .join(', ')
      const cloud = result.cloud?.[k] ?? null
      return {
        label: `S${k + 1}`,
        color: stationColor(k),
        a: s.a,
        position: [s.a * Math.cos(lon), s.a * Math.sin(lon), 0] as [number, number, number],
        cloud,
        dim: focusStation >= 0 && focusStation !== k,
        active: focusStation === k,
        pinned: pinnedStation === k,
        compact: result.stations.length > 24,
        info: {
          title: `S${k + 1}: ${product?.label ?? ''}`,
          lines: [
            `${s.a.toFixed(2)} AU from the Sun`,
            `${s.members.toLocaleString()} asteroids, ${(s.share * 100).toFixed(1)}% of the material`,
            `Mostly ${mix}`,
            `Typical trip ${s.dvMedian.toFixed(1)} km/s`,
          ],
        },
      }
    })
  }, [planResult, hierarchyResult, planSettings.hierarchical, pinnedIndices, asteroidCounts, outputStationColors, elementLabels, product, focusStation, pinnedStation])
  // Pulse the station pins for a few seconds whenever a new plan arrives.
  const [freshStations, setFreshStations] = useState(false)
  const nominalResult = !planSettings.hierarchical && plan.status === 'sampling' ? plan.result : null
  useEffect(() => {
    if (!nominalResult) return
    setFreshStations(true)
    const t = window.setTimeout(() => setFreshStations(false), 3200)
    return () => window.clearTimeout(t)
  }, [nominalResult])
  const onStationClick = useCallback((k: number) => setPinnedStation((cur) => (cur === k ? -1 : k)), [])
  // Every planned body stays bright; bodies left out of the plan fade.
  const mapMask = useMemo(() => {
    if (!dataset) return mask
    if (planSettings.hierarchical) {
      if (!hierarchyResult) return mask
      const visible = new Uint8Array(dataset.count)
      const assignment = hierarchyResult.asteroidAssignment
      for (let j = 0; j < visible.length; j++) visible[j] = (mask?.[j] ?? 1) && assignment[j] !== 255 ? 1 : 0
      return visible
    }
    const assignment = planResult?.assignment
    if (!assignment) return mask
    const visible = new Uint8Array(dataset.count)
    for (let j = 0; j < visible.length; j++) visible[j] = assignment[j] === 255 ? 0 : 1
    return visible
  }, [dataset, mask, planResult, planSettings.hierarchical, hierarchyResult])
  // Station layer colours: every asteroid in its station's colour.
  // Bodies with none of the product's inputs, and ones that change station across the
  // Monte Carlo draws, are drawn darker; other stations go grey while one is in focus.
  const stationColors = useMemo(() => {
    if (!dataset) return null
    if (planSettings.hierarchical) {
      if (!hierarchyResult) return null
      const out = new Uint8Array(dataset.count * 3).fill(70)
      const assignment = hierarchyResult.asteroidAssignment
      const focusMining = focusStation >= 0 && miningStations.includes(focusStation)
      for (let j = 0; j < dataset.count; j++) {
        const k = miningStations[assignment[j]]
        if (assignment[j] === 255 || k === undefined) continue
        const o = j * 3
        if (focusMining && k !== focusStation) {
          out[o] = out[o + 1] = out[o + 2] = 85
          continue
        }
        const [r, g, b] = hexToRgb01(outputStationColors[k] ?? stationColor(k))
        out[o] = 255 * r
        out[o + 1] = 255 * g
        out[o + 2] = 255 * b
      }
      return out
    }
    if (!planResult?.assignment) return null
    const { assignment, stability, carries } = planResult
    const rgb = planResult.stations.map((_, k) => hexToRgb01(stationColor(k)).map((v) => v * 255))
    const out = new Uint8Array(dataset.count * 3).fill(70)
    for (let j = 0; j < dataset.count; j++) {
      const k = assignment[j]
      if (k === 255) continue
      const o = j * 3
      if (focusStation >= 0 && k !== focusStation) {
        out[o] = out[o + 1] = out[o + 2] = 85
        continue
      }
      const f = (carries[j] ? 1 : 0.4) * (stability ? 0.45 + (0.55 * stability[j]) / 255 : 1)
      out[o] = rgb[k][0] * f
      out[o + 1] = rgb[k][1] * f
      out[o + 2] = rgb[k][2] * f
    }
    return out
  }, [dataset, planResult, focusStation, planSettings.hierarchical, hierarchyResult, miningStations, outputStationColors])
  const mapStations = stationOverlays
  // The maps report positions in mapStations; turn them back into station numbers.
  const onMapStationHover = useCallback((i: number) => setHoverStation(i < 0 ? -1 : (pinnedIndices?.[i] ?? i)), [pinnedIndices])
  const onMapStationClick = useCallback((i: number) => onStationClick(pinnedIndices?.[i] ?? i), [pinnedIndices, onStationClick])
  const visibleCount = useMemo(() => (mask ? mask.reduce((n, v) => n + v, 0) : 0), [mask])

  const emptyMessage = isLoading
    ? 'Loading asteroid data…'
    : error instanceof DatasetMissingError
      ? `The asteroid data is missing (expected at ${DATASET_URL}).`
      : error
        ? `The dataset could not be read: ${error instanceof Error ? error.message : String(error)}`
        : null

  const controls = (
    <ControlsPanel
      dataset={dataset ?? null}
      filters={filters}
      onFiltersChange={setFilterState}
      onResetFilters={() => setFilterState(null)}
      products={visibleProducts}
      groups={productModel?.groups ?? []}
      plan={planSettings}
      onPlanChange={setPlanSettings}
    />
  )

  const full = fullscreen.active
  const panelHeight = full ? 'lg:h-full lg:max-h-none' : 'lg:max-h-[46rem]'

  return (
    <section id="map" aria-labelledby="map-title" className="px-4 py-24">
      <div
        ref={shellRef}
        className={cn(
          'mx-auto max-w-7xl',
          full && 'fixed inset-0 z-50 flex max-w-none flex-col overflow-y-auto bg-[#05070b] p-3 sm:p-4 lg:overflow-hidden',
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2
            id="map-title"
            className={cn('font-display font-medium tracking-tight', full ? 'text-xl' : 'text-3xl sm:text-4xl')}
          >
            Asteroid map
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-white tabular-nums" aria-live="polite">
              {dataset
                ? planSettings.hierarchical && hierarchyResult
                    ? `${miningStations.length} mining and ${hierarchyResult.stations.length - miningStations.length} processing stations`
                    : planResult?.assignment
                    ? `${planResult.planned.toLocaleString()} asteroids shared between ${planResult.stations.length} station${planResult.stations.length === 1 ? '' : 's'}`
                    : `Showing ${visibleCount.toLocaleString()} of ${dataset.count.toLocaleString()} asteroids`
                : ''}
            </p>
            <div className="inline-flex gap-1 rounded-md bg-white/5 p-1" role="group" aria-label="Map view">
              {([false, true] as const).map((is3d) => (
                <button
                  key={String(is3d)}
                  type="button"
                  aria-pressed={view3d === is3d}
                  onClick={() => setView3d(is3d)}
                  className={cn(
                    'h-6 rounded px-2.5 text-xs transition-colors',
                    view3d === is3d ? 'bg-white text-[#0e0e0e]' : 'text-white hover:bg-white/10 hover:text-white',
                  )}
                >
                  {is3d ? '3D' : '2D'}
                </button>
              ))}
            </div>
            <button type="button" onClick={fullscreen.toggle} className="btn glass btn-glass h-8 px-3 text-xs">
              {full ? 'Exit full screen' : 'Full screen'}
            </button>
          </div>
        </div>

        {planSettings.hierarchical && (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-white/65" aria-label="Station colors by logarithmic output amount">
            {[
              ['#b91c1c', '0–1,000× below max'],
              ['#ca8a04', '1,000×–1M× below max'],
              ['#16a34a', '1M×–1B× below max'],
              ['#2563eb', '>1B× below max'],
            ].map(([color, label]) => (
              <span key={label} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: color }} />
                {label}
              </span>
            ))}
          </div>
        )}
        <div
          className={cn(
            'grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)_20rem]',
            full ? 'mt-3 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)]' : 'mt-6',
          )}
        >
          <aside aria-label="Map controls" className={cn('glass hidden min-h-0 rounded-md lg:block', panelHeight)}>
            <div className={cn('overflow-y-auto p-5', full ? 'h-full' : 'max-h-[46rem]')}>{controls}</div>
          </aside>

          <div className="flex min-h-0 flex-col gap-3">
            <Sheet>
              <SheetTrigger className="btn glass btn-glass w-full lg:hidden">Filters and stations</SheetTrigger>
              <SheetContent
                side="bottom"
                container={portalContainer}
                className="max-h-[85svh] overflow-y-auto rounded-t-md border-0 bg-[#141414] p-5 pt-6 text-white shadow-none"
              >
                <SheetTitle className="sr-only">Filters and stations</SheetTitle>
                {controls}
              </SheetContent>
            </Sheet>
            <div className={cn(full ? 'h-[75svh] min-h-80 lg:h-auto lg:min-h-0 lg:flex-1' : 'h-[62svh] min-h-80 lg:h-[46rem]')}>
              {view3d ? (
                <Map3D
                  dataset={dataset ?? null}
                  mask={mapMask}
                  stations={mapStations}
                  colors={stationColors}
                  freshStations={freshStations}
                  stationDots={stationDots}
                  onStationHover={onMapStationHover}
                  onStationClick={onMapStationClick}
                  hovered={hovered}
                  selected={selected}
                  onHover={setHovered}
                  onSelect={setSelected}
                  emptyMessage={emptyMessage}
                />
              ) : (
                <MapCanvas
                  dataset={dataset ?? null}
                  mask={mapMask}
                  stations={mapStations}
                  colors={stationColors}
                  freshStations={freshStations}
                  stationDots={stationDots}
                  onStationHover={onMapStationHover}
                  onStationClick={onMapStationClick}
                  hovered={hovered}
                  selected={selected}
                  onHover={setHovered}
                  onSelect={setSelected}
                  emptyMessage={emptyMessage}
                />
              )}
            </div>
          </div>

          <div className={cn('flex min-h-0 flex-col gap-4', panelHeight)}>
            <SelectedPanel
              record={dataset && selected >= 0 ? dataset.records[selected] : null}
              category={dataset && selected >= 0 ? categoryLabel(CATEGORY_IDS[dataset.category[selected]]) : null}
              onClear={() => setSelected(-1)}
            />
            {!planSettings.hierarchical ? (
              <StationsPanel
                dataset={dataset ?? null}
                model={productModel ?? null}
                product={product}
                labels={elementLabels}
                plan={plan}
                stale={planStale}
                focusStation={focusStation}
                pinnedStation={pinnedStation}
                onHoverStation={setHoverStation}
                onPinStation={onStationClick}
                selected={selected}
                onSelect={setSelected}
                onHover={setHovered}
              />
            ) : (
              <HierarchyPanel
                result={hierarchyResult}
                error={hierarchyError}
                asteroidCounts={asteroidCounts}
                miningStations={miningStations}
                focusStation={focusStation}
                pinnedStation={pinnedStation}
                onHoverStation={setHoverStation}
                onPinStation={onStationClick}
                colors={outputStationColors}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
