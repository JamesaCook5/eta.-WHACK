'use client'

import { cn } from '@/lib/utils'
import type { AsteroidDataset } from '@/lib/asteroids/types'
import type { AsteroidFilters } from '@/lib/asteroids/filters'
import type { MissionParams } from '@/lib/mission/scoring'
import { RESOURCES } from '@/lib/mission/resources'
import type { StartBodyId } from '@/lib/mission/bodies'
import { RangeField, ValueField } from './range-field'
import { Segmented } from './segmented'

const START_BODIES: { id: StartBodyId; label: string }[] = [
  { id: 'earth', label: 'Earth' },
  { id: 'mars', label: 'Mars' },
  { id: 'custom', label: 'Custom' },
]

const formatDiameter = (log: number) => {
  const d = 10 ** log
  return d < 1 ? `${d.toFixed(2)} km` : d < 10 ? `${d.toFixed(1)} km` : `${Math.round(d)} km`
}

interface ControlsPanelProps {
  dataset: AsteroidDataset | null
  filters: AsteroidFilters
  onFiltersChange: (filters: AsteroidFilters) => void
  onResetFilters: () => void
  mission: MissionParams
  onMissionChange: (mission: MissionParams) => void
  className?: string
}

export function ControlsPanel({
  dataset,
  filters,
  onFiltersChange,
  onResetFilters,
  mission,
  onMissionChange,
  className,
}: ControlsPanelProps) {
  const disabled = !dataset
  const classOrder = dataset
    ? dataset.classes
        .map((name, index) => ({ name, index, count: dataset.classCounts[index] }))
        .filter((c) => c.count > 0)
        .sort((a, b) => b.count - a.count)
    : []

  const toggleClass = (index: number) => {
    const next = filters.classes.includes(index)
      ? filters.classes.filter((c) => c !== index)
      : [...filters.classes, index]
    onFiltersChange({ ...filters, classes: next })
  }

  const setMission = <K extends keyof MissionParams>(key: K, value: MissionParams[K]) =>
    onMissionChange({ ...mission, [key]: value })

  return (
    <div className={cn('flex flex-col gap-8', className)}>
      <section aria-labelledby="filters-label" className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <p id="filters-label" className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Filters
          </p>
          <button
            type="button"
            onClick={onResetFilters}
            disabled={disabled}
            className="text-xs text-muted-foreground hover:text-white disabled:opacity-40"
          >
            Reset
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <span id="class-label" className="text-sm text-white/80">
            Taxonomic class
          </span>
          {classOrder.length > 0 ? (
            <div role="group" aria-labelledby="class-label" className="flex flex-wrap gap-1">
              {classOrder.map((c) => {
                const active = filters.classes.includes(c.index)
                return (
                  <button
                    key={c.name}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleClass(c.index)}
                    title={`${c.count.toLocaleString()} asteroids`}
                    className={cn(
                      'h-7 rounded-md px-2 font-mono text-xs transition-colors',
                      active
                        ? 'bg-signal text-[#0e0e0e]'
                        : 'bg-white/6 text-white/80 hover:bg-white/12 hover:text-white',
                    )}
                  >
                    {c.name}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Available once the dataset loads.</p>
          )}
          <p className="text-xs text-muted-foreground">
            {filters.classes.length === 0 ? 'All classes' : `${filters.classes.length} selected`}
          </p>
        </div>

        <RangeField
          id="filter-a"
          label="Semi-major axis"
          range={filters.a}
          step={0.01}
          disabled={disabled}
          format={(v) => `${v.toFixed(2)} au`}
          onChange={(value) => onFiltersChange({ ...filters, a: { ...filters.a, value } })}
        />
        <RangeField
          id="filter-d"
          label="Diameter"
          range={filters.diameterLog}
          step={0.01}
          disabled={disabled}
          format={formatDiameter}
          onChange={(value) =>
            onFiltersChange({ ...filters, diameterLog: { ...filters.diameterLog, value } })
          }
        />
        <RangeField
          id="filter-i"
          label="Inclination"
          range={filters.inclination}
          step={0.5}
          disabled={disabled}
          format={(v) => `${v.toFixed(1)}°`}
          onChange={(value) =>
            onFiltersChange({ ...filters, inclination: { ...filters.inclination, value } })
          }
        />
      </section>

      <section aria-labelledby="mission-label" className="flex flex-col gap-6">
        <p id="mission-label" className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Mission
        </p>
        <Segmented
          label="Starting body"
          options={START_BODIES}
          value={mission.startBody}
          onChange={(v) => setMission('startBody', v)}
        />
        {mission.startBody === 'custom' && (
          <ValueField
            id="mission-custom-a"
            label="Starting orbit radius"
            value={mission.customA}
            min={0.4}
            max={5}
            step={0.01}
            format={(v) => `${v.toFixed(2)} au`}
            onChange={(v) => setMission('customA', v)}
          />
        )}
        <ValueField
          id="mission-dv"
          label="Δv budget"
          value={mission.deltaVBudget}
          min={1}
          max={30}
          step={0.1}
          format={(v) => `${v.toFixed(1)} km/s`}
          onChange={(v) => setMission('deltaVBudget', v)}
        />
        <ValueField
          id="mission-duration"
          label="Mission duration"
          value={mission.durationDays}
          min={30}
          max={3650}
          step={10}
          format={(v) => `${Math.round(v)} d`}
          onChange={(v) => setMission('durationDays', v)}
        />
        <Segmented
          label="Target resource"
          options={RESOURCES}
          value={mission.resource}
          onChange={(v) => setMission('resource', v)}
        />
        <ValueField
          id="mission-top-n"
          label="Candidates shown"
          value={mission.topN}
          min={1}
          max={50}
          step={1}
          format={(v) => `${v}`}
          onChange={(v) => setMission('topN', v)}
        />
      </section>
    </div>
  )
}
