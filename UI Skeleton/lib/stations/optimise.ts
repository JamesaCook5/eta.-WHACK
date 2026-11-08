/**
 * Station placement for one product.
 *
 * Model
 * - Stations sit in orbit space, not on asteroids. Distance between a station
 *   and an asteroid is the Zappalà-style velocity metric used for asteroid
 *   families: d = v·√(5/4 (δa/a)² + 2 δe² + 2 δ(sin i)²), with v the
 *   station's circular orbital speed. In the coordinates
 *   x = (√1.25 ln a, √2 e, √2 sin i) this is d = v·|x_j − y_k|.
 * - Stations also have a position along their orbit: a heliocentric
 *   longitude φ at the dataset epoch. Reaching an asteroid that is Δθ ahead
 *   or behind on a similar orbit takes a phasing manoeuvre: drop to a
 *   slightly different orbit, drift, return. Closing Δθ within a trip time T
 *   costs Δv_phase ≈ (2/3)·a·|Δθ| / T (two small Hohmann burns; the drift
 *   rate of a nearby orbit is (3/2)·n·δa/a). The cheapest way to an asteroid
 *   is then d = √(d_orbit² + Δv_phase²): orbit-shape change plus phasing.
 * - A station reaches an asteroid with weight K = exp(−d² / 2λ²). The UI's
 *   time reach is mapped to λ with a fixed acceleration assumption. Asteroid
 *   positions are a snapshot at the dataset epoch; their slow drift relative
 *   to the station is not modelled.
 * - Each asteroid's supply of element e, ŝ_je, is its share of the filtered
 *   set's supply (so every element sums to 1 across the map).
 * - Stations that reach the same asteroid split it: station k gets
 *   w_jk = K_jk / max(1, Σ_m K_jm).
 * - A station's output is limited by its scarcest input: production is the
 *   generalised mean with p = −6 of its shares c_ke = Σ_j w_jk ŝ_je, a smooth
 *   stand-in for min_e c_ke. The DAG has no quantities, so every input counts
 *   equally.
 * - Objective: total production F = Σ_k P_k.
 *
 * Search
 * 1. Greedy seeding: from ~256 candidate positions (asteroids with high
 *    supply, taking their orbit and current longitude), add stations one at a time, each where its own production after
 *    splitting with the stations already placed is highest.
 * 2. Refinement: gradient steps on F, normalised like mean-shift, with the
 *    reach annealed from 2λ to λ so stations first see the broad structure.
 *    The gradient includes the competition term, so stations that share
 *    asteroids push apart. The best layout seen at the true λ is kept.
 * 3. Relocation (as in Teitz–Bart swap heuristics): move the weakest station
 *    to the best candidate given the others, refine, keep it if F rises.
 */

export interface StationProblem {
  /** Element ids in the order used by `supply` and `tonnes`. */
  elements: string[]
  /** Number of asteroids that carry at least one required element. */
  n: number
  /** Interleaved Δv coordinates (√1.25 ln a, √2 e, √2 sin i). */
  x: Float32Array
  /** Heliocentric ecliptic longitude of each body at the dataset epoch, radians. */
  phase: Float32Array
  /** n × E, each element's column sums to 1 over the filtered set. */
  supply: Float32Array
  /** n × E, tonnes of each element in the body. */
  tonnes: Float32Array
  /** Dataset index of each row. */
  index: Int32Array
}

export interface PlanParams {
  stations: number
  /** Reach scale in estimated maneuver hours. */
  reachHours: number
  /** Time allowed for the phasing drift to an asteroid, years. */
  tripYears: number
}

export interface Supplier {
  /** Dataset index. */
  index: number
  /** Fraction of the station's bottleneck-weighted intake from this body. */
  share: number
  /** Cheapest Δv to reach it (orbit change and phasing combined), km/s. */
  dv: number
  /** Of which phasing, km/s. */
  dvPhase: number
  /** How far ahead (+) or behind (−) of the station it is along the orbit, degrees. */
  offsetDeg: number
}

export interface PlannedStation {
  a: number
  e: number
  /** Degrees. */
  i: number
  /** Heliocentric ecliptic longitude at the dataset epoch, degrees. */
  longitude: number
  /** One-reach (1σ) zone: semi-major axis range and half-width along the orbit. */
  zone: { aMin: number; aMax: number; halfAngleDeg: number }
  production: number
  /** Per element: share of the filtered set's supply this station receives. */
  shares: number[]
  /** Per element: tonnes this station receives (after splitting). */
  tonnes: number[]
  /** Index into elements of the scarcest input. */
  bottleneck: number
  /** Fraction of this station's reachable supply that it shares with other stations. */
  overlap: number
  /** Fewest bodies that together give half the station's intake. */
  bodies: number
  suppliers: Supplier[]
}

export interface PlanResult {
  stations: PlannedStation[]
  objective: number
  seedObjective: number
  iterations: number
  candidates: number
  /** Accepted relocations of the weakest station. */
  relocations: number
  bodies: number
  /** Reach λ in km/s. */
  reachKmS: number
  tripYears: number
  ms: number
}

const V_EARTH_KMS = 29.78
// Simplified continuous-thrust assumption used only to convert orbit-change
// Δv into a time scale. Real transfer windows and coast arcs are not modeled.
export const ASSUMED_ACCELERATION_M_S2 = 0.01
const P_EXP = -6
const CUTOFF_EXPONENT = 4.5 // exp(-4.5) ≈ 0.011, i.e. 3λ
const REFINE_BODIES = 15000
const SEED_BODIES = 6000
const CANDIDATES = 256
const ITERATIONS = 40
const ANNEAL_FRACTION = 0.6
const MAX_RELOCATION_ROUNDS = 3
const RELOCATION_TRIES = 3
const RELOCATION_ITERATIONS = 20
const SUPPLIERS = 12
const EPS = 1e-12
const AU_KM = 1.495978707e8
const YEAR_S = 365.25 * 86400
/** Values per station in the state vector: 3 orbit coordinates + longitude. */
const STRIDE = 4

const SQRT_125 = Math.sqrt(1.25)
const SQRT_2 = Math.SQRT2

/** Orbit-space coordinates of (a, e, i in degrees). */
export function toDeltaV(a: number, e: number, iDeg: number): [number, number, number] {
  return [SQRT_125 * Math.log(a), SQRT_2 * e, SQRT_2 * Math.sin((iDeg * Math.PI) / 180)]
}

/** a, e, i of a station state (orbit part only). */
function fromDeltaV(y: Float64Array, o: number) {
  const a = Math.exp(y[o] / SQRT_125)
  const e = Math.max(0, y[o + 1] / SQRT_2)
  const i = (Math.asin(Math.min(1, Math.max(0, y[o + 2] / SQRT_2))) * 180) / Math.PI
  return { a, e, i }
}

/** Signed angle θ − φ wrapped to (−π, π]. */
function wrap(d: number) {
  if (d > Math.PI) return d - 2 * Math.PI
  if (d <= -Math.PI) return d + 2 * Math.PI
  return d
}

/** Circular orbital speed (km/s) and phasing cost per radian (km/s) for a station at y. */
function speeds(y: Float64Array, o: number, T: number) {
  const a = Math.exp(y[o] / SQRT_125)
  return { a, v: V_EARTH_KMS / Math.sqrt(a), phase: ((2 / 3) * a * AU_KM) / T }
}

/**
 * Kernel scales for a station at y: K = exp(−(s·|x − y|² + r·Δθ²)), with
 * s = v² / 2λ² (orbit change) and r = ((2/3)·a/T)² / 2λ² (phasing).
 */
function kernelScales(y: Float64Array, o: number, lambda: number, T: number) {
  const { v, phase } = speeds(y, o, T)
  const d = 2 * lambda * lambda
  return { s: (v * v) / d, r: (phase * phase) / d }
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Generalised mean with exponent P_EXP of c[0..E), equal weights. */
function softMin(c: Float64Array, o: number, E: number) {
  let s = 0
  for (let e = 0; e < E; e++) s += Math.pow(c[o + e] + EPS, P_EXP)
  return Math.pow(s / E, 1 / P_EXP)
}

/** A subset of rows, with its own copies of x and supply. */
interface Rows {
  n: number
  rows: Int32Array
  x: Float32Array
  phase: Float32Array
  supply: Float32Array
}

function pickRows(problem: StationProblem, limit: number, score: Float64Array): Rows {
  const { n } = problem
  const E = problem.elements.length
  let rows: Int32Array
  if (n <= limit) {
    rows = Int32Array.from({ length: n }, (_, j) => j)
  } else {
    const order = Array.from({ length: n }, (_, j) => j).sort((p, q) => score[q] - score[p])
    rows = Int32Array.from(order.slice(0, limit))
  }
  const x = new Float32Array(rows.length * 3)
  const phase = new Float32Array(rows.length)
  const supply = new Float32Array(rows.length * E)
  rows.forEach((j, r) => {
    x.set(problem.x.subarray(j * 3, j * 3 + 3), r * 3)
    phase[r] = problem.phase[j]
    supply.set(problem.supply.subarray(j * E, j * E + E), r * E)
  })
  return { n: rows.length, rows, x, phase, supply }
}

interface Evaluation {
  K: Float32Array // stations × n
  S: Float32Array // n
  c: Float64Array // stations × E
  P: Float64Array // stations
  F: number
}

function evaluate(
  rows: Rows,
  Y: Float64Array,
  stations: number,
  E: number,
  lambda: number,
  T: number,
  out?: Evaluation,
): Evaluation {
  const { n, x, phase, supply } = rows
  const ev: Evaluation = out ?? {
    K: new Float32Array(stations * n),
    S: new Float32Array(n),
    c: new Float64Array(stations * E),
    P: new Float64Array(stations),
    F: 0,
  }
  ev.S.fill(0)
  ev.c.fill(0)
  for (let k = 0; k < stations; k++) {
    const o = k * STRIDE
    const { s, r } = kernelScales(Y, o, lambda, T)
    const y0 = Y[o], y1 = Y[o + 1], y2 = Y[o + 2], phi = Y[o + 3]
    const base = k * n
    for (let j = 0; j < n; j++) {
      const dt = wrap(phase[j] - phi)
      const zp = r * dt * dt
      if (zp >= CUTOFF_EXPONENT) {
        ev.K[base + j] = 0
        continue
      }
      const d0 = x[j * 3] - y0, d1 = x[j * 3 + 1] - y1, d2 = x[j * 3 + 2] - y2
      const z = (d0 * d0 + d1 * d1 + d2 * d2) * s + zp
      const kv = z < CUTOFF_EXPONENT ? Math.exp(-z) : 0
      ev.K[base + j] = kv
      ev.S[j] += kv
    }
  }
  for (let j = 0; j < n; j++) {
    const inv = 1 / Math.max(1, ev.S[j])
    for (let k = 0; k < stations; k++) {
      const kv = ev.K[k * n + j]
      if (kv === 0) continue
      const w = kv * inv
      for (let e = 0; e < E; e++) ev.c[k * E + e] += w * supply[j * E + e]
    }
  }
  ev.F = 0
  for (let k = 0; k < stations; k++) {
    ev.P[k] = softMin(ev.c, k * E, E)
    ev.F += ev.P[k]
  }
  return ev
}

/** ∂P_k/∂c_ke for every station and element. */
function bottleneckWeights(ev: Evaluation, stations: number, E: number) {
  const beta = new Float64Array(stations * E)
  for (let k = 0; k < stations; k++) {
    const P = ev.P[k]
    for (let e = 0; e < E; e++) {
      beta[k * E + e] = P > 0 ? Math.pow((ev.c[k * E + e] + EPS) / P, P_EXP - 1) / E : 1 / E
    }
  }
  return beta
}

interface Candidates {
  C: number
  /** Candidate states (Δv coordinates + longitude), STRIDE per candidate. */
  Yc: Float64Array
  /** C × n kernel columns at the true reach. */
  Kc: Float32Array
}

/** Candidate positions: strongest overall and per-element carriers, plus a weighted sample. */
function makeCandidates(rows: Rows, E: number, lambda: number, T: number, rand: () => number): Candidates {
  const { n, x, phase, supply } = rows
  const q = new Float64Array(n)
  for (let j = 0; j < n; j++) for (let e = 0; e < E; e++) q[j] += supply[j * E + e]
  const order = Array.from({ length: n }, (_, j) => j).sort((p, r) => q[r] - q[p])
  const chosen = new Set<number>(order.slice(0, Math.min(64, n)))
  for (let e = 0; e < E; e++) {
    const byElement = Array.from({ length: n }, (_, j) => j).sort((p, r) => supply[r * E + e] - supply[p * E + e])
    for (const j of byElement.slice(0, Math.min(8, n))) {
      if (chosen.size >= Math.min(CANDIDATES, n)) break
      chosen.add(j)
    }
  }
  let total = 0
  for (let j = 0; j < n; j++) total += Math.sqrt(q[j])
  let guard = 0
  while (chosen.size < Math.min(CANDIDATES, n) && guard++ < CANDIDATES * 20) {
    let t = rand() * total
    let j = 0
    while (j < n - 1 && (t -= Math.sqrt(q[j])) > 0) j++
    chosen.add(j)
  }
  const cand = [...chosen]
  const C = cand.length
  const Kc = new Float32Array(C * n)
  const Yc = new Float64Array(C * STRIDE)
  cand.forEach((j, c) => {
    const o = c * STRIDE
    Yc[o] = x[j * 3]
    Yc[o + 1] = x[j * 3 + 1]
    Yc[o + 2] = x[j * 3 + 2]
    Yc[o + 3] = phase[j]
    const { s, r } = kernelScales(Yc, o, lambda, T)
    for (let i = 0; i < n; i++) {
      const dt = wrap(phase[i] - Yc[o + 3])
      const d0 = x[i * 3] - Yc[o], d1 = x[i * 3 + 1] - Yc[o + 1], d2 = x[i * 3 + 2] - Yc[o + 2]
      const z = (d0 * d0 + d1 * d1 + d2 * d2) * s + r * dt * dt
      Kc[c * n + i] = z < CUTOFF_EXPONENT ? Math.exp(-z) : 0
    }
  })
  return { C, Yc, Kc }
}

/**
 * Candidates ranked by the production a new station there would get after
 * splitting with stations whose kernel sum per body is S.
 */
function rankCandidates(rows: Rows, cands: Candidates, S: Float32Array, E: number, skip: Set<number>) {
  const { n, supply } = rows
  const own = new Float64Array(E)
  const ranked: { c: number; P: number }[] = []
  for (let c = 0; c < cands.C; c++) {
    if (skip.has(c)) continue
    own.fill(0)
    const base = c * n
    for (let j = 0; j < n; j++) {
      const kv = cands.Kc[base + j]
      if (kv === 0) continue
      const w = kv / Math.max(1, S[j] + kv)
      for (let e = 0; e < E; e++) own[e] += w * supply[j * E + e]
    }
    ranked.push({ c, P: softMin(own, 0, E) })
  }
  return ranked.sort((p, q) => q.P - p.P)
}

/** Add stations one at a time, each at the candidate with the highest production after splitting. */
function greedySeed(rows: Rows, cands: Candidates, stations: number, E: number, rand: () => number, diversify: boolean) {
  const n = rows.n
  const S = new Float32Array(n)
  const Y = new Float64Array(stations * STRIDE)
  const used = new Set<number>()
  for (let k = 0; k < stations; k++) {
    const ranked = rankCandidates(rows, cands, S, E, used)
    const shortlist = ranked.slice(0, Math.min(diversify ? 4 : 1, ranked.length))
    const best = shortlist[Math.floor(rand() * shortlist.length)]?.c ?? k % cands.C
    used.add(best)
    for (let j = 0; j < n; j++) S[j] += cands.Kc[best * n + j]
    Y.set(cands.Yc.subarray(best * STRIDE, best * STRIDE + STRIDE), k * STRIDE)
  }
  return Y
}

/** One preconditioned gradient-ascent step on the exact forward objective. */
function step(rows: Rows, Y: Float64Array, ev: Evaluation, stations: number, E: number, lambda: number, T: number) {
  const { n, x, phase, supply } = rows
  const beta = bottleneckWeights(ev, stations, E)
  // g_jk = Σ_e β_ke ŝ_je : how much asteroid j helps station k.
  const g = new Float32Array(stations * n)
  for (let j = 0; j < n; j++) {
    for (let k = 0; k < stations; k++) {
      if (ev.K[k * n + j] === 0) continue
      let s = 0
      for (let e = 0; e < E; e++) s += beta[k * E + e] * supply[j * E + e]
      g[k * n + j] = s
    }
  }
  let maxMove = 0
  for (let k = 0; k < stations; k++) {
    const o = k * STRIDE
    let grad0 = 0, grad1 = 0, grad2 = 0, grad3 = 0
    const y0 = Y[o], y1 = Y[o + 1], y2 = Y[o + 2], phi = Y[o + 3]
    const { s, r } = kernelScales(Y, o, lambda, T)
    for (let j = 0; j < n; j++) {
      const kv = ev.K[k * n + j]
      if (kv === 0) continue
      const S = ev.S[j]
      let gamma: number
      if (S <= 1) {
        gamma = g[k * n + j]
      } else {
        // Competition: taking more of j only helps if this station values it
        // more than the stations it would take it from.
        let gbar = 0
        for (let m = 0; m < stations; m++) gbar += ev.K[m * n + j] * g[m * n + j]
        gamma = (g[k * n + j] - gbar / S) / S
      }
      // dF/dK_kj = gamma. Differentiate K = exp(−(s|Δx|² + rΔθ²)) through the
      // separations and the a-dependence of s (∝ 1/a) and r (∝ a²).
      const d0 = x[j * 3] - y0, d1 = x[j * 3 + 1] - y1, d2 = x[j * 3 + 2] - y2
      const dt = wrap(phase[j] - phi)
      const zx = s * (d0 * d0 + d1 * d1 + d2 * d2)
      const zp = r * dt * dt
      grad0 += gamma * kv * (2 * s * d0 + zx / SQRT_125 - (2 * zp) / SQRT_125)
      grad1 += gamma * kv * (2 * s * d1)
      grad2 += gamma * kv * (2 * s * d2)
      grad3 += gamma * kv * (2 * r * dt)
    }
    // Precondition in Δv units and cap the step to keep annealed refinement stable.
    const norm = Math.hypot(grad0 / Math.sqrt(s), grad1 / Math.sqrt(s), grad2 / Math.sqrt(s), grad3 / Math.sqrt(r))
    if (norm <= 1e-18) continue
    const rate = Math.min(0.2 * lambda, (0.5 * lambda) / norm)
    Y[o] += (rate * grad0) / s
    Y[o + 1] = Math.max(0, y1 + (rate * grad1) / s)
    Y[o + 2] = Math.min(SQRT_2, Math.max(0, y2 + (rate * grad2) / s))
    Y[o + 3] = wrap(phi + (rate * grad3) / r)
    const sp = speeds(Y, o, T)
    const move = Math.hypot(
      sp.v * Math.hypot(Y[o] - y0, Y[o + 1] - y1, Y[o + 2] - y2),
      sp.phase * wrap(Y[o + 3] - phi),
    )
    maxMove = Math.max(maxMove, move)
  }
  return maxMove / Math.max(lambda, 1e-9)
}

/**
 * Gradient refinement from Y. With `anneal`, the reach starts at 2λ and
 * shrinks to λ over the first 60% of iterations. Returns the best layout seen
 * at the true reach.
 */
function refine(
  rows: Rows,
  Y0: Float64Array,
  stations: number,
  E: number,
  lambda: number,
  T: number,
  iterations: number,
  anneal: boolean,
) {
  const Y = Y0.slice()
  let ev = evaluate(rows, Y, stations, E, lambda, T)
  let bestF = ev.F
  let bestY = Y.slice()
  const annealEnd = anneal ? Math.max(1, Math.floor(iterations * ANNEAL_FRACTION)) : 0
  const work = evaluate(rows, Y, stations, E, lambda, T)
  let still = 0
  let done = 0
  for (let t = 0; t < iterations; t++) {
    done = t + 1
    const lt = anneal ? lambda * (1 + Math.max(0, 1 - t / annealEnd)) : lambda
    const cur = evaluate(rows, Y, stations, E, lt, T, work)
    const moved = step(rows, Y, cur, stations, E, lt, T)
    ev = evaluate(rows, Y, stations, E, lambda, T, ev)
    if (ev.F > bestF) {
      bestF = ev.F
      bestY = Y.slice()
    }
    if (t >= annealEnd) {
      still = moved < 0.002 ? still + 1 : 0
      if (still >= 3) break
    }
  }
  return { Y: bestY, F: bestF, iterations: done }
}

function bodiesForHalf(sorted: { u: number }[], total: number) {
  let acc = 0
  for (let r = 0; r < sorted.length; r++) {
    acc += sorted[r].u
    if (acc >= total / 2) return r + 1
  }
  return sorted.length
}

export function optimiseStations(problem: StationProblem, params: PlanParams): PlanResult {
  const t0 = performance.now()
  const E = problem.elements.length
  const stations = Math.max(1, Math.floor(params.stations))
  const reachHours = Math.max(1, params.reachHours)
  // Δv = a·t. This maps the user's time budget onto the existing orbital
  // metric so the reach kernel and optimization score are time-scaled.
  const lambda = (ASSUMED_ACCELERATION_M_S2 * reachHours * 3600) / 1000
  const tripYears = Math.max(0.1, params.tripYears)
  const T = tripYears * YEAR_S
  const rand = mulberry32(1)

  // Rank bodies by their best share of any required element, so carriers of
  // the scarce inputs are always kept in the working set.
  const score = new Float64Array(problem.n)
  for (let j = 0; j < problem.n; j++) {
    let m = 0
    for (let e = 0; e < E; e++) m = Math.max(m, problem.supply[j * E + e])
    score[j] = m
  }
  const refineRows = pickRows(problem, REFINE_BODIES, score)
  const seedRows = pickRows(problem, SEED_BODIES, score)

  // 1. Greedy multi-start seeding, 2. annealed refinement. Slightly varied
  // near-best placements reduce dependence on one greedy tie/order choice.
  const cands = makeCandidates(seedRows, E, lambda, T, rand)
  let seedY = greedySeed(seedRows, cands, stations, E, rand, false)
  let bestSeedScore = evaluate(seedRows, seedY, stations, E, lambda, T).F
  let best = refine(refineRows, seedY, stations, E, lambda, T, ITERATIONS, true)
  let iterations = best.iterations
  for (let start = 1; start < 4; start++) {
    const candidateY = greedySeed(seedRows, cands, stations, E, rand, true)
    const candidateScore = evaluate(seedRows, candidateY, stations, E, lambda, T).F
    if (candidateScore > bestSeedScore) {
      seedY = candidateY
      bestSeedScore = candidateScore
    }
    const trial = refine(refineRows, candidateY, stations, E, lambda, T, ITERATIONS, true)
    iterations += trial.iterations
    if (trial.F > best.F) best = trial
  }

  // 3. Relocation: move the weakest station to the best open candidate given
  //    the others, refine, and keep the move if total production rises.
  let relocations = 0
  for (let round = 0; round < Math.min(stations, MAX_RELOCATION_ROUNDS) && stations > 1; round++) {
    const evSeed = evaluate(seedRows, best.Y, stations, E, lambda, T)
    let weakest = 0
    for (let k = 1; k < stations; k++) if (evSeed.P[k] < evSeed.P[weakest]) weakest = k
    const S = evSeed.S.slice()
    for (let j = 0; j < seedRows.n; j++) S[j] -= evSeed.K[weakest * seedRows.n + j]
    const options = rankCandidates(seedRows, cands, S, E, new Set()).slice(0, RELOCATION_TRIES)
    let improved = false
    for (const { c } of options) {
      const Y = best.Y.slice()
      Y.set(cands.Yc.subarray(c * STRIDE, c * STRIDE + STRIDE), weakest * STRIDE)
      const trial = refine(refineRows, Y, stations, E, lambda, T, RELOCATION_ITERATIONS, false)
      iterations += trial.iterations
      if (trial.F > best.F * (1 + 1e-4)) {
        best = { ...trial, iterations: best.iterations }
        improved = true
      }
    }
    if (!improved) break
    relocations++
  }
  const bestY = best.Y

  // Final report on every carrier, not just the working set.
  const all = pickRows(problem, Infinity, score)
  const seedObjective = evaluate(all, seedY, stations, E, lambda, T).F
  const fin = evaluate(all, bestY, stations, E, lambda, T)
  const beta = bottleneckWeights(fin, stations, E)
  const n = all.n
  const out: PlannedStation[] = []
  for (let k = 0; k < stations; k++) {
    const tonnes = new Array<number>(E).fill(0)
    const contrib: { j: number; u: number }[] = []
    let uTotal = 0
    let kTotal = 0
    for (let j = 0; j < n; j++) {
      const kv = fin.K[k * n + j]
      if (kv === 0) continue
      const row = all.rows[j]
      const w = kv / Math.max(1, fin.S[j])
      let qv = 0
      for (let e = 0; e < E; e++) {
        tonnes[e] += w * problem.tonnes[row * E + e]
        qv += beta[k * E + e] * all.supply[j * E + e]
      }
      const u = w * qv
      uTotal += u
      kTotal += kv * qv
      contrib.push({ j, u })
    }
    contrib.sort((p, q) => q.u - p.u)
    const shares = Array.from(fin.c.subarray(k * E, k * E + E))
    let bottleneck = 0
    for (let e = 1; e < E; e++) if (shares[e] < shares[bottleneck]) bottleneck = e
    const o = k * STRIDE
    const orbit = fromDeltaV(bestY, o)
    const sp = speeds(bestY, o, T)
    const phi = bestY[o + 3]
    // 1σ zone: Δv = λ from the a term alone, or from phasing alone.
    const da = lambda / (sp.v * SQRT_125)
    out.push({
      ...orbit,
      longitude: (phi * 180) / Math.PI,
      zone: {
        aMin: orbit.a * Math.exp(-da),
        aMax: orbit.a * Math.exp(da),
        halfAngleDeg: Math.min(180, ((lambda / sp.phase) * 180) / Math.PI),
      },
      production: fin.P[k],
      shares,
      tonnes,
      bottleneck,
      overlap: kTotal > 0 ? 1 - uTotal / kTotal : 0,
      bodies: bodiesForHalf(contrib, uTotal),
      suppliers: contrib.slice(0, SUPPLIERS).map((c) => {
        const dt = wrap(all.phase[c.j] - phi)
        const dOrbit =
          sp.v *
          Math.hypot(all.x[c.j * 3] - bestY[o], all.x[c.j * 3 + 1] - bestY[o + 1], all.x[c.j * 3 + 2] - bestY[o + 2])
        const dPhase = sp.phase * Math.abs(dt)
        return {
          index: problem.index[all.rows[c.j]],
          share: uTotal > 0 ? c.u / uTotal : 0,
          dv: Math.hypot(dOrbit, dPhase),
          dvPhase: dPhase,
          offsetDeg: (dt * 180) / Math.PI,
        }
      }),
    })
  }
  out.sort((p, q) => q.production - p.production)

  return {
    stations: out,
    objective: fin.F,
    seedObjective,
    iterations,
    candidates: cands.C,
    relocations,
    bodies: problem.n,
    reachKmS: lambda,
    tripYears,
    ms: performance.now() - t0,
  }
}
