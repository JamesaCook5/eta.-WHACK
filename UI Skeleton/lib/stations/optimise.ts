/**
 * Station placement for one product.
 *
 * Model
 * - Stations sit in orbit space, not on asteroids. Distance between a station
 *   and an asteroid is the Zappalà-style velocity metric used for asteroid
 *   families: d = v·√(5/4 (δa/a)² + 2 δe² + 2 δ(sin i)²), with v the
 *   station's circular orbital speed. In the coordinates
 *   x = (√1.25 ln a, √2 e, √2 sin i) this is d = v·|x_j − y_k|.
 * - A station reaches an asteroid with weight K = exp(−d² / 2λ²), where λ is
 *   the reach in km/s (cut off at 3λ).
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
 *    supply), add stations one at a time, each where its own production after
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
  /** n × E, each element's column sums to 1 over the filtered set. */
  supply: Float32Array
  /** n × E, tonnes of each element in the body. */
  tonnes: Float32Array
  /** Dataset index of each row. */
  index: Int32Array
}

export interface PlanParams {
  stations: number
  /** Reach λ in km/s. */
  reachKmS: number
}

export interface Supplier {
  /** Dataset index. */
  index: number
  /** Fraction of the station's bottleneck-weighted intake from this body. */
  share: number
}

export interface PlannedStation {
  a: number
  e: number
  /** Degrees. */
  i: number
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
  ms: number
}

const V_EARTH_KMS = 29.78
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

const SQRT_125 = Math.sqrt(1.25)
const SQRT_2 = Math.SQRT2

/** Orbit-space coordinates of (a, e, i in degrees). */
export function toDeltaV(a: number, e: number, iDeg: number): [number, number, number] {
  return [SQRT_125 * Math.log(a), SQRT_2 * e, SQRT_2 * Math.sin((iDeg * Math.PI) / 180)]
}

function fromDeltaV(y: Float64Array, o: number) {
  const a = Math.exp(y[o] / SQRT_125)
  const e = Math.max(0, y[o + 1] / SQRT_2)
  const i = (Math.asin(Math.min(1, Math.max(0, y[o + 2] / SQRT_2))) * 180) / Math.PI
  return { a, e, i }
}

/** Kernel scale for a station at y: K = exp(-|x - y|² · v² / 2λ²). */
function kernelScale(y: Float64Array, o: number, lambda: number) {
  const a = Math.exp(y[o] / SQRT_125)
  const v = V_EARTH_KMS / Math.sqrt(a)
  return (v * v) / (2 * lambda * lambda)
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
  const supply = new Float32Array(rows.length * E)
  rows.forEach((j, r) => {
    x.set(problem.x.subarray(j * 3, j * 3 + 3), r * 3)
    supply.set(problem.supply.subarray(j * E, j * E + E), r * E)
  })
  return { n: rows.length, rows, x, supply }
}

interface Evaluation {
  K: Float32Array // stations × n
  S: Float32Array // n
  c: Float64Array // stations × E
  P: Float64Array // stations
  F: number
}

function evaluate(rows: Rows, Y: Float64Array, stations: number, E: number, lambda: number, out?: Evaluation): Evaluation {
  const { n, x, supply } = rows
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
    const s = kernelScale(Y, k * 3, lambda)
    const y0 = Y[k * 3], y1 = Y[k * 3 + 1], y2 = Y[k * 3 + 2]
    const base = k * n
    for (let j = 0; j < n; j++) {
      const d0 = x[j * 3] - y0, d1 = x[j * 3 + 1] - y1, d2 = x[j * 3 + 2] - y2
      const z = (d0 * d0 + d1 * d1 + d2 * d2) * s
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
  /** Candidate positions in Δv coordinates. */
  Yc: Float64Array
  /** C × n kernel columns at the true reach. */
  Kc: Float32Array
}

/** Candidate positions: the strongest bodies plus a supply-weighted random sample. */
function makeCandidates(rows: Rows, E: number, lambda: number, rand: () => number): Candidates {
  const { n, x, supply } = rows
  const q = new Float64Array(n)
  for (let j = 0; j < n; j++) for (let e = 0; e < E; e++) q[j] += supply[j * E + e]
  const order = Array.from({ length: n }, (_, j) => j).sort((p, r) => q[r] - q[p])
  const chosen = new Set<number>(order.slice(0, Math.min(64, n)))
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
  const Yc = new Float64Array(C * 3)
  cand.forEach((j, c) => {
    Yc[c * 3] = x[j * 3]
    Yc[c * 3 + 1] = x[j * 3 + 1]
    Yc[c * 3 + 2] = x[j * 3 + 2]
    const s = kernelScale(Yc, c * 3, lambda)
    for (let i = 0; i < n; i++) {
      const d0 = x[i * 3] - Yc[c * 3], d1 = x[i * 3 + 1] - Yc[c * 3 + 1], d2 = x[i * 3 + 2] - Yc[c * 3 + 2]
      const z = (d0 * d0 + d1 * d1 + d2 * d2) * s
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
function greedySeed(rows: Rows, cands: Candidates, stations: number, E: number) {
  const n = rows.n
  const S = new Float32Array(n)
  const Y = new Float64Array(stations * 3)
  const used = new Set<number>()
  for (let k = 0; k < stations; k++) {
    const best = rankCandidates(rows, cands, S, E, used)[0]?.c ?? k % cands.C
    used.add(best)
    for (let j = 0; j < n; j++) S[j] += cands.Kc[best * n + j]
    Y.set(cands.Yc.subarray(best * 3, best * 3 + 3), k * 3)
  }
  return Y
}

/** One normalised gradient step on F for every station; returns the largest move in km/s. */
function step(rows: Rows, Y: Float64Array, ev: Evaluation, stations: number, E: number, lambda: number) {
  const { n, x, supply } = rows
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
    let num0 = 0, num1 = 0, num2 = 0, den = 0
    const y0 = Y[k * 3], y1 = Y[k * 3 + 1], y2 = Y[k * 3 + 2]
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
      const wgt = gamma * kv
      num0 += wgt * (x[j * 3] - y0)
      num1 += wgt * (x[j * 3 + 1] - y1)
      num2 += wgt * (x[j * 3 + 2] - y2)
      den += Math.abs(wgt)
    }
    if (den <= 0) continue
    Y[k * 3] += num0 / den
    Y[k * 3 + 1] = Math.max(0, y1 + num1 / den)
    Y[k * 3 + 2] = Math.min(SQRT_2, Math.max(0, y2 + num2 / den))
    const a = Math.exp(Y[k * 3] / SQRT_125)
    const move = (V_EARTH_KMS / Math.sqrt(a)) * Math.hypot(Y[k * 3] - y0, Y[k * 3 + 1] - y1, Y[k * 3 + 2] - y2)
    maxMove = Math.max(maxMove, move)
  }
  return maxMove / Math.max(lambda, 1e-9)
}

/**
 * Gradient refinement from Y. With `anneal`, the reach starts at 2λ and
 * shrinks to λ over the first 60% of iterations. Returns the best layout seen
 * at the true reach.
 */
function refine(rows: Rows, Y0: Float64Array, stations: number, E: number, lambda: number, iterations: number, anneal: boolean) {
  const Y = Y0.slice()
  let ev = evaluate(rows, Y, stations, E, lambda)
  let bestF = ev.F
  let bestY = Y.slice()
  const annealEnd = anneal ? Math.max(1, Math.floor(iterations * ANNEAL_FRACTION)) : 0
  const work = evaluate(rows, Y, stations, E, lambda)
  let still = 0
  let done = 0
  for (let t = 0; t < iterations; t++) {
    done = t + 1
    const lt = anneal ? lambda * (1 + Math.max(0, 1 - t / annealEnd)) : lambda
    const cur = evaluate(rows, Y, stations, E, lt, work)
    const moved = step(rows, Y, cur, stations, E, lt)
    ev = evaluate(rows, Y, stations, E, lambda, ev)
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
  const lambda = Math.max(0.05, params.reachKmS)
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

  // 1. Greedy seed, 2. annealed refinement.
  const cands = makeCandidates(seedRows, E, lambda, rand)
  const seedY = greedySeed(seedRows, cands, stations, E)
  let best = refine(refineRows, seedY, stations, E, lambda, ITERATIONS, true)
  let iterations = best.iterations

  // 3. Relocation: move the weakest station to the best open candidate given
  //    the others, refine, and keep the move if total production rises.
  let relocations = 0
  for (let round = 0; round < Math.min(stations, MAX_RELOCATION_ROUNDS) && stations > 1; round++) {
    const evSeed = evaluate(seedRows, best.Y, stations, E, lambda)
    let weakest = 0
    for (let k = 1; k < stations; k++) if (evSeed.P[k] < evSeed.P[weakest]) weakest = k
    const S = evSeed.S.slice()
    for (let j = 0; j < seedRows.n; j++) S[j] -= evSeed.K[weakest * seedRows.n + j]
    const options = rankCandidates(seedRows, cands, S, E, new Set()).slice(0, RELOCATION_TRIES)
    let improved = false
    for (const { c } of options) {
      const Y = best.Y.slice()
      Y.set(cands.Yc.subarray(c * 3, c * 3 + 3), weakest * 3)
      const trial = refine(refineRows, Y, stations, E, lambda, RELOCATION_ITERATIONS, false)
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
  const seedObjective = evaluate(all, seedY, stations, E, lambda).F
  const fin = evaluate(all, bestY, stations, E, lambda)
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
    const orbit = fromDeltaV(bestY, k * 3)
    out.push({
      ...orbit,
      production: fin.P[k],
      shares,
      tonnes,
      bottleneck,
      overlap: kTotal > 0 ? 1 - uTotal / kTotal : 0,
      bodies: bodiesForHalf(contrib, uTotal),
      suppliers: contrib.slice(0, SUPPLIERS).map((c) => ({
        index: problem.index[all.rows[c.j]],
        share: uTotal > 0 ? c.u / uTotal : 0,
      })),
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
    ms: performance.now() - t0,
  }
}
