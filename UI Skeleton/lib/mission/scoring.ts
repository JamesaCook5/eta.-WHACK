/**
 * PLACEHOLDER MODULE — scoring function.
 *
 * Replace this file with the real scoring and routing model. The ranking code
 * only depends on `scoreAsteroid` and `explainScore` keeping these signatures.
 *
 * Current behaviour:
 * - Transfer cost is a heliocentric Hohmann estimate between circular orbits
 *   at the start body's semi-major axis and the asteroid's, with the plane
 *   change combined into the arrival burn. Eccentricity, phasing, launch
 *   windows and escape/capture are ignored.
 * - An asteroid is feasible when its class matches the target resource and the
 *   estimate fits the Δv budget and mission duration.
 * - Score is the fraction of the Δv budget left over. No resource-yield or
 *   cost figures are used.
 */

import type { AsteroidRecord } from '@/lib/asteroids/types'
import { taxonomyMatchesResource, type ResourceId } from './resources'
import type { StartBodyId } from './bodies'

export interface MissionParams {
  startBody: StartBodyId
  /** Semi-major axis of a custom starting orbit, au. */
  customA: number
  deltaVBudget: number
  durationDays: number
  resource: ResourceId
  topN: number
}

export interface ScoreContext {
  startA: number
  mission: MissionParams
}

export interface AsteroidScoreInput {
  a: number
  inclinationDeg: number
  taxonomyClass: string | null
}

export interface ScoreDriver {
  label: string
  value: string
}

const MU_SUN_KM3_S2 = 1.32712440018e11
const AU_KM = 1.495978707e8
const SECONDS_PER_DAY = 86400

export function estimateTransfer(startA: number, targetA: number, inclinationDeg: number) {
  const r1 = startA * AU_KM
  const r2 = targetA * AU_KM
  const transferA = (r1 + r2) / 2
  const v1 = Math.sqrt(MU_SUN_KM3_S2 / r1)
  const v2 = Math.sqrt(MU_SUN_KM3_S2 / r2)
  const vt1 = Math.sqrt(MU_SUN_KM3_S2 * (2 / r1 - 1 / transferA))
  const vt2 = Math.sqrt(MU_SUN_KM3_S2 * (2 / r2 - 1 / transferA))
  const inc = (inclinationDeg * Math.PI) / 180
  const departure = Math.abs(vt1 - v1)
  const arrival = Math.sqrt(vt2 * vt2 + v2 * v2 - 2 * vt2 * v2 * Math.cos(inc))
  const timeOfFlightDays =
    (Math.PI * Math.sqrt((transferA * transferA * transferA) / MU_SUN_KM3_S2)) / SECONDS_PER_DAY
  return { deltaV: departure + arrival, timeOfFlightDays }
}

/** Returns a score in [0, 1], or null when the asteroid is not a candidate. */
export function scoreAsteroid(input: AsteroidScoreInput, ctx: ScoreContext): number | null {
  if (!taxonomyMatchesResource(input.taxonomyClass, ctx.mission.resource)) return null
  const { deltaV, timeOfFlightDays } = estimateTransfer(ctx.startA, input.a, input.inclinationDeg)
  if (deltaV > ctx.mission.deltaVBudget) return null
  if (timeOfFlightDays > ctx.mission.durationDays) return null
  return 1 - deltaV / ctx.mission.deltaVBudget
}

/** The stats shown next to a candidate in the results panel. */
export function explainScore(record: AsteroidRecord, ctx: ScoreContext): ScoreDriver[] {
  const { deltaV, timeOfFlightDays } = estimateTransfer(ctx.startA, record.a, record.i)
  return [
    { label: 'Δv', value: `${deltaV.toFixed(2)} km/s` },
    { label: 'Transfer', value: `${Math.round(timeOfFlightDays)} d` },
    { label: 'Class', value: record.taxonomy_class ?? '—' },
    { label: 'a', value: `${record.a.toFixed(3)} au` },
    { label: 'i', value: `${record.i.toFixed(1)}°` },
    {
      label: 'D',
      value: record.diameter_km !== null ? `${record.diameter_km.toFixed(1)} km` : '—',
    },
  ]
}
