'use client'

import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import type { AsteroidDataset } from '@/lib/asteroids/types'
import { classGroupKey, type AsteroidFilters } from '@/lib/asteroids/filters'
import {
  CATEGORIES,
  CATEGORY_IDS,
  candidateCategories,
  classColor,
  type CategoryId,
} from '@/lib/asteroids/class-colors'
import { REGIONS } from '@/lib/asteroids/regions'
import type { ProductEntry } from '@/lib/stations/product-supply'
import { STATION_LIMITS, STATION_PRESETS, TRIP_LIMITS, type PlanSettings } from '@/lib/stations/settings'
import { RangeField, ValueField } from './range-field'

function Chip({
  active,
  onClick,
  title,
  dot,
  children,
  ...rest
}: {
  active: boolean
  onClick: () => void
  title?: string
  dot?: string
  children: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors',
        active ? 'bg-white text-[#0e0e0e]' : 'bg-white/6 text-white hover:bg-white/12 hover:text-white',
      )}
      {...rest}
    >
      {dot && <span aria-hidden="true" className="size-1.5 rounded-full" style={{ backgroundColor: dot }} />}
      {children}
    </button>
  )
}

function SectionLabel({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-sm font-medium text-white">
      {children}
    </p>
  )
}

/** Products from the manufacturing DAG, grouped; pressing one plans stations for it. */
function ProductPicker({
  products,
  groups,
  value,
  onChange,
}: {
  products: ProductEntry[] | null
  groups: string[]
  value: string
  onChange: (id: string) => void
}) {
  if (!products) {
    return <p className="text-xs text-white">Loading products…</p>
  }
  return (
    <div className="flex flex-col gap-2">
      <span id="product-label" className="text-sm text-white">
        Product
      </span>
      <div
        role="radiogroup"
        aria-labelledby="product-label"
        className="flex max-h-72 flex-col gap-3 overflow-y-auto rounded-md bg-white/4 p-1.5"
      >
        {groups.map((group) => {
          const items = products.filter((p) => p.group === group)
          if (items.length === 0) return null
          return (
            <div key={group} className="flex flex-col gap-0.5">
              <p className="px-1.5 pt-1 pb-0.5 text-[11px] font-medium text-white">
                {group}
              </p>
              {items.map((p) => {
                const active = p.id === value
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onChange(p.id)}
                    title={`${p.elements.length} inputs from asteroids, ${p.imported.length} from Earth`}
                    className={cn(
                      'flex items-baseline justify-between gap-2 rounded-md px-1.5 py-1.5 text-left text-xs transition-colors',
                      active ? 'bg-white text-[#0e0e0e]' : 'text-white hover:bg-white/10 hover:text-white',
                    )}
                  >
                    <span className="min-w-0 truncate">{p.label}</span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface ControlsPanelProps {
  dataset: AsteroidDataset | null
  filters: AsteroidFilters
  onFiltersChange: (filters: AsteroidFilters) => void
  onResetFilters: () => void
  products: ProductEntry[] | null
  groups: string[]
  plan: PlanSettings
  onPlanChange: (plan: PlanSettings) => void
  className?: string
}

export function ControlsPanel({
  dataset,
  filters,
  onFiltersChange,
  onResetFilters,
  products,
  groups: productGroups,
  plan,
  onPlanChange,
  className,
}: ControlsPanelProps) {
  const [openCategory, setOpenCategory] = useState<CategoryId | null>(null)
  const disabled = !dataset

  // Count asteroids per (class, category) pair: mixed classes such as X appear
  // under every category that some of their asteroids were placed in.
  const groups = useMemo(() => {
    if (!dataset) return []
    const counts = new Map<number, number>()
    for (let k = 0; k < dataset.count; k++) {
      const key = classGroupKey(dataset.taxonomy[k], dataset.category[k])
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([key, count]) => {
        const classIndex = Math.floor(key / CATEGORY_IDS.length)
        const category = CATEGORY_IDS[key % CATEGORY_IDS.length]
        const name = dataset.classes[classIndex]
        return {
          key,
          name,
          category,
          count,
          mixed: candidateCategories(name).length > 1,
        }
      })
      .sort((a, b) => b.count - a.count)
  }, [dataset])

  const categories = CATEGORIES.map((cat) => {
    const members = groups.filter((g) => g.category === cat.id)
    return {
      ...cat,
      members,
      count: members.reduce((n, g) => n + g.count, 0),
      selected: members.filter((g) => filters.classes.includes(g.key)).length,
    }
  }).filter((cat) => cat.members.length > 0)
  const open = categories.find((c) => c.id === openCategory) ?? null

  const toggleCategory = (indices: number[]) => {
    const allOn = indices.every((i) => filters.classes.includes(i))
    const next = allOn
      ? filters.classes.filter((i) => !indices.includes(i))
      : [...new Set([...filters.classes, ...indices])]
    onFiltersChange({ ...filters, classes: next })
  }

  const toggle = (list: number[], value: number) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value]

  const setPlan = <K extends keyof PlanSettings>(key: K, value: PlanSettings[K]) =>
    onPlanChange({ ...plan, [key]: value })

  return (
    <div className={cn('flex flex-col gap-8', className)}>
      <section aria-labelledby="station-label" className="flex flex-col gap-6">
        <SectionLabel id="station-label">Stations</SectionLabel>
        <ProductPicker
          products={products}
          groups={productGroups}
          value={plan.productId}
          onChange={(id) => setPlan('productId', id)}
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-white/80">
          <input type="checkbox" checked={plan.hierarchical} onChange={(e) => setPlan('hierarchical', e.target.checked)} className="size-4 accent-[var(--color-signal,#52cbff)]" />
          Production-chain station plan
        </label>
        <StationCount value={plan.stations} onChange={(n) => setPlan('stations', n)} />
        <div className="flex flex-col gap-2">
          <ValueField
            id="station-trip"
            label="Trip time"
            value={plan.tripYears}
            min={TRIP_LIMITS.min}
            max={TRIP_LIMITS.max}
            step={TRIP_LIMITS.step}
            format={(v) => `${v} year${v === 1 ? '' : 's'}`}
            onChange={(v) => setPlan('tripYears', v)}
          />
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-white">
          <input
            type="checkbox"
            checked={plan.includeOuter}
            onChange={(e) => setPlan('includeOuter', e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--color-signal,#52cbff)]"
          />
          <span>Include Centaurs and the Kuiper belt</span>
        </label>
      </section>

      <section aria-labelledby="filters-label" className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <SectionLabel id="filters-label">Filters</SectionLabel>
          <button
            type="button"
            onClick={onResetFilters}
            disabled={disabled}
            className="text-xs text-white hover:opacity-70 disabled:opacity-40"
          >
            Reset
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <span id="class-label" className="text-sm text-white">
            Asteroid type
          </span>
          {groups.length > 0 ? (
            <>
              <div role="group" aria-labelledby="class-label" className="flex flex-wrap gap-1">
                {categories.map((cat) => {
                  const expanded = openCategory === cat.id
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      aria-expanded={expanded}
                      aria-controls="category-classes"
                      onClick={() => setOpenCategory(expanded ? null : cat.id)}
                      title={`${cat.count.toLocaleString()} asteroids in ${cat.members.length} classes`}
                      className={cn(
                        'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors',
                        expanded
                          ? 'bg-white/16 text-white'
                          : 'bg-white/6 text-white hover:bg-white/12 hover:text-white',
                      )}
                    >
                      <span aria-hidden="true" className="flex -space-x-0.5">
                        {cat.members.slice(0, 3).map((g) => (
                          <span
                            key={g.key}
                            className="size-2 rounded-full"
                            style={{
                              backgroundColor: classColor(g.name, g.category),
                            }}
                          />
                        ))}
                      </span>
                      {cat.label}
                      {cat.selected > 0 && (
                        <span className="rounded-sm bg-white/80 px-1 text-[10px] text-[#0e0e0e]">
                          {cat.selected}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              {open && (
                <div
                  id="category-classes"
                  role="group"
                  aria-label={`${open.label} classes`}
                  className="flex flex-wrap gap-1 rounded-md bg-white/4 p-1.5"
                >
                  <Chip
                    active={open.members.every((g) => filters.classes.includes(g.key))}
                    onClick={() => toggleCategory(open.members.map((g) => g.key))}
                    title={`${open.count.toLocaleString()} asteroids`}
                  >
                    All {open.label.toLowerCase()}
                  </Chip>
                  {open.members.map((g) => (
                    <Chip
                      key={g.key}
                      active={filters.classes.includes(g.key)}
                      onClick={() =>
                        onFiltersChange({
                          ...filters,
                          classes: toggle(filters.classes, g.key),
                        })
                      }
                      title={
                        g.mixed
                          ? `${g.count.toLocaleString()} ${g.name} asteroids placed in ${open.label} by brightness`
                          : `${g.count.toLocaleString()} asteroids`
                      }
                      dot={classColor(g.name, g.category)}
                    >
                      {g.name}
                    </Chip>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-white">Loading…</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span id="region-label" className="text-sm text-white">
            Region
          </span>
          <div role="group" aria-labelledby="region-label" className="flex flex-wrap gap-1">
            {REGIONS.map((name, index) => {
              const count = dataset?.regionCounts[index] ?? 0
              if (dataset && count === 0) return null
              return (
                <Chip
                  key={name}
                  active={filters.regions.includes(index)}
                  onClick={() =>
                    onFiltersChange({
                      ...filters,
                      regions: toggle(filters.regions, index),
                    })
                  }
                  title={dataset ? `${count.toLocaleString()} asteroids` : undefined}
                  disabled={disabled}
                >
                  {name}
                </Chip>
              )
            })}
          </div>
        </div>

        <RangeField
          id="filter-i"
          label="Inclination"
          range={filters.inclination}
          step={0.5}
          disabled={disabled}
          format={(v) => `${v.toFixed(1)}°`}
          onChange={(value) =>
            onFiltersChange({
              ...filters,
              inclination: { ...filters.inclination, value },
            })
          }
        />
      </section>
    </div>
  )
}

/**
 * Station count, 1–250: a number field (applied on Enter or when it loses focus,
 * so typing "200" doesn't plan for 2 and 20 on the way), steppers and quick picks.
 */
function StationCount({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const clamp = (n: number) => Math.min(STATION_LIMITS.max, Math.max(STATION_LIMITS.min, Math.round(n)))
  const commit = () => {
    const n = Number(draft)
    if (!Number.isFinite(n) || draft.trim() === '') return setDraft(String(value))
    const next = clamp(n)
    setDraft(String(next))
    if (next !== value) onChange(next)
  }
  const stepper =
    'h-8 w-8 shrink-0 rounded-md text-sm text-white transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30'
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor="station-count" className="text-sm text-white">
          Stations
        </label>
      </div>
      <div className="flex items-center gap-1 rounded-md bg-white/5 p-1">
        <button
          type="button"
          aria-label="One fewer station"
          className={stepper}
          disabled={value <= STATION_LIMITS.min}
          onClick={() => onChange(clamp(value - 1))}
        >
          −
        </button>
        <input
          id="station-count"
          type="number"
          inputMode="numeric"
          min={STATION_LIMITS.min}
          max={STATION_LIMITS.max}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          className="h-8 min-w-0 flex-1 rounded-md bg-white/8 text-center text-sm text-white tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-white/60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          aria-label="One more station"
          className={stepper}
          disabled={value >= STATION_LIMITS.max}
          onClick={() => onChange(clamp(value + 1))}
        >
          +
        </button>
      </div>
      <div role="group" aria-label="Quick picks" className="flex gap-1">
        {STATION_PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={value === n}
            onClick={() => onChange(n)}
            className={cn(
              'h-7 flex-1 rounded-md text-[11px] transition-colors',
              value === n ? 'bg-white text-[#0e0e0e]' : 'bg-white/5 text-white hover:bg-white/10 hover:text-white',
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}
