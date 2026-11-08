'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { AsteroidDataset } from '@/lib/asteroids/types'
import { asteroidLabel } from '@/lib/asteroids/label'
import type { ElementSummary, ProductEntry, ProductSupplyModel } from '@/lib/stations/product-supply'
import type { PlannedStation, PlanResult, Range } from '@/lib/stations/optimise'
import type { PlanState } from '@/lib/stations/use-station-plan'
import { stationColor } from '@/lib/stations/colors'
import { ASSUMED_ACCELERATION_M_S2 } from '@/lib/stations/settings'

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
const deg = (v: number) => `${(((v % 360) + 360) % 360).toFixed(0)}°`
/** Hours of thrust to deliver Δv (km/s) at the planner's assumed acceleration. */
const thrustHours = (dvKmS: number) => (dvKmS * 1000) / ASSUMED_ACCELERATION_M_S2 / 3600

interface StationsPanelProps {
  dataset: AsteroidDataset | null
  model: ProductSupplyModel | null
  product: ProductEntry | null
  /** The product's asteroid-sourced inputs in the filtered set. */
  elements: ElementSummary[]
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
  elements,
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
  const busy = plan.status === 'clustering' || plan.status === 'sampling'
  const missing = elements.filter((el) => el.carriers === 0)
  const scarcest = elements.length ? elements.reduce((lo, el) => (el.tonnes < lo.tonnes ? el : lo), elements[0]) : null

  return (
    <section aria-labelledby="stations-label" className="glass flex min-h-0 flex-col rounded-md">
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
        <p id="stations-label" className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Station plan
        </p>
        <span className="font-mono text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {plan.status === 'clustering' ? (
            <Busy>Clustering…</Busy>
          ) : plan.status === 'sampling' ? (
            <Busy>
              Monte Carlo {plan.progress?.done ?? 0}/{plan.progress?.total ?? 0}
            </Busy>
          ) : plan.status === 'error' ? (
            'Failed'
          ) : result ? (
            `${(result.ms / 1000).toFixed(1)} s`
          ) : null}
        </span>
      </div>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
        {!dataset || !model ? (
          <p className="text-sm text-muted-foreground">Loading asteroid and product data…</p>
        ) : !product ? (
          <p className="text-sm text-muted-foreground">Pick a product to plan stations for it.</p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-sm text-white">{product.label}</p>
              {elements.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[11px] text-muted-foreground">Asteroid-sourced inputs (from the DAG)</p>
                  <ul className="flex flex-wrap gap-1">
                    {elements.map((el) => (
                      <li
                        key={el.id}
                        title={`${el.carriers.toLocaleString()} bodies in the filtered set · ${formatTonnes(el.tonnes)}`}
                        className={cn(
                          'inline-flex h-6 items-center gap-1 rounded-md px-1.5 font-mono text-[11px]',
                          el.carriers === 0
                            ? 'bg-red-500/20 text-red-200'
                            : el === scarcest
                              ? 'bg-signal/20 text-signal'
                              : 'bg-white/6 text-white/80',
                        )}
                      >
                        {el.label}
                        {el === scarcest && el.carriers > 0 && <span className="text-[10px] opacity-80">· scarcest</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <ImportedList model={model} product={product} />
            </div>

            {elements.length === 0 ? (
              <p className="text-sm leading-relaxed text-white/75">
                Every input to this product is imported from Earth in the DAG, so there is nothing to place near
                asteroids.
              </p>
            ) : missing.length > 0 ? (
              <p className="text-sm leading-relaxed text-white/75">
                No asteroid in the filtered set carries {missing.map((m) => m.label.toLowerCase()).join(', ')}. Widen the
                filters to plan stations.
              </p>
            ) : plan.status === 'error' ? (
              <p className="text-sm text-red-200">The planner failed: {plan.error}</p>
            ) : !result ? (
              <p className="text-sm text-muted-foreground">Clustering asteroids…</p>
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
                <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                  Weighted k-means over every filtered asteroid (weight = tonnes of the inputs; best of {result.restarts}{' '}
                  k-means++ starts) · trip time {result.tripYears} yr ·{' '}
                  {result.draws > 0
                    ? `Monte Carlo over class compositions, ${result.draws} draws; ranges are 5th–95th percentile`
                    : busy
                      ? 'Monte Carlo running…'
                      : 'no Monte Carlo'}
                </p>
              </>
            )}
          </>
        )}
      </div>
    </section>
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
      <summary className="cursor-pointer list-none text-[11px] text-muted-foreground marker:hidden hover:text-white">
        <span aria-hidden="true" className="mr-1 inline-block transition-transform group-open:rotate-90">
          ›
        </span>
        {product.imported.length} input{product.imported.length === 1 ? '' : 's'} imported from Earth
      </summary>
      <ul className="mt-1.5 flex flex-wrap gap-1">
        {product.imported.map((id) => {
          const ext = model.externals[id]
          return (
            <li key={id} title={ext?.why} className="rounded-sm bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-white/70">
              {ext?.label ?? id}
            </li>
          )
        })}
      </ul>
    </details>
  )
}

/** "2.85 (2.84–2.87)" when a Monte Carlo range exists. */
function withRange(value: string, r: Range | undefined, fmt: (v: number) => string) {
  return r ? `${value} (${fmt(r.lo)}–${fmt(r.hi)})` : value
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
          <span className={cn('text-[10px]', pinned ? 'text-[#0e0e0e]/60' : 'text-white/45')}>{pinned ? 'focused' : 'focus'}</span>
        </button>
        <span className="px-1.5 font-mono text-[11px] text-white/75 tabular-nums">
          a {withRange(s.a.toFixed(2), R?.a, (v) => v.toFixed(2))} au · e {s.e.toFixed(2)} · i {s.i.toFixed(1)}°
        </span>
        <span className="px-1.5 font-mono text-[11px] text-white/55 tabular-nums">
          {s.bunching < 0.3
            ? 'Its asteroids spread all round the orbit'
            : `Longitude ${withRange(deg(s.longitude), R?.longitude, deg)}`}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-xs text-white/85">
          {s.members.toLocaleString()} asteroids · {withRange(pct(s.share), R?.share, pct)} of the input tonnage
        </p>
        <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
          Median Δv to its asteroids {s.dvMedian.toFixed(2)} km/s (≈ {Math.round(thrustHours(s.dvMedian))} h of thrust at{' '}
          {ASSUMED_ACCELERATION_M_S2} m/s²)
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-[11px] text-muted-foreground">
          Output, in the ratio its asteroids hold it{R ? ' (faint band: range over draws)' : ''}
        </p>
        <dl className="flex flex-col gap-1">
          {shown.map((row) => {
            const r = R?.output[row.e]
            return (
              <div
                key={row.id}
                className="grid grid-cols-[4.75rem_minmax(0,1fr)_3.25rem] items-center gap-2 font-mono text-[11px] tabular-nums"
                title={`${formatTonnes(row.v)}${r ? ` (${formatTonnes(r.lo)}–${formatTonnes(r.hi)})` : ''}`}
              >
                <dt className={cn('flex items-center gap-1 truncate', row.input ? 'text-white' : 'text-white/55')}>
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
                <dd className="text-right text-white/70">{pct(total > 0 ? row.v / total : 0)}</dd>
              </div>
            )
          })}
        </dl>
        <p className="font-mono text-[10px] text-white/40">● product input · others are co-products · total {formatTonnes(total)}</p>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-[11px] text-muted-foreground">Largest asteroids it serves</p>
        <p className="px-1.5 font-mono text-[10px] text-white/40">body · position vs station · Δv · input tonnes</p>
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
                    'flex w-full items-baseline justify-between gap-2 rounded-sm px-1.5 py-1 text-left font-mono text-[11px] transition-colors',
                    active ? 'bg-white/12 text-signal' : 'text-white/80 hover:bg-white/8',
                  )}
                >
                  <span className="min-w-0 truncate">
                    {asteroidLabel(dataset, m.index)} <span className="text-white/45">{r.taxonomy_class}</span>
                  </span>
                  <span className="shrink-0 text-white/60 tabular-nums">
                    {m.offsetDeg >= 0 ? '+' : '−'}
                    {Math.abs(m.offsetDeg).toFixed(0)}° · {m.dv.toFixed(1)} km/s · {formatTonnes(m.tonnes)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </li>
  )
}
