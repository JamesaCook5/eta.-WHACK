'use client'

import { useMemo } from 'react'
import type { AsteroidDataset } from '@/lib/asteroids/types'
import { estimateFeedstock, type MaterialSupplyModel } from '@/lib/mission/material-supply'

const orbitBands = [
  { label: 'Inner < 2 au', test: (a: number) => a < 2 },
  { label: 'Main belt 2–3.3 au', test: (a: number) => a >= 2 && a < 3.3 },
  { label: 'Outer ≥ 3.3 au', test: (a: number) => a >= 3.3 },
]
const fmtTonnes = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)} Gt` : n >= 1e6 ? `${(n / 1e6).toFixed(2)} Mt` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} kt` : `${n.toFixed(1)} t`

export function SupplyPanel({
  dataset,
  model,
  mineralId,
  onMineralChange,
  mask,
}: {
  dataset: AsteroidDataset | null
  model: MaterialSupplyModel | null
  mineralId: string
  onMineralChange: (id: string) => void
  mask: Uint8Array | null
}) {
  const summary = useMemo(
    () => dataset && model ? estimateFeedstock(dataset, model, mineralId, mask) : [],
    [dataset, model, mineralId, mask],
  )
  const mineral = model?.minerals[mineralId]
  const total = summary.reduce((sum, row) => sum + row.tonnes, 0)
  const bands = orbitBands.map((band) => ({ ...band, tonnes: summary.filter((row) => band.test(row.orbitAu)).reduce((sum, row) => sum + row.tonnes, 0) }))
  const maxBand = Math.max(...bands.map((band) => band.tonnes), 1)
  const classTotals = Object.entries(summary.reduce<Record<string, number>>((acc, row) => {
    acc[row.classCode] = (acc[row.classCode] ?? 0) + row.tonnes
    return acc
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 4)
  const routes = mineral?.routes ?? []
  const outputs = [...new Set(routes.flatMap((route) => route.outputs))]
  const external = mineral?.downstream_external_inputs ?? [...new Set(routes.flatMap((route) => route.external_inputs))]

  return (
    <section aria-labelledby="supply-title" className="glass rounded-md p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Supply layer</p>
          <h3 id="supply-title" className="mt-1 font-display text-lg">Material distribution</h3>
        </div>
        <span className="rounded-sm border border-signal/30 px-2 py-1 font-mono text-[10px] text-signal">MODEL PROXY</span>
      </div>

      <label htmlFor="supply-mineral" className="mt-4 block text-xs text-muted-foreground">Asteroid feedstock</label>
      <select id="supply-mineral" value={mineralId} onChange={(event) => onMineralChange(event.target.value)} disabled={!model}
        className="mt-1 h-9 w-full rounded-md border border-white/10 bg-black/30 px-2 text-sm text-white">
        {Object.entries(model?.minerals ?? {}).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
      </select>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-md bg-black/25 p-3">
          <p className="text-[10px] tracking-wider text-muted-foreground uppercase">Estimated feedstock</p>
          <p className="mt-1 font-mono text-lg tabular-nums">{fmtTonnes(total)}</p>
        </div>
        <div className="rounded-md bg-black/25 p-3">
          <p className="text-[10px] tracking-wider text-muted-foreground uppercase">Mapped asteroids</p>
          <p className="mt-1 font-mono text-lg tabular-nums">{summary.length.toLocaleString()}</p>
        </div>
      </div>

      <div className="mt-5">
        <p className="text-[10px] tracking-wider text-muted-foreground uppercase">By orbital distance</p>
        <div className="mt-2 flex flex-col gap-2">
          {bands.map((band) => <div key={band.label}>
            <div className="mb-1 flex justify-between font-mono text-[10px] text-white/75"><span>{band.label}</span><span>{fmtTonnes(band.tonnes)}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-signal" style={{ width: `${Math.max(1, band.tonnes / maxBand * 100)}%` }} /></div>
          </div>)}
        </div>
        {classTotals.length > 0 && <p className="mt-3 text-[10px] text-muted-foreground">Largest class proxies: {classTotals.map(([code, tonnes]) => `${code} ${fmtTonnes(tonnes)}`).join(' · ')}</p>}
      </div>

      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="text-[10px] tracking-wider text-muted-foreground uppercase">DAG candidate outputs</p>
        <p className="mt-2 text-xs leading-relaxed text-white/80">{outputs.length ? outputs.map((id) => model?.material_labels[id] ?? id.replaceAll('_', ' ')).join(' · ') : 'No direct route recorded.'}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">Outputs from the direct feed routes. Downstream routes remain candidates; recovery amounts and product qualification are not assigned.</p>
      </div>

      <div className="mt-4 border-t border-white/10 pt-4">
        <p className="text-[10px] tracking-wider text-muted-foreground uppercase">Earth supplied process inputs</p>
        {external.length ? <ul className="mt-2 space-y-1.5 text-xs text-white/80">{external.map((id) => {
          const item = model?.external_materials[id]
          return <li key={id} className="flex justify-between gap-2"><span>{item?.label ?? id}</span><span className="shrink-0 font-mono text-[10px] text-muted-foreground">{item?.makeup_kg_per_tonne_feed == null ? 'quantity unset' : `${item.makeup_kg_per_tonne_feed} kg/t`}</span></li>
        })}</ul> : <p className="mt-2 text-xs text-muted-foreground">No explicit imported reagent on the listed direct routes.</p>}
      </div>
      <p className="mt-4 text-[10px] leading-relaxed text-muted-foreground">Inputs are gathered from the DAG’s downstream candidate processes for this feed. Mass uses diameter, class bulk density and taxonomy mineral fractions. It is a raw feedstock estimate, not recoverable product; classes without a known composition proxy are omitted.</p>
    </section>
  )
}
