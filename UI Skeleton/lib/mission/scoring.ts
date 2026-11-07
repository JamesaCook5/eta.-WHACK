/**
 * PLACEHOLDER MODULE — station scoring.
 *
 * Stations are judged on where they are placed and what it would cost to
 * manufacture there once they are in place. Launch and transfer costs are out
 * of scope. Replace this file with the real manufacturing cost model; the
 * ranking code only depends on `scoreAsteroid` and `explainScore` keeping
 * these signatures.
 *
 * Current behaviour (no cost or yield figures are used):
 * - An asteroid is a candidate when its composition category suits the product
 *   (see resources.ts) and it passed the map filters (including region).
 * - The score mixes two proxies for manufacturing cost, each scaled to [0, 1]:
 *   - Feedstock: log10 of the diameter, as a stand-in for how much material
 *     the body offers.
 *   - Solar power: sunlight available at the orbit, which falls off as 1/a²
 *     (a in au, so 1.0 = sunlight at Earth's distance).
 *   `feedstockWeight` sets the balance; solar power gets the remainder.
 */

import type { AsteroidRecord } from '@/lib/asteroids/types'
import { REGIONS } from '@/lib/asteroids/regions'
import { candidateCategories, categoryLabel, type CategoryId } from '@/lib/asteroids/class-colors'
import { categoryMatchesResource, type ResourceId } from './resources'

export interface StationParams {
  /** What the station manufactures. */
  product: ResourceId
  /** 0 = rank only on solar power, 1 = rank only on feedstock size. */
  feedstockWeight: number
  topN: number
}

export interface ScoreContext {
  station: StationParams
  /** log10(km) range used to scale feedstock. */
  diameterLog: [number, number]
  /** Highest relative solar flux (1/a²) in the dataset, used to scale power. */
  maxFlux: number
}

export interface AsteroidScoreInput {
  a: number
  diameterKm: number | null
  category: CategoryId
}

export interface ScoreDriver {
  label: string
  value: string
}

/** Sunlight at the orbit relative to 1 au. */
export const relativeSolarFlux = (a: number) => 1 / (a * a)

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Returns a score in [0, 1], or null when the asteroid is not a candidate. */
export function scoreAsteroid(input: AsteroidScoreInput, ctx: ScoreContext): number | null {
  if (!categoryMatchesResource(input.category, ctx.station.product)) return null
  const [lo, hi] = ctx.diameterLog
  const feedstock =
    input.diameterKm !== null && input.diameterKm > 0
      ? clamp01((Math.log10(input.diameterKm) - lo) / Math.max(hi - lo, 1e-6))
      : 0
  const power = clamp01(relativeSolarFlux(input.a) / ctx.maxFlux)
  const w = clamp01(ctx.station.feedstockWeight)
  return w * feedstock + (1 - w) * power
}

/** The stats shown next to a candidate in the results panel. */
export function explainScore(record: AsteroidRecord, regionIndex: number, category: CategoryId): ScoreDriver[] {
  // Mixed classes (e.g. X) show which category this asteroid was placed in.
  const mixed = candidateCategories(record.taxonomy_class).length > 1
  const cls = record.taxonomy_class ?? '—'
  return [
    { label: 'Class', value: mixed ? `${cls} (${categoryLabel(category)})` : cls },
    { label: 'D', value: record.diameter_km !== null ? `${record.diameter_km.toFixed(1)} km` : '—' },
    { label: 'Sun', value: `${relativeSolarFlux(record.a).toFixed(2)}×` },
    { label: 'a', value: `${record.a.toFixed(3)} au` },
    { label: 'i', value: `${record.i.toFixed(1)}°` },
    { label: 'Region', value: REGIONS[regionIndex] ?? '—' },
  ]
}
