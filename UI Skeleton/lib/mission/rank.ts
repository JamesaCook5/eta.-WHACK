import type { AsteroidDataset } from '@/lib/asteroids/types'
import { CATEGORY_IDS } from '@/lib/asteroids/class-colors'
import { explainScore, relativeSolarFlux, scoreAsteroid, type ScoreDriver, type StationParams } from './scoring'

export interface RankedCandidate {
  index: number
  score: number
  drivers: ScoreDriver[]
}

/** Scores every asteroid that passed the filters and keeps the top N. */
export function rankCandidates(
  dataset: AsteroidDataset,
  mask: Uint8Array,
  station: StationParams,
): RankedCandidate[] {
  const d = dataset.domains.diameter
  const ctx = {
    station,
    diameterLog: [Math.log10(Math.max(d.min, 1e-3)), Math.log10(Math.max(d.max, 1e-3))] as [number, number],
    maxFlux: relativeSolarFlux(Math.max(dataset.domains.a.min, 0.1)),
  }
  const n = Math.max(1, Math.floor(station.topN))
  const top: { index: number; score: number }[] = []

  for (let k = 0; k < dataset.count; k++) {
    if (mask[k] === 0) continue
    const r = dataset.records[k]
    const score = scoreAsteroid({ a: r.a, diameterKm: r.diameter_km, category: CATEGORY_IDS[dataset.category[k]] }, ctx)
    if (score === null) continue
    if (top.length === n && score <= top[n - 1].score) continue

    let pos = top.length
    while (pos > 0 && top[pos - 1].score < score) pos--
    top.splice(pos, 0, { index: k, score })
    if (top.length > n) top.pop()
  }

  return top.map(({ index, score }) => ({
    index,
    score,
    drivers: explainScore(dataset.records[index], dataset.region[index], CATEGORY_IDS[dataset.category[index]]),
  }))
}
