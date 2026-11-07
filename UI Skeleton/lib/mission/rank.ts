import type { AsteroidDataset } from '@/lib/asteroids/types'
import { startBodySemiMajorAxis } from './bodies'
import { explainScore, scoreAsteroid, type MissionParams, type ScoreDriver } from './scoring'

export interface RankedCandidate {
  index: number
  score: number
  drivers: ScoreDriver[]
}

/** Scores every asteroid that passed the filters and keeps the top N. */
export function rankCandidates(
  dataset: AsteroidDataset,
  mask: Uint8Array,
  mission: MissionParams,
): RankedCandidate[] {
  const ctx = { startA: startBodySemiMajorAxis(mission.startBody, mission.customA), mission }
  const n = Math.max(1, Math.floor(mission.topN))
  const top: { index: number; score: number }[] = []

  for (let k = 0; k < dataset.count; k++) {
    if (mask[k] === 0) continue
    const score = scoreAsteroid(
      {
        a: dataset.a[k],
        inclinationDeg: dataset.inclination[k],
        taxonomyClass: dataset.records[k].taxonomy_class,
      },
      ctx,
    )
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
    drivers: explainScore(dataset.records[index], ctx),
  }))
}
