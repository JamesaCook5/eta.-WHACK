'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { AsteroidDataset } from '@/lib/asteroids/types'
import { asteroidLabel } from '@/lib/asteroids/label'
import type { ProductEntry, ProductSupplyModel } from '@/lib/stations/product-supply'
import type { PlannedStation, PlanResult, Range } from '@/lib/stations/api'
import type { PlanState } from '@/lib/stations/use-station-plan'
import { stationColor } from '@/lib/stations/colors'

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const sup = (n: number) =>
  String(n)
    .split('')
    .map((c) => (c === '-' ? '⁻' : SUPERSCRIPT[Number(c)]))
    .join('')

/** Two significant figures without exponent notation (680, 4.2, 0.37). */
const sig2 = (v: number) => String(Number(v.toPrecision(2)))

/** Tonnes as "4.2 Mt", "310 Gt" or "3.8 × 10¹³ t". */
export function formatTonnes(t: number) {
  if (!(t > 0)) return '0 t'
  if (t < 1e3) return `${sig2(t)} t`
  if (t < 1e6) return `${sig2(t / 1e3)} kt`
  if (t < 1e9) return `${sig2(t / 1e6)} Mt`
  if (t < 1e12) return `${sig2(t / 1e9)} Gt`
  const exp = Math.floor(Math.log10(t))
  return `${(t / 10 ** exp).toFixed(1)} × 10${sup(exp)} t`
}

const pct = (v: number) => (v >= 0.1 ? `${(v * 100).toFixed(1)}%` : v >= 0.001 ? `${(v * 100).toFixed(2)}%` : '<0.1%')

interface StationsPanelProps {
  dataset: AsteroidDataset | null
  model: ProductSupplyModel | null
  product: ProductEntry | null
  /** Label of every tracked element, by id. */
  labels: Record<string, string>
  plan: PlanState
  /** True when the plan on screen was computed for a different product or filter set. */
  stale: boolean
  /** Station highlighted on the map (-1 for none). */
  focusStation: number
  pinnedStation: number
  onHoverStation: (k: number) => void
  onPinStation: (k: number) => void
  selected: number
  onSelect: (index: number) => void
  onHover: (index: number) => void
}

export function StationsPanel({
  dataset,
  model,
  product,
  labels,
  plan,
  stale,
  focusStation,
  pinnedStation,
  onHoverStation,
  onPinStation,
  selected,
  onSelect,
  onHover,
}: StationsPanelProps) {
  const result = stale ? null : plan.result
  // The product's asteroid-sourced inputs in the filtered set, as the planner counted them.
  const elements = result?.inputs ?? []
  const missing = elements.filter((el) => el.carriers === 0)

  return (
    <section aria-labelledby="stations-label" className="glass flex min-h-0 flex-col rounded-md">
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
        <p id="stations-label" className="text-sm font-medium text-white">
          Where the stations go
        </p>
        <span className="text-xs text-white tabular-nums" aria-live="polite">
          {plan.status === 'clustering' ? (
            <Busy>Placing stations</Busy>
          ) : plan.status === 'sampling' ? (
            <Busy>Testing {plan.draws.toLocaleString()} compositions</Busy>
          ) : plan.status === 'error' ? (
            'Something went wrong'
          ) : null}
        </span>
      </div>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
        {!dataset || !model ? (
          <p className="text-sm text-white">Loading…</p>
        ) : !product ? (
          <p className="text-sm text-white">Pick a product on the left to place stations for it.</p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-sm text-white">{product.label}</p>
              {elements.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs text-white">What it needs from asteroids</p>
                  <ul className="flex flex-wrap gap-1">
                    {elements.map((el) => (
                      <li
                        key={el.id}
                        title={`Found in ${el.carriers.toLocaleString()} asteroids, about ${formatTonnes(el.tonnes)} in total`}
                        className={cn(
                          'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px]',
                          el.carriers === 0 ? 'bg-red-500/20 text-red-200' : 'bg-white/6 text-white',
                        )}
                      >
                        {el.label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <ImportedList model={model} product={product} />
            </div>

            {product.elements.length === 0 ? (
              <p className="text-sm leading-relaxed text-white">
                Everything this product needs still has to come from Earth, so there is nowhere useful to put a station
                yet.
              </p>
            ) : missing.length > 0 ? (
              <p className="text-sm leading-relaxed text-white">
                None of the asteroids you have selected contain {missing.map((m) => m.label.toLowerCase()).join(' or ')}.
                Loosen the filters to place stations.
              </p>
            ) : plan.status === 'error' && !result ? (
              <PlannerError offline={plan.offline} error={plan.error} onRetry={plan.retry} />
            ) : !result ? (
              <p className="text-sm text-white">Placing stations…</p>
            ) : (
              <>
                <ol className={cn('flex flex-col gap-2 transition-opacity', plan.status === 'clustering' && 'opacity-50')}>
                  {result.stations.map((s, k) => (
                    <StationCard
                      key={k}
                      k={k}
                      station={s}
                      result={result}
                      labels={labels}
                      dataset={dataset}
                      focus={focusStation === k ? 'on' : focusStation >= 0 ? 'off' : 'none'}
                      pinned={pinnedStation === k}
                      onHoverStation={onHoverStation}
                      onPinStation={onPinStation}
                      selected={selected}
                      onSelect={onSelect}
                      onHover={onHover}
                    />
                  ))}
                </ol>
                {plan.status === 'error' && <PlannerError offline={plan.offline} error={plan.error} onRetry={plan.retry} />}
              </>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function PlannerError({ offline, error, onRetry }: { offline: boolean; error: string | null; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-1.5 rounded-md bg-red-500/10 p-3 text-sm text-red-100">
      {offline ? (
        <>
          <p>The station planner isn't running.</p>
          <p className="text-xs text-red-100/75">Start it from the project folder:</p>
          <code className="rounded-sm bg-black/40 px-2 py-1 text-[11px] text-white">
            uvicorn asteroid_industry.api:app --port 8000
          </code>
        </>
      ) : (
        <p>The planner hit a problem: {error}</p>
      )}
      <button type="button" onClick={onRetry} className="btn glass btn-glass mt-1 h-7 px-3 text-xs">
        Retry
      </button>
    </div>
  )
}

function Busy({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-signal" />
      {children}
    </span>
  )
}

function ImportedList({ model, product }: { model: ProductSupplyModel; product: ProductEntry }) {
  if (product.imported.length === 0) return null
  return (
    <details className="group rounded-md bg-white/4 px-2 py-1.5">
      <summary className="cursor-pointer list-none text-[11px] text-white marker:hidden hover:text-white">
        <span aria-hidden="true" className="mr-1 inline-block transition-transform group-open:rotate-90">
          ›
        </span>
        {product.imported.length} thing{product.imported.length === 1 ? '' : 's'} still shipped from Earth
      </summary>
      <ul className="mt-1.5 flex flex-wrap gap-1">
        {product.imported.map((id) => {
          const ext = model.externals[id]
          return (
            <li key={id} title={ext?.why} className="rounded-sm bg-white/6 px-1.5 py-0.5 text-[10px] text-white">
              {ext?.label ?? id}
            </li>
          )
        })}
      </ul>
    </details>
  )
}

/** "2.85 (2.84 to 2.87)" when a Monte Carlo range exists. */
function withRange(value: string, r: Range | undefined, fmt: (v: number) => string) {
  return r ? `${value} (${fmt(r.lo)} to ${fmt(r.hi)})` : value
}

function StationCard({
  k,
  station: s,
  result,
  labels,
  dataset,
  focus,
  pinned,
  onHoverStation,
  onPinStation,
  selected,
  onSelect,
  onHover,
}: {
  k: number
  station: PlannedStation
  result: PlanResult
  labels: Record<string, string>
  dataset: AsteroidDataset
  focus: 'on' | 'off' | 'none'
  pinned: boolean
  onHoverStation: (k: number) => void
  onPinStation: (k: number) => void
  selected: number
  onSelect: (index: number) => void
  onHover: (index: number) => void
}) {
  const color = stationColor(k)
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (pinned) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [pinned])

  // Output: everything its asteroids contain, inputs first, then co-products.
  const required = new Set(result.required)
  const total = s.output.reduce((sum, v) => sum + v, 0)
  const rows = s.output
    .map((v, e) => ({ e, id: result.elements[e], v, input: required.has(result.elements[e]) }))
    .filter((row) => row.v > 0)
    .sort((p, q) => Number(q.input) - Number(p.input) || q.v - p.v)
  const shown = rows.slice(0, 8)
  const maxV = Math.max(...shown.map((row) => Math.max(row.v, s.ranges?.output[row.e].hi ?? 0)), 1e-12)
  const R = s.ranges

  return (
    <li
      ref={ref}
      onMouseEnter={() => onHoverStation(k)}
      onMouseLeave={() => onHoverStation(-1)}
      className={cn('flex flex-col gap-3 rounded-md bg-white/4 p-3 transition-[opacity,box-shadow]', focus === 'off' && 'opacity-60')}
      style={focus === 'on' ? { boxShadow: `inset 0 0 0 1.5px ${color}` } : undefined}
    >
      <div className="flex flex-col gap-1">
        <button
          type="button"
          aria-pressed={pinned}
          onClick={() => onPinStation(k)}
          onFocus={() => onHoverStation(k)}
          onBlur={() => onHoverStation(-1)}
          title={pinned ? 'Show all stations on the map' : 'Keep only this station in focus on the map'}
          className={cn(
            'flex w-fit items-center gap-2 rounded-md px-1.5 py-0.5 text-sm transition-colors',
            pinned ? 'bg-white text-[#0e0e0e]' : 'text-white hover:bg-white/10',
          )}
        >
          <span aria-hidden="true" className="size-2.5 rounded-full ring-1 ring-white/60" style={{ backgroundColor: color }} />
          S{k + 1}
        </button>
        <span className="px-1.5 text-xs text-white tabular-nums">
          {withRange(s.a.toFixed(2), R?.a, (v) => v.toFixed(2))} AU from the Sun
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-xs text-white">
          Serves {s.members.toLocaleString()} asteroids holding {withRange(pct(s.share), R?.share, pct)} of the material
        </p>
        <p className="text-xs text-white tabular-nums">Typical trip to one of them: {s.dvMedian.toFixed(1)} km/s</p>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-[11px] text-white">
          What its asteroids hold
        </p>
        <dl className="flex flex-col gap-1">
          {shown.map((row) => {
            const r = R?.output[row.e]
            return (
              <div
                key={row.id}
                className="grid grid-cols-[4.75rem_minmax(0,1fr)_3.25rem] items-center gap-2 text-[11px] tabular-nums"
                title={`${formatTonnes(row.v)}${r ? ` (${formatTonnes(r.lo)}–${formatTonnes(r.hi)})` : ''}`}
              >
                <dt className={cn('flex items-center gap-1 truncate', 'text-white')}>
                  {row.input && <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-white" />}
                  {labels[row.id] ?? row.id}
                </dt>
                <dd className="relative h-1.5 overflow-hidden rounded-full bg-white/8">
                  {r && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 rounded-full opacity-35"
                      style={{
                        left: `${(r.lo / maxV) * 100}%`,
                        width: `${(Math.max(r.hi - r.lo, 0) / maxV) * 100}%`,
                        backgroundColor: color,
                      }}
                    />
                  )}
                  <span
                    className={cn('absolute inset-y-0 left-0 rounded-full', !row.input && 'opacity-50')}
                    style={{ width: `${(row.v / maxV) * 100}%`, backgroundColor: color }}
                  />
                </dd>
                <dd className="text-right text-white">{pct(total > 0 ? row.v / total : 0)}</dd>
              </div>
            )
          })}
        </dl>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-[11px] text-white">Its biggest asteroids</p>
        <ul className="flex flex-col">
          {s.topMembers.slice(0, 5).map((m) => {
            const r = dataset.records[m.index]
            const active = m.index === selected
            return (
              <li key={m.index}>
                <button
                  type="button"
                  onClick={() => onSelect(m.index)}
                  onMouseEnter={() => onHover(m.index)}
                  onMouseLeave={() => onHover(-1)}
                  onFocus={() => onHover(m.index)}
                  onBlur={() => onHover(-1)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-baseline justify-between gap-2 rounded-sm px-1.5 py-1 text-left text-[11px] transition-colors',
                    active ? 'bg-white/12 text-signal' : 'text-white hover:bg-white/8',
                  )}
                >
                  <span className="min-w-0 truncate">
                    {asteroidLabel(dataset, m.index)}
                  </span>
                  <span className="shrink-0 text-white tabular-nums">{formatTonnes(m.tonnes)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </li>
  )
}
