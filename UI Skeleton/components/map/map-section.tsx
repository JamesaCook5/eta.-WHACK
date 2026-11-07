'use client'

import { useDeferredValue, useMemo, useState } from 'react'
import useSWR from 'swr'
import { DATASET_URL, DatasetMissingError, loadDataset } from '@/lib/asteroids/load'
import { applyFilters, defaultFilters, type AsteroidFilters } from '@/lib/asteroids/filters'
import { rankCandidates } from '@/lib/mission/rank'
import type { MissionParams } from '@/lib/mission/scoring'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { MapCanvas } from './map-canvas'
import { ControlsPanel } from './controls-panel'
import { CandidatesPanel } from './candidates-panel'
import { SelectedPanel } from './selected-panel'

const DEFAULT_MISSION: MissionParams = {
  startBody: 'earth',
  customA: 2.2,
  deltaVBudget: 10,
  durationDays: 900,
  resource: 'water',
  topN: 10,
}

export function MapSection() {
  const { data: dataset, error, isLoading } = useSWR(DATASET_URL, loadDataset, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
  })
  const [filterState, setFilterState] = useState<AsteroidFilters | null>(null)
  const [mission, setMission] = useState<MissionParams>(DEFAULT_MISSION)
  const [hovered, setHovered] = useState(-1)
  const [selected, setSelected] = useState(-1)

  const filters = filterState ?? defaultFilters(dataset ?? null)
  const deferredFilters = useDeferredValue(filters)
  const deferredMission = useDeferredValue(mission)

  const mask = useMemo(
    () => (dataset ? applyFilters(dataset, deferredFilters) : null),
    [dataset, deferredFilters],
  )
  const ranked = useMemo(
    () => (dataset && mask ? rankCandidates(dataset, mask, deferredMission) : []),
    [dataset, mask, deferredMission],
  )
  const candidateIndices = useMemo(() => ranked.map((c) => c.index), [ranked])
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
      mission={mission}
      onMissionChange={setMission}
    />
  )

  return (
    <section id="map" aria-labelledby="map-title" className="px-4 py-24">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="map-title" className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
            Asteroid map
          </h2>
          <p className="font-mono text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {dataset
              ? `${visibleCount.toLocaleString()} of ${dataset.count.toLocaleString()} match filters`
              : 'No data'}
          </p>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)_20rem]">
          <aside aria-label="Map controls" className="glass hidden rounded-md lg:block">
            <div className="max-h-[46rem] overflow-y-auto p-5">{controls}</div>
          </aside>

          <div className="flex flex-col gap-3">
            <Sheet>
              <SheetTrigger className="btn glass btn-glass w-full lg:hidden">Filters and mission</SheetTrigger>
              <SheetContent
                side="bottom"
                className="max-h-[85svh] overflow-y-auto rounded-t-md border-0 bg-[#141414] p-5 pt-6 text-white shadow-none"
              >
                <SheetTitle className="sr-only">Filters and mission</SheetTitle>
                {controls}
              </SheetContent>
            </Sheet>
            <div className="h-[62svh] min-h-80 lg:h-[46rem]">
              <MapCanvas
                dataset={dataset ?? null}
                mask={mask}
                candidates={candidateIndices}
                hovered={hovered}
                selected={selected}
                onHover={setHovered}
                onSelect={setSelected}
                startBody={mission.startBody}
                customA={mission.customA}
                emptyMessage={emptyMessage}
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-4 lg:max-h-[46rem]">
            <SelectedPanel
              record={dataset && selected >= 0 ? dataset.records[selected] : null}
              onClear={() => setSelected(-1)}
            />
            <CandidatesPanel
              dataset={dataset ?? null}
              candidates={ranked}
              selected={selected}
              onSelect={setSelected}
              onHover={setHovered}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
