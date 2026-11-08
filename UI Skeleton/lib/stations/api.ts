/**
 * Client for the Python station planner (asteroid_industry/api.py).
 *
 * The planner — weighted k-means plus the Monte Carlo over class compositions —
 * runs in Python. Next.js proxies /api/planner/* to it (next.config.mjs,
 * PLANNER_URL); this module only sends the request and decodes the reply.
 */

export const PLANNER_URL = '/api/planner'

export interface PlanRequest {
  product: string
  stations: number
  trip_years: number
  include_outer: boolean
  draws: number
  /** Filter mask over the asteroid table as base64 packed bits (MSB first); null for all. */
  mask: string | null
}

/** 5th percentile, median, 95th percentile. */
export interface Range {
  lo: number
  mid: number
  hi: number
}

export interface Member {
  /** Dataset index. */
  index: number
  /** Tonnes of the product's inputs in this body. */
  tonnes: number
  /** Δv from the station, km/s (orbit change and phasing). */
  dv: number
  /** Ahead (+) or behind (−) the station along the orbit, degrees. */
  offsetDeg: number
}

export interface PlannedStation {
  a: number
  e: number
  /** Degrees. */
  i: number
  /** Heliocentric ecliptic longitude at the dataset epoch, degrees. */
  longitude: number
  /** Asteroids assigned to this station. */
  members: number
  /** Share of the product's input tonnage that this station's asteroids hold. */
  share: number
  /** Tonnes of every tracked element in its asteroids (index matches result.elements). */
  output: number[]
  /** Tonnage-weighted median Δv from the station to its asteroids, km/s. */
  dvMedian: number
  /** How bunched its asteroids are along the orbit, 0–1 (near 0 = spread all round). */
  bunching: number
  topMembers: Member[]
  /** Monte Carlo ranges (absent when the request had no draws). */
  ranges?: { a: Range; longitude: Range; share: Range; output: Range[] }
}

/** One of the product's asteroid-sourced inputs in the planned set. */
export interface InputSummary {
  id: string
  label: string
  /** Bodies with a non-zero grade. */
  carriers: number
  /** Tonnes held (bodies counted up to the mining cap). */
  tonnes: number
}

export interface PlanResult {
  product: string
  elements: string[]
  required: string[]
  inputs: InputSummary[]
  stations: PlannedStation[]
  /** Station of every asteroid in the dataset (dataset order); 255 = not planned. */
  assignment: Uint8Array | null
  /** 1 where the asteroid holds at least one of the product's inputs. */
  carries: Uint8Array
  /** Fraction of draws (0–1, stored /255) in which each asteroid stayed with its station. */
  stability: Uint8Array | null
  /** Per station, its position in each draw as x, y pairs (heliocentric au). */
  cloud: Float32Array[] | null
  /** Asteroids in the planned set. */
  planned: number
  draws: number
  restarts: number
  iterations: number
  cells: number
  tripYears: number
  /** Server compute time. */
  ms: number
}

export interface HierarchyStation {
  process: string | null; material: string;
  a: number; e: number; i: number; longitude: number; members: number; share: number;
  output: Record<string, number>; inputs?: Record<string, number>;
}
export interface HierarchyResult { product: string; productLabel: string; stations: HierarchyStation[]; asteroidAssignment: Uint8Array; ms: number; tripYears: number }

export async function requestHierarchy(req: Omit<PlanRequest, 'draws'>, signal: AbortSignal): Promise<HierarchyResult> {
  const res = await fetch(`${PLANNER_URL}/plan/hierarchy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal })
  if (!res.ok) throw new Error(`Hierarchy planner failed (${res.status}): ${await res.text()}`)
  const raw = await res.json()
  return { ...raw, asteroidAssignment: fromBase64(raw.asteroidAssignment) }
}

const fromBase64 = (text: string) => {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Pack a 0/1 mask into base64 bits, most significant bit first (numpy's packbits order). */
export function packMask(mask: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(mask.length / 8))
  for (let j = 0; j < mask.length; j++) if (mask[j]) bytes[j >> 3] |= 0x80 >> (j & 7)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

type RawResult = Omit<PlanResult, 'assignment' | 'carries' | 'stability' | 'cloud' | 'planned'> & {
  assignment: string | null
  carries: string
  stability: string | null
  cloud: number[][] | null
}

export class PlannerUnavailableError extends Error {}

export async function requestPlan(req: PlanRequest, signal: AbortSignal): Promise<PlanResult> {
  let res: Response
  try {
    res = await fetch(`${PLANNER_URL}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    })
  } catch (err) {
    if (signal.aborted) throw err
    throw new PlannerUnavailableError('Could not reach the planner.')
  }
  // The Next.js proxy answers 500/502/503 with a non-JSON body when uvicorn isn't running.
  if (!res.ok) {
    const body = await res.text()
    let detail = body
    try {
      detail = JSON.parse(body).detail ?? body
    } catch {
      throw new PlannerUnavailableError(`The planner is not responding (${res.status}).`)
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  const raw: RawResult = await res.json()
  const assignment = raw.assignment ? fromBase64(raw.assignment) : null
  let planned = 0
  if (assignment) for (let j = 0; j < assignment.length; j++) if (assignment[j] !== 255) planned++
  return {
    ...raw,
    assignment,
    carries: fromBase64(raw.carries),
    stability: raw.stability ? fromBase64(raw.stability) : null,
    cloud: raw.cloud ? raw.cloud.map((c) => Float32Array.from(c)) : null,
    planned,
  }
}
