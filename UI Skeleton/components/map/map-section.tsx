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
    <div className="flex h-full w-full items-center justify-center rounded-md bg-[#070707] text-sm text-white/60">
      Loading 3D view…
    </div>
  ),
})
import { ControlsPanel } from './controls-panel'
import { StationsPanel } from './stations-panel'
import { SelectedPanel } from './selected-panel'
import { SupplyPanel } from './supply-panel'
import { estimateFeedstock, MATERIAL_SUPPLY_URL, loadMaterialSupply, type MaterialSupplyModel } from '@/lib/mission/material-supply'
import { CATEGORY_IDS, categoryLabel } from '@/lib/asteroids/class-colors'
import { PRODUCT_SUPPLY_URL, loadProductSupply, prepareProblem, type ProductSupplyModel } from '@/lib/stations/product-supply'
import { DEFAULT_PLAN, type PlanSettings } from '@/lib/stations/settings'
import { useStationPlan } from '@/lib/stations/use-station-plan'
import { stationColor, type StationOverlay } from '@/lib/stations/colors'

const NO_STATIONS: StationOverlay[] = []

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
  const { data: supplyModel } = useSWR<MaterialSupplyModel>(MATERIAL_SUPPLY_URL, loadMaterialSupply, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const { data: productModel } = useSWR<ProductSupplyModel>(PRODUCT_SUPPLY_URL, loadProductSupply, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const [filterState, setFilterState] = useState<AsteroidFilters | null>(null)
  const [supplyMode, setSupplyMode] = useState(false)
  const [view3d, setView3d] = useState(false)
  const [mineralId, setMineralId] = useState('hydrated_phyllosilicates')
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

  // Station plan: the product's DAG inputs → per-asteroid supply → optimiser (in a worker).
  const product = productModel?.products.find((p) => p.id === planSettings.productId) ?? null
  const prepared = useMemo(
    () =>
      dataset && productModel && product && mask && product.elements.length > 0
        ? prepareProblem(dataset, productModel, product, mask)
        : null,
    [dataset, productModel, product, mask],
  )
  const solvable = prepared !== null && prepared.elements.every((el) => el.carriers > 0)
  const plan = useStationPlan(
    solvable ? prepared.problem : null,
    { stations: planSettings.stations, reachHours: planSettings.reachHours, tripYears: planSettings.tripYears },
    solvable ? planSettings.productId : null,
  )
  const planStale = plan.key !== planSettings.productId || !solvable
  const stationCount = !planStale && plan.result ? plan.result.stations.length : 0
  const focusStation = hoverStation >= 0 ? hoverStation : pinnedStation < stationCount ? pinnedStation : -1
  const stationOverlays = useMemo<StationOverlay[]>(() => {
    if (planStale || !plan.result || !dataset || !prepared) return NO_STATIONS
    const result = plan.result
    return result.stations.map((s, k) => {
      const lon = (s.longitude * Math.PI) / 180
      const half = (s.zone.halfAngleDeg * Math.PI) / 180
      const limiting = prepared.elements[s.bottleneck]?.label ?? '—'
      const near = s.suppliers.filter((sp) => sp.dv <= result.reachKmS).length
      return {
        label: `S${k + 1}`,
        color: stationColor(k),
        a: s.a,
        position: [s.a * Math.cos(lon), s.a * Math.sin(lon), 0] as [number, number, number],
        zone: { aMin: s.zone.aMin, aMax: s.zone.aMax, start: lon - half, end: lon + half },
        suppliers: s.suppliers.map((sp) => sp.index),
        dim: focusStation >= 0 && focusStation !== k,
        active: focusStation === k,
        pinned: pinnedStation === k,
        info: {
          title: `S${k + 1} · ${product?.label ?? ''}`,
          lines: [
            `a ${s.a.toFixed(2)} au · e ${s.e.toFixed(2)} · i ${s.i.toFixed(1)}°`,
            `Limited by ${limiting}: ${(s.shares[s.bottleneck] * 100).toFixed(1)}% of supply`,
            `Reach zone ±${s.zone.halfAngleDeg.toFixed(0)}° along orbit, a ${s.zone.aMin.toFixed(2)}–${s.zone.aMax.toFixed(2)} au`,
            `${near} of top ${s.suppliers.length} suppliers within ${result.reachKmS.toFixed(2)} km/s`,
          ],
        },
      }
    })
  }, [plan.result, planStale, dataset, prepared, product, focusStation, pinnedStation])
  // Pulse the station pins for a few seconds whenever a new plan arrives.
  const [freshStations, setFreshStations] = useState(false)
  useEffect(() => {
    if (!plan.result) return
    setFreshStations(true)
    const t = window.setTimeout(() => setFreshStations(false), 3200)
    return () => window.clearTimeout(t)
  }, [plan.result])
  const onStationClick = useCallback((k: number) => setPinnedStation((cur) => (cur === k ? -1 : k)), [])
  const supplyRows = useMemo(
    () => (dataset && supplyModel ? estimateFeedstock(dataset, supplyModel, mineralId, mask) : []),
    [dataset, supplyModel, mineralId, mask],
  )
  // Supply layer: only bodies with an estimated feedstock for the chosen mineral stay bright.
  // Station layer: only filtered bodies that carry one of the product's inputs stay bright.
  const mapMask = useMemo(() => {
    if (!dataset) return mask
    if (supplyMode) {
      const visible = new Uint8Array(dataset.count)
      for (const row of supplyRows) visible[row.index] = 1
      return visible
    }
    if (!prepared) return mask
    const visible = new Uint8Array(dataset.count)
    for (const k of prepared.problem.index) visible[k] = 1
    return visible
  }, [dataset, mask, supplyMode, supplyRows, prepared])
  const mapStations = supplyMode ? NO_STATIONS : stationOverlays
  const visibleCount = useMemo(() => (mask ? mask.reduce((n, v) => n + v, 0) : 0), [mask])

  const emptyMessage = isLoading
    ? 'Loading asteroid data…'
    : error instanceof DatasetMissingError
      ? `No dataset found at ${DATASET_URL}. Add the preprocessed ssoBFT subset there to populate the map.`
      : error
        ? `The dataset could not be read: ${error instanceof Error ? error.message : String(error)}`
        : null

  const controls = (
    <ControlsPanel
      dataset={dataset ?? null}
      filters={filters}
      onFiltersChange={setFilterState}
      onResetFilters={() => setFilterState(null)}
      products={productModel?.products ?? null}
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
          <div className="flex items-center gap-4">
            <p className="font-mono text-xs text-muted-foreground tabular-nums" aria-live="polite">
              {dataset
                ? supplyMode
                  ? `${supplyRows.length.toLocaleString()} mapped ${supplyModel?.minerals[mineralId]?.label.toLowerCase() ?? 'feedstock'} bodies`
                  : prepared
                    ? `${prepared.problem.n.toLocaleString()} of ${visibleCount.toLocaleString()} filtered bodies carry its inputs`
                    : `${visibleCount.toLocaleString()} of ${dataset.count.toLocaleString()} match filters`
                : 'No data'}
            </p>
            <button type="button" onClick={fullscreen.toggle} className="btn glass btn-glass h-8 px-3 text-xs">
              {full ? 'Exit full screen' : 'Full screen'}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex gap-1 rounded-md bg-white/5 p-1" role="group" aria-label="Map layer">
            <button
              type="button"
              aria-pressed={!supplyMode}
              onClick={() => setSupplyMode(false)}
              className={cn('h-8 rounded-md px-3 text-xs transition-colors', !supplyMode ? 'bg-white text-[#0e0e0e]' : 'text-white/75 hover:bg-white/10 hover:text-white')}
            >
              Station plan
            </button>
            <button
              type="button"
              aria-pressed={supplyMode}
              onClick={() => setSupplyMode(true)}
              className={cn('h-8 rounded-md px-3 text-xs transition-colors', supplyMode ? 'bg-white text-[#0e0e0e]' : 'text-white/75 hover:bg-white/10 hover:text-white')}
            >
              Material supply
            </button>
          </div>
          <div className="inline-flex gap-1 rounded-md bg-white/5 p-1" role="group" aria-label="Map dimensions">
            <button
              type="button"
              aria-pressed={!view3d}
              onClick={() => setView3d(false)}
              className={cn('h-8 rounded-md px-3 text-xs transition-colors', !view3d ? 'bg-white text-[#0e0e0e]' : 'text-white/75 hover:bg-white/10 hover:text-white')}
            >
              2D
            </button>
            <button
              type="button"
              aria-pressed={view3d}
              onClick={() => setView3d(true)}
              className={cn('h-8 rounded-md px-3 text-xs transition-colors', view3d ? 'bg-white text-[#0e0e0e]' : 'text-white/75 hover:bg-white/10 hover:text-white')}
            >
              3D
            </button>
          </div>
        </div>

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
                  freshStations={freshStations}
                  onStationHover={setHoverStation}
                  onStationClick={onStationClick}
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
                  freshStations={freshStations}
                  onStationHover={setHoverStation}
                  onStationClick={onStationClick}
                  hovered={hovered}
                  selected={selected}
                  onHover={setHovered}
                  onSelect={setSelected}
                  emptyMessage={emptyMessage}
                />
              )}
            </div>
          </div>

          <div className={cn('flex min-h-0 flex-col gap-4', panelHeight, supplyMode && 'overflow-y-auto')}>
            <SelectedPanel
              record={dataset && selected >= 0 ? dataset.records[selected] : null}
              category={dataset && selected >= 0 ? categoryLabel(CATEGORY_IDS[dataset.category[selected]]) : null}
              onClear={() => setSelected(-1)}
            />
            {supplyMode ? (
              <SupplyPanel
                dataset={dataset ?? null}
                model={supplyModel ?? null}
                mineralId={mineralId}
                onMineralChange={setMineralId}
                mask={mask}
              />
            ) : (
              <StationsPanel
                dataset={dataset ?? null}
                model={productModel ?? null}
                product={product}
                elements={prepared?.elements ?? []}
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
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
