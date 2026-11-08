'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { AsteroidDataset } from '@/lib/asteroids/types'
import { asteroidLabel } from '@/lib/asteroids/label'
import type { ElementSummary, ProductEntry, ProductSupplyModel } from '@/lib/stations/product-supply'
import type { PlanState } from '@/lib/stations/use-station-plan'
import { stationColor } from '@/lib/stations/colors'

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const sup = (n: number) =>
  String(n)
    .split('')
    .map((c) => (c === '-' ? '⁻' : SUPERSCRIPT[Number(c)]))
    .join('')

/** Tonnes as "4.2 Mt", "310 Gt" or "3.8 × 10¹³ t". */
export function formatTonnes(t: number) {
  if (!(t > 0)) return '0 t'
  if (t < 1e3) return `${t.toPrecision(2)} t`
  if (t < 1e6) return `${(t / 1e3).toPrecision(2)} kt`
  if (t < 1e9) return `${(t / 1e6).toPrecision(2)} Mt`
  if (t < 1e12) return `${(t / 1e9).toPrecision(2)} Gt`
  const exp = Math.floor(Math.log10(t))
  return `${(t / 10 ** exp).toFixed(1)} × 10${sup(exp)} t`
}

const pct = (v: number) => (v >= 0.1 ? `${(v * 100).toFixed(1)}%` : v >= 0.001 ? `${(v * 100).toFixed(2)}%` : '<0.1%')

interface StationsPanelProps {
  dataset: AsteroidDataset | null
  model: ProductSupplyModel | null
  product: ProductEntry | null
  elements: ElementSummary[]
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
  const running = plan.status === 'running'
  const missing = elements.filter((el) => el.carriers === 0)
  const scarcest = elements.length
    ? elements.reduce((lo, el) => (el.tonnes < lo.tonnes ? el : lo), elements[0])
    : null

  return (
    <section aria-labelledby="stations-label" className="glass flex min-h-0 flex-col rounded-md">
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
        <p id="stations-label" className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Station plan
        </p>
        <span className="font-mono text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {running ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-signal" />
              Optimising…
            </span>
          ) : plan.status === 'error' ? (
            'Failed'
          ) : result ? (
            `${Math.round(result.ms)} ms`
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
              <p className="text-sm text-red-200">The optimiser failed: {plan.error}</p>
            ) : !result ? (
              <p className="text-sm text-muted-foreground">Placing stations…</p>
            ) : (
              <>
                <ol className={cn('flex flex-col gap-2 transition-opacity', running && 'opacity-50')}>
                  {result.stations.map((s, k) => (
                    <StationCard
                      key={k}
                      k={k}
                      station={s}
                      elements={elements}
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
                  Reach {result.reachKmS.toFixed(2)} km/s · trip {result.tripYears} yr · relative time-weighted production score{' '}
                  {pct(result.objective)} (greedy start {pct(result.seedObjective)},{' '}
                  {result.objective > result.seedObjective
                    ? `+${(((result.objective - result.seedObjective) / Math.max(result.seedObjective, 1e-12)) * 100).toFixed(0)}%`
                    : 'unchanged'}
                  ) · {result.iterations} steps · {result.relocations} relocation{result.relocations === 1 ? '' : 's'} ·{' '}
                  {result.bodies.toLocaleString()} bodies · normalized supply proxy, not extraction capacity
                </p>
              </>
            )}
          </>
        )}
      </div>
    </section>
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

function StationCard({
  k,
  station: s,
  elements,
  dataset,
  focus,
  pinned,
  onHoverStation,
  onPinStation,
  selected,
  onSelect,
  onHover,
}: {
  focus: 'on' | 'off' | 'none'
  pinned: boolean
  onHoverStation: (k: number) => void
  onPinStation: (k: number) => void
  k: number
  station: NonNullable<PlanState['result']>['stations'][number]
  elements: ElementSummary[]
  dataset: AsteroidDataset
  selected: number
  onSelect: (index: number) => void
  onHover: (index: number) => void
}) {
  const color = stationColor(k)
  // The inputs closest to limiting this station, scarcest first.
  const order = s.shares.map((v, e) => ({ e, v })).sort((p, q) => p.v - q.v)
  const shown = order.slice(0, Math.min(4, order.length))
  const maxShare = Math.max(...shown.map((x) => x.v), 1e-12)
  const limiting = elements[s.bottleneck]
  // Bring the card into view when its station is clicked on the map.
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (pinned) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [pinned])

  return (
    <li
      ref={ref}
      onMouseEnter={() => onHoverStation(k)}
      onMouseLeave={() => onHoverStation(-1)}
      className={cn(
        'flex flex-col gap-3 rounded-md bg-white/4 p-3 ring-1 ring-transparent transition-[opacity,box-shadow]',
        focus === 'off' && 'opacity-60',
      )}
      style={focus === 'on' ? { boxShadow: `inset 0 0 0 1.5px ${color}` } : undefined}
    >
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          aria-pressed={pinned}
          onClick={() => onPinStation(k)}
          onFocus={() => onHoverStation(k)}
          onBlur={() => onHoverStation(-1)}
          title={pinned ? 'Show all stations on the map' : 'Show only this station on the map'}
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
          Orbit a {s.a.toFixed(3)} au · e {s.e.toFixed(3)} · i {s.i.toFixed(1)}°
        </span>
        <span className="px-1.5 font-mono text-[11px] text-white/55 tabular-nums">
          Longitude {((s.longitude + 360) % 360).toFixed(0)}° · reach zone ±{s.zone.halfAngleDeg.toFixed(0)}° along the orbit
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-xs text-white/85">
          Limited by <span className="text-white">{limiting?.label ?? '—'}</span>: {pct(s.shares[s.bottleneck])} of the filtered
          supply in reach
        </p>
        <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {formatTonnes(s.tonnes[s.bottleneck])} of {limiting?.label ?? 'it'} in reach · {pct(s.overlap)} shared with other stations
        </p>
      </div>

      {shown.length > 1 && (
        <dl className="flex flex-col gap-1">
          {shown.map(({ e, v }) => (
            <div key={e} className="grid grid-cols-[4.5rem_minmax(0,1fr)_3rem] items-center gap-2 font-mono text-[11px] tabular-nums">
              <dt className="truncate text-white/70">{elements[e]?.label}</dt>
              <dd className="h-1.5 overflow-hidden rounded-full bg-white/8">
                <span className="block h-full rounded-full" style={{ width: `${(v / maxShare) * 100}%`, backgroundColor: color }} />
              </dd>
              <dd className="text-right text-white/70">{pct(v)}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex flex-col gap-1">
        <p className="text-[11px] text-muted-foreground">
          Main suppliers · half the intake from {s.bodies.toLocaleString()} bod{s.bodies === 1 ? 'y' : 'ies'}
        </p>
        <p className="px-1.5 font-mono text-[10px] text-white/40">body · position vs station · Δv to reach · share</p>
        <ul className="flex flex-col">
          {s.suppliers.slice(0, 5).map((sp) => {
            const r = dataset.records[sp.index]
            const active = sp.index === selected
            return (
              <li key={sp.index}>
                <button
                  type="button"
                  onClick={() => onSelect(sp.index)}
                  onMouseEnter={() => onHover(sp.index)}
                  onMouseLeave={() => onHover(-1)}
                  onFocus={() => onHover(sp.index)}
                  onBlur={() => onHover(-1)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-baseline justify-between gap-2 rounded-sm px-1.5 py-1 text-left font-mono text-[11px] transition-colors',
                    active ? 'bg-white/12 text-signal' : 'text-white/80 hover:bg-white/8',
                  )}
                >
                  <span className="min-w-0 truncate">
                    {asteroidLabel(dataset, sp.index)} <span className="text-white/45">{r.taxonomy_class}</span>
                  </span>
                  <span className="shrink-0 text-white/60 tabular-nums">
                    {sp.offsetDeg >= 0 ? '+' : '−'}
                    {Math.abs(sp.offsetDeg).toFixed(0)}° · {sp.dv.toFixed(2)} km/s · {pct(sp.share)}
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
