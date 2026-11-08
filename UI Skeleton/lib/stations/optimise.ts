/**
 * Station placement for one product: weighted k-means, then a Monte Carlo
 * over asteroid composition to see how much the answer depends on it.
 *
 * Space
 * - Every filtered asteroid is a point in a velocity-like space, so squared
 *   distance stands for the Δv² needed to get from a station to it:
 *     x = (√1.25 ln a, √2 e, √2 sin i, q cos θ, q sin θ)
 *   The first three are the Zappalà family metric (orbit size, shape, tilt,
 *   in units of the orbital speed v). θ is the body's heliocentric longitude
 *   now; catching up Δθ along an orbit within a trip time T costs about
 *   (2/3)·a·Δθ / T, which in units of v is q·Δθ with q = (2/3)·P / (2π·T)
 *   (P the orbital period). Points on a circle of radius q give that cost
 *   for small Δθ and stay Euclidean, so plain k-means applies.
 *
 * Clustering
 * - Weight w_j = tonnes of the product's asteroid-sourced elements in body j
 *   (mass × grade, bodies counted up to 100 km across).
 * - Weighted k-means: every asteroid belongs to its nearest station (no
 *   distance limit, no sharing; on an exact tie the later station takes it).
 *   Each station sits at the w-weighted mean of its asteroids, i.e. where the
 *   tonnage-weighted squared Δv to its asteroids is smallest.
 * - k-means++ starts, several restarts, best (lowest weighted inertia) kept.
 *
 * Output
 * - A station yields what its asteroids contain: for every element, Σ mass ×
 *   grade over its members. 70% magnetite gives iron and oxygen in the
 *   magnetite ratio; nothing is capped by the scarcest input.
 *
 * Monte Carlo
 * - Each draw resamples every taxonomic type's mineral mix from a Dirichlet
 *   around the lookup's values, wider for lower confidence (H/M/L/VL), and
 *   the blend weights of mixed classes (e.g. CX = C + P). All asteroids of a
 *   class share the draw: the uncertainty is in what the class is made of.
 * - k-means is re-run per draw, warm-started from the nominal stations so
 *   station k stays station k. Ranges are 5th–95th percentiles.
 * - For speed the draws cluster a grid summary of the asteroids (cells in
 *   a, e, i, longitude) instead of every body; positions don't change between
 *   draws, only the cell weights do.
 */

export interface SamplingModel {
  /** Every tracked element id; outputs are reported for all of them. */
  elements: string[]
  /** Indices into `elements` of the product's asteroid-sourced inputs. */
  required: Int32Array
  hIndex: number
  waterIndex: number
  hInWater: number
  mineralCount: number
  /** mineralCount × elements, mass fraction of each element in each mineral. */
  mineralYield: Float32Array
  typeCount: number
  /** typeCount × mineralCount, nominal mineral mass fractions (rows sum to 1). */
  typeMinerals: Float32Array
  /** Dirichlet concentration per type (from its confidence grade). */
  typeKappa: Float32Array
  scenarioCount: number
  /** scenarioCount × elements, nominal grade in kg per tonne. */
  scenarioGrade: Float32Array
  /** Per scenario: base types and blend weights; empty when it can't be resampled. */
  scenarioBases: { types: number[]; weights: number[] }[]
}

export interface StationProblem {
  n: number
  /** Dataset index of each row. */
  index: Int32Array
  /** Orbit coordinates (√1.25 ln a, √2 e, √2 sin i), interleaved. */
  x: Float32Array
  /** Semi-major axis, au. */
  a: Float32Array
  /** Heliocentric ecliptic longitude at the dataset epoch, radians. */
  phase: Float32Array
  /** Rock mass counted for mining, tonnes (bodies capped at 100 km across). */
  mass: Float32Array
  /** Index into the model's scenarios, −1 when the class is unknown. */
  scenario: Int16Array
  model: SamplingModel
}

export interface PlanParams {
  stations: number
  /** Time allowed for a phasing drift along the orbit, years. */
  tripYears: number
  /** Monte Carlo draws; 0 skips the Monte Carlo. */
  draws: number
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
  /**
   * How bunched its asteroids are along the orbit, 0–1 (1 = all at the
   * station's longitude, near 0 = spread all the way round, so the
   * longitude means little).
   */
  bunching: number
  topMembers: Member[]
  /** Monte Carlo ranges (absent until the draws finish). */
  ranges?: {
    a: Range
    longitude: Range
    share: Range
    output: Range[]
  }
}

export interface PlanResult {
  stations: PlannedStation[]
  elements: string[]
  required: string[]
  /** Station of each problem row (same order as problem.index); 255 = none. */
  assignment: Uint8Array
  /** Fraction of Monte Carlo draws in which each row stayed with its station. */
  stability: Float32Array | null
  /** Station positions per draw: draws × stations × (x, y) heliocentric au. */
  cloud: Float32Array | null
  draws: number
  restarts: number
  iterations: number
  cells: number
  tripYears: number
  ms: number
}

export type PlanMessage =
  | { kind: 'nominal'; result: PlanResult }
  | { kind: 'progress'; done: number; total: number }
  | { kind: 'final'; result: PlanResult }

const V_EARTH_KMS = 29.78
const RESTARTS = 6
const MAX_ITER = 60
const MC_MAX_ITER = 15
const BLEND_KAPPA = 10
const TOP_MEMBERS = 8
const DIM = 5
const SQRT_125 = Math.sqrt(1.25)
const SQRT_2 = Math.SQRT2

/** Dirichlet concentration for each confidence grade of the mineral lookup. */
export const CONFIDENCE_KAPPA: Record<string, number> = { H: 200, M: 60, L: 25, VL: 10 }

/** Orbit-space coordinates of (a, e, i in degrees). */
export function toDeltaV(a: number, e: number, iDeg: number): [number, number, number] {
  return [SQRT_125 * Math.log(a), SQRT_2 * e, SQRT_2 * Math.sin((iDeg * Math.PI) / 180)]
}

// ---------------------------------------------------------------- random numbers

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function normal(rand: () => number) {
  let u = 0
  while (u === 0) u = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/** Gamma(shape, 1) by Marsaglia–Tsang (with the shape < 1 boost). */
function gamma(shape: number, rand: () => number): number {
  if (shape < 1) return gamma(shape + 1, rand) * Math.pow(rand() || 1e-12, 1 / shape)
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number, v: number
    do {
      x = normal(rand)
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rand()
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

/** Dirichlet sample with mean `mean` (sums to 1) and concentration kappa, written into out. */
function dirichlet(mean: ArrayLike<number>, kappa: number, rand: () => number, out: Float64Array) {
  let sum = 0
  for (let m = 0; m < mean.length; m++) {
    out[m] = mean[m] > 0 ? gamma(kappa * mean[m], rand) : 0
    sum += out[m]
  }
  for (let m = 0; m < mean.length; m++) out[m] = sum > 0 ? out[m] / sum : mean[m]
}

// ---------------------------------------------------------------- weighted k-means

/** Nearest centroid for each point; on an exact tie the later station wins. */
function assign(X: Float32Array, n: number, C: Float64Array, k: number, out: Uint8Array) {
  let changed = 0
  for (let j = 0; j < n; j++) {
    const o = j * DIM
    let best = 0
    let bestD = Infinity
    for (let c = 0; c < k; c++) {
      const p = c * DIM
      let d = 0
      for (let t = 0; t < DIM; t++) {
        const diff = X[o + t] - C[p + t]
        d += diff * diff
      }
      if (d <= bestD) {
        bestD = d
        best = c
      }
    }
    if (out[j] !== best) {
      out[j] = best
      changed++
    }
  }
  return changed
}

/** Move each centroid to the weighted mean of its points; reseed empty ones at the worst-served point. */
function update(X: Float32Array, w: Float64Array, n: number, labels: Uint8Array, C: Float64Array, k: number) {
  const sum = new Float64Array(k * DIM)
  const W = new Float64Array(k)
  for (let j = 0; j < n; j++) {
    const wj = w[j]
    if (wj <= 0) continue
    const c = labels[j]
    W[c] += wj
    for (let t = 0; t < DIM; t++) sum[c * DIM + t] += wj * X[j * DIM + t]
  }
  for (let c = 0; c < k; c++) {
    if (W[c] > 0) {
      for (let t = 0; t < DIM; t++) C[c * DIM + t] = sum[c * DIM + t] / W[c]
    } else {
      // Empty station: move it to the point contributing most to the inertia.
      let worst = -1
      let worstCost = -1
      for (let j = 0; j < n; j++) {
        if (w[j] <= 0) continue
        const p = labels[j] * DIM
        let d = 0
        for (let t = 0; t < DIM; t++) d += (X[j * DIM + t] - C[p + t]) ** 2
        if (w[j] * d > worstCost) {
          worstCost = w[j] * d
          worst = j
        }
      }
      if (worst >= 0) for (let t = 0; t < DIM; t++) C[c * DIM + t] = X[worst * DIM + t]
    }
  }
}

function inertia(X: Float32Array, w: Float64Array, n: number, labels: Uint8Array, C: Float64Array) {
  let s = 0
  for (let j = 0; j < n; j++) {
    if (w[j] <= 0) continue
    const p = labels[j] * DIM
    let d = 0
    for (let t = 0; t < DIM; t++) d += (X[j * DIM + t] - C[p + t]) ** 2
    s += w[j] * d
  }
  return s
}

function lloyd(X: Float32Array, w: Float64Array, n: number, C: Float64Array, k: number, labels: Uint8Array, maxIter: number) {
  let it = 0
  for (; it < maxIter; it++) {
    const changed = assign(X, n, C, k, labels)
    if (changed === 0 && it > 0) break
    update(X, w, n, labels, C, k)
  }
  return it
}

/** Distance to the assigned centre (upper) and to the nearest other centre (lower), per point. */
function bounds(X: Float32Array, n: number, C: Float64Array, k: number, labels: Uint8Array) {
  const upper = new Float64Array(n)
  const lower = new Float64Array(n)
  for (let j = 0; j < n; j++) {
    let second = Infinity
    for (let c = 0; c < k; c++) {
      let d = 0
      for (let t = 0; t < DIM; t++) d += (X[j * DIM + t] - C[c * DIM + t]) ** 2
      if (c === labels[j]) upper[j] = Math.sqrt(d)
      else if (d < second) second = d
    }
    lower[j] = Math.sqrt(second)
  }
  return { upper, lower }
}

/**
 * Weighted Lloyd iterations with Hamerly's bounds: a point whose distance to
 * its centre (upper bound) is below its distance to every other centre (lower
 * bound) can't change station, so only points near a boundary are re-checked.
 * Starts from labels that are already nearest-centre for C and from their bounds.
 */
function lloydBounded(
  X: Float32Array,
  w: Float64Array,
  n: number,
  C: Float64Array,
  k: number,
  labels: Uint8Array,
  upper: Float64Array,
  lower: Float64Array,
  maxIter: number,
) {
  const old = new Float64Array(k * DIM)
  const shift = new Float64Array(k)
  for (let it = 0; it < maxIter; it++) {
    old.set(C)
    update(X, w, n, labels, C, k)
    let maxShift = 0
    for (let c = 0; c < k; c++) {
      let d = 0
      for (let t = 0; t < DIM; t++) d += (C[c * DIM + t] - old[c * DIM + t]) ** 2
      shift[c] = Math.sqrt(d)
      if (shift[c] > maxShift) maxShift = shift[c]
    }
    if (maxShift === 0) break
    let changed = 0
    for (let j = 0; j < n; j++) {
      upper[j] += shift[labels[j]]
      lower[j] -= maxShift
      if (upper[j] < lower[j]) continue
      // Tighten the upper bound, then do the full search only if still needed.
      const o = j * DIM
      let d = 0
      for (let t = 0; t < DIM; t++) d += (X[o + t] - C[labels[j] * DIM + t]) ** 2
      upper[j] = Math.sqrt(d)
      if (upper[j] < lower[j]) continue
      let best = labels[j]
      let bestD = d
      let second = Infinity
      for (let c = 0; c < k; c++) {
        if (c === labels[j]) continue
        let dc = 0
        for (let t = 0; t < DIM; t++) dc += (X[o + t] - C[c * DIM + t]) ** 2
        if (dc <= bestD) {
          second = bestD
          bestD = dc
          best = c
        } else if (dc < second) second = dc
      }
      if (best !== labels[j]) {
        labels[j] = best
        changed++
      }
      upper[j] = Math.sqrt(bestD)
      lower[j] = Math.sqrt(second)
    }
    if (changed === 0) break
  }
}

/** Weighted k-means++: first centre ∝ w, then ∝ w × D². */
function seedPlusPlus(X: Float32Array, w: Float64Array, n: number, k: number, rand: () => number) {
  const C = new Float64Array(k * DIM)
  const D = new Float64Array(n).fill(Infinity)
  const pick = (score: (j: number) => number) => {
    let total = 0
    for (let j = 0; j < n; j++) total += score(j)
    let t = rand() * total
    for (let j = 0; j < n; j++) {
      t -= score(j)
      if (t <= 0) return j
    }
    return n - 1
  }
  for (let c = 0; c < k; c++) {
    const j = c === 0 ? pick((i) => w[i]) : pick((i) => w[i] * D[i])
    for (let t = 0; t < DIM; t++) C[c * DIM + t] = X[j * DIM + t]
    for (let i = 0; i < n; i++) {
      let d = 0
      for (let t = 0; t < DIM; t++) d += (X[i * DIM + t] - C[c * DIM + t]) ** 2
      if (d < D[i]) D[i] = d
    }
  }
  return C
}

// ---------------------------------------------------------------- helpers

/** Embed every asteroid in the 5-D Δv space for trip time T (years). */
function embed(p: StationProblem, tripYears: number) {
  const X = new Float32Array(p.n * DIM)
  for (let j = 0; j < p.n; j++) {
    const period = Math.pow(p.a[j], 1.5)
    const q = ((2 / 3) * period) / (2 * Math.PI * tripYears)
    X[j * DIM] = p.x[j * 3]
    X[j * DIM + 1] = p.x[j * 3 + 1]
    X[j * DIM + 2] = p.x[j * 3 + 2]
    X[j * DIM + 3] = q * Math.cos(p.phase[j])
    X[j * DIM + 4] = q * Math.sin(p.phase[j])
  }
  return X
}

/** Station orbit from a centroid. */
function centroidOrbit(C: Float64Array, o: number) {
  const a = Math.exp(C[o] / SQRT_125)
  return {
    a,
    e: Math.max(0, C[o + 1] / SQRT_2),
    i: (Math.asin(Math.min(1, Math.max(0, C[o + 2] / SQRT_2))) * 180) / Math.PI,
    lon: Math.atan2(C[o + 4], C[o + 3]),
  }
}

/** Grade of every element for each scenario, kg per tonne, given sampled type minerals. */
function scenarioGrades(model: SamplingModel, typeMin: Float64Array, rand: () => number, out: Float64Array) {
  const E = model.elements.length
  const M = model.mineralCount
  const mix = new Float64Array(M)
  const blend = new Float64Array(8)
  for (let s = 0; s < model.scenarioCount; s++) {
    const base = model.scenarioBases[s]
    if (base.types.length === 0) {
      for (let e = 0; e < E; e++) out[s * E + e] = model.scenarioGrade[s * E + e]
      continue
    }
    let weights: ArrayLike<number> = base.weights
    if (base.types.length > 1) {
      dirichlet(base.weights, BLEND_KAPPA, rand, blend)
      weights = blend
    }
    mix.fill(0)
    base.types.forEach((b, i) => {
      for (let m = 0; m < M; m++) mix[m] += weights[i] * typeMin[b * M + m]
    })
    for (let e = 0; e < E; e++) {
      let g = 0
      for (let m = 0; m < M; m++) g += mix[m] * model.mineralYield[m * E + e]
      out[s * E + e] = g * 1000
    }
    if (model.hIndex >= 0 && model.waterIndex >= 0) out[s * E + model.hIndex] += out[s * E + model.waterIndex] * model.hInWater
  }
}

function percentile(sorted: Float64Array, q: number) {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function range(values: Float64Array): Range {
  const s = values.slice().sort()
  return { lo: percentile(s, 0.05), mid: percentile(s, 0.5), hi: percentile(s, 0.95) }
}

const wrap = (d: number) => (d > Math.PI ? d - 2 * Math.PI : d <= -Math.PI ? d + 2 * Math.PI : d)

// ---------------------------------------------------------------- main

export function planStations(problem: StationProblem, params: PlanParams, emit: (m: PlanMessage) => void) {
  const t0 = performance.now()
  const { n, model } = problem
  const E = model.elements.length
  const k = Math.max(1, Math.min(Math.floor(params.stations), 32))
  const tripYears = Math.max(0.1, params.tripYears)
  const rand = mulberry32(7)
  const X = embed(problem, tripYears)

  // Nominal weights: tonnes of the product's inputs per body.
  const reqGrade = new Float64Array(model.scenarioCount)
  for (let s = 0; s < model.scenarioCount; s++) {
    for (const e of model.required) reqGrade[s] += model.scenarioGrade[s * E + e]
  }
  const w = new Float64Array(n)
  for (let j = 0; j < n; j++) {
    const s = problem.scenario[j]
    w[j] = s >= 0 ? (problem.mass[j] * reqGrade[s]) / 1000 : 0
  }

  // Grid summary ("cells") used for restarts and the Monte Carlo.
  const cells = buildCells(problem, X, w)

  // 1. Restarts of weighted k-means++ on the cells, best kept.
  let bestC: Float64Array | null = null
  let bestI = Infinity
  let iterations = 0
  const cellLabels = new Uint8Array(cells.count)
  for (let r = 0; r < RESTARTS; r++) {
    const C = seedPlusPlus(cells.X, cells.w, cells.count, k, rand)
    cellLabels.fill(255)
    iterations += lloyd(cells.X, cells.w, cells.count, C, k, cellLabels, MAX_ITER)
    const I = inertia(cells.X, cells.w, cells.count, cellLabels, C)
    if (I < bestI) {
      bestI = I
      bestC = C
    }
  }
  // 2. Finish on every asteroid.
  const C = bestC!
  const labels = new Uint8Array(n).fill(255)
  iterations += lloyd(X, w, n, C, k, labels, MAX_ITER)
  assign(X, n, C, k, labels)

  // Order stations by the tonnage they hold.
  const held = new Float64Array(k)
  for (let j = 0; j < n; j++) held[labels[j]] += w[j]
  const order = Array.from({ length: k }, (_, c) => c).sort((p, q) => held[q] - held[p])
  const rank = new Uint8Array(k)
  order.forEach((c, r) => (rank[c] = r))
  const Cs = new Float64Array(k * DIM)
  order.forEach((c, r) => Cs.set(C.subarray(c * DIM, c * DIM + DIM), r * DIM))
  for (let j = 0; j < n; j++) labels[j] = rank[labels[j]]

  const totalW = held.reduce((s, v) => s + v, 0)
  const stations = describe(problem, X, w, labels, Cs, k, totalW)
  const base: PlanResult = {
    stations,
    elements: model.elements,
    required: Array.from(model.required, (e) => model.elements[e]),
    assignment: labels,
    stability: null,
    cloud: null,
    draws: 0,
    restarts: RESTARTS,
    iterations,
    cells: cells.count,
    tripYears,
    ms: performance.now() - t0,
  }
  emit({ kind: 'nominal', result: base })
  if (params.draws <= 0 || totalW <= 0) {
    emit({ kind: 'final', result: base })
    return
  }

  // 3. Monte Carlo over composition, warm-started from the nominal stations.
  const D = Math.floor(params.draws)
  const M = model.mineralCount
  const typeMin = new Float64Array(model.typeCount * M)
  const sampled = new Float64Array(M)
  const grade = new Float64Array(model.scenarioCount * E)
  const cw = new Float64Array(cells.count)
  const lab = new Uint8Array(cells.count)
  const Cd = new Float64Array(k * DIM)
  const nominalCell = new Uint8Array(cells.count)
  assign(cells.X, cells.count, Cs, k, nominalCell)
  const start = bounds(cells.X, cells.count, Cs, k, nominalCell)
  const upper = new Float64Array(cells.count)
  const lower = new Float64Array(cells.count)
  const S = model.scenarioCount
  const reqDraw = new Float64Array(S)
  const stationScenarioMass = new Float64Array(k * S)
  const stay = new Float32Array(cells.count * k)
  const aDraw = new Float64Array(D * k)
  const lonDraw = new Float64Array(D * k)
  const shareDraw = new Float64Array(D * k)
  const outDraw = new Float64Array(D * k * E)
  const cloud = new Float32Array(D * k * 2)
  const nominalLon = stations.map((s) => (s.longitude * Math.PI) / 180)
  const wk = new Float64Array(k)

  for (let d = 0; d < D; d++) {
    for (let b = 0; b < model.typeCount; b++) {
      dirichlet(model.typeMinerals.subarray(b * M, b * M + M), model.typeKappa[b], rand, sampled)
      typeMin.set(sampled, b * M)
    }
    scenarioGrades(model, typeMin, rand, grade)
    for (let s = 0; s < S; s++) {
      let g = 0
      for (const e of model.required) g += grade[s * E + e]
      reqDraw[s] = g / 1000
    }
    cw.fill(0)
    for (let p = 0; p < cells.pairs; p++) cw[cells.pairCell[p]] += cells.pairMass[p] * reqDraw[cells.pairScenario[p]]
    Cd.set(Cs)
    lab.set(nominalCell)
    upper.set(start.upper)
    lower.set(start.lower)
    lloydBounded(cells.X, cw, cells.count, Cd, k, lab, upper, lower, MC_MAX_ITER)

    let tot = 0
    wk.fill(0)
    for (let c = 0; c < cells.count; c++) {
      wk[lab[c]] += cw[c]
      tot += cw[c]
      stay[c * k + lab[c]]++
    }
    // Output per station: its mass in each class × that class's sampled grades.
    stationScenarioMass.fill(0)
    for (let p = 0; p < cells.pairs; p++) {
      stationScenarioMass[lab[cells.pairCell[p]] * S + cells.pairScenario[p]] += cells.pairMass[p] / 1000
    }
    for (let c = 0; c < k; c++) {
      const o = (d * k + c) * E
      for (let s = 0; s < S; s++) {
        const m = stationScenarioMass[c * S + s]
        if (m === 0) continue
        for (let e = 0; e < E; e++) outDraw[o + e] += m * grade[s * E + e]
      }
    }
    for (let c = 0; c < k; c++) {
      const o = centroidOrbit(Cd, c * DIM)
      aDraw[d * k + c] = o.a
      // Longitude relative to nominal, unwrapped, so ranges don't jump at ±180°.
      lonDraw[d * k + c] = nominalLon[c] + wrap(o.lon - nominalLon[c])
      shareDraw[d * k + c] = tot > 0 ? wk[c] / tot : 0
      cloud[(d * k + c) * 2] = o.a * Math.cos(o.lon)
      cloud[(d * k + c) * 2 + 1] = o.a * Math.sin(o.lon)
    }
    if ((d + 1) % 50 === 0 && d + 1 < D) emit({ kind: 'progress', done: d + 1, total: D })
  }

  const column = (src: Float64Array, c: number, stride: number, offset = 0) => {
    const v = new Float64Array(D)
    for (let d = 0; d < D; d++) v[d] = src[(d * k + c) * stride + offset]
    return v
  }
  const toDeg = (r: number) => (r * 180) / Math.PI
  const finalStations = stations.map((s, c) => {
    const lon = range(column(lonDraw, c, 1))
    return {
      ...s,
      ranges: {
        a: range(column(aDraw, c, 1)),
        longitude: { lo: toDeg(lon.lo), mid: toDeg(lon.mid), hi: toDeg(lon.hi) },
        share: range(column(shareDraw, c, 1)),
        output: Array.from({ length: E }, (_, e) => range(column(outDraw, c, E, e))),
      },
    }
  })
  const stability = new Float32Array(n)
  for (let j = 0; j < n; j++) stability[j] = stay[cells.of[j] * k + labels[j]] / D

  emit({
    kind: 'final',
    result: { ...base, stations: finalStations, stability, cloud, draws: D, ms: performance.now() - t0 },
  })
}

/** Grid summary of the asteroids: cells in (ln a, e, sin i, longitude). */
function buildCells(p: StationProblem, X: Float32Array, w: Float64Array) {
  const NA = 32, NE = 10, NI = 10, NT = 24
  let laMin = Infinity, laMax = -Infinity, eMax = 0, siMax = 0
  for (let j = 0; j < p.n; j++) {
    laMin = Math.min(laMin, X[j * DIM])
    laMax = Math.max(laMax, X[j * DIM])
    eMax = Math.max(eMax, X[j * DIM + 1])
    siMax = Math.max(siMax, X[j * DIM + 2])
  }
  const bin = (v: number, lo: number, hi: number, nb: number) =>
    Math.min(nb - 1, Math.max(0, Math.floor(((v - lo) / Math.max(hi - lo, 1e-9)) * nb)))
  const ids = new Map<number, number>()
  const of = new Int32Array(p.n)
  for (let j = 0; j < p.n; j++) {
    const key =
      ((bin(X[j * DIM], laMin, laMax, NA) * NE + bin(X[j * DIM + 1], 0, eMax, NE)) * NI + bin(X[j * DIM + 2], 0, siMax, NI)) *
        NT +
      bin(p.phase[j], -Math.PI, Math.PI, NT)
    let id = ids.get(key)
    if (id === undefined) {
      id = ids.size
      ids.set(key, id)
    }
    of[j] = id
  }
  const count = ids.size
  const cx = new Float64Array(count * DIM)
  const cwSum = new Float64Array(count)
  const pairKey = new Map<number, number>()
  const pairCell: number[] = []
  const pairScenario: number[] = []
  const pairMass: number[] = []
  for (let j = 0; j < p.n; j++) {
    const c = of[j]
    // Weighted by tonnage where there is any, so a cell sits where its mass is.
    const wt = w[j] > 0 ? w[j] : 1e-9
    cwSum[c] += wt
    for (let t = 0; t < DIM; t++) cx[c * DIM + t] += wt * X[j * DIM + t]
    const s = p.scenario[j]
    if (s >= 0 && p.mass[j] > 0) {
      const key = c * 1024 + s
      let pi = pairKey.get(key)
      if (pi === undefined) {
        pi = pairCell.length
        pairKey.set(key, pi)
        pairCell.push(c)
        pairScenario.push(s)
        pairMass.push(0)
      }
      pairMass[pi] += p.mass[j]
    }
  }
  const cellX = new Float32Array(count * DIM)
  const cellW = new Float64Array(count)
  for (let c = 0; c < count; c++) {
    for (let t = 0; t < DIM; t++) cellX[c * DIM + t] = cx[c * DIM + t] / cwSum[c]
  }
  for (let j = 0; j < p.n; j++) cellW[of[j]] += w[j]
  return {
    count,
    of,
    X: cellX,
    w: cellW,
    pairs: pairCell.length,
    pairCell: Int32Array.from(pairCell),
    pairScenario: Int32Array.from(pairScenario),
    pairMass: Float64Array.from(pairMass),
  }
}

/** Orbit, output, Δv and top members of every station for one assignment. */
function describe(
  p: StationProblem,
  X: Float32Array,
  w: Float64Array,
  labels: Uint8Array,
  C: Float64Array,
  k: number,
  totalW: number,
): PlannedStation[] {
  const { model } = p
  const E = model.elements.length
  return Array.from({ length: k }, (_, c) => {
    const o = centroidOrbit(C, c * DIM)
    const v = V_EARTH_KMS / Math.sqrt(o.a)
    const output = new Array<number>(E).fill(0)
    const members: { j: number; dv: number; w: number }[] = []
    let held = 0
    let qSum = 0
    for (let j = 0; j < p.n; j++) {
      if (labels[j] !== c) continue
      const s = p.scenario[j]
      if (s >= 0) for (let e = 0; e < E; e++) output[e] += (p.mass[j] * model.scenarioGrade[s * E + e]) / 1000
      let d = 0
      for (let t = 0; t < DIM; t++) d += (X[j * DIM + t] - C[c * DIM + t]) ** 2
      members.push({ j, dv: v * Math.sqrt(d), w: w[j] })
      held += w[j]
      qSum += w[j] * Math.hypot(X[j * DIM + 3], X[j * DIM + 4])
    }
    // Tonnage-weighted median Δv.
    const byDv = members.filter((m) => m.w > 0).sort((p1, p2) => p1.dv - p2.dv)
    let acc = 0
    let dvMedian = 0
    for (const m of byDv) {
      acc += m.w
      if (acc >= held / 2) {
        dvMedian = m.dv
        break
      }
    }
    const top = members
      .filter((m) => m.w > 0)
      .sort((p1, p2) => p2.w - p1.w)
      .slice(0, TOP_MEMBERS)
      .map((m) => {
        const dTheta = wrap(p.phase[m.j] - o.lon)
        return { index: p.index[m.j], tonnes: m.w, dv: m.dv, offsetDeg: (dTheta * 180) / Math.PI }
      })
    return {
      a: o.a,
      e: o.e,
      i: o.i,
      longitude: (o.lon * 180) / Math.PI,
      members: members.length,
      share: totalW > 0 ? held / totalW : 0,
      output,
      dvMedian,
      bunching: qSum > 0 ? Math.min(1, Math.hypot(C[c * DIM + 3], C[c * DIM + 4]) / (qSum / held)) : 0,
      topMembers: top,
    }
  })
}
