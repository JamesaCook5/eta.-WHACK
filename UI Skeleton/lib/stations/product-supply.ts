import type { AsteroidDataset } from '@/lib/asteroids/types'
import { REGIONS } from '@/lib/asteroids/regions'
import { CONFIDENCE_KAPPA, toDeltaV, type SamplingModel, type StationProblem } from './optimise'

/**
 * Product → asteroid supply model, generated from the DAGs by
 * tools/build_product_supply_data.py (repo root).
 */
export const PRODUCT_SUPPLY_URL = '/data/product-supply.json'

export interface ProductSupplyModel {
  x_albedo_split: { P_below: number; E_above: number }
  elements: { id: string; label: string }[]
  groups: string[]
  scenarios: Record<
    string,
    {
      density_g_cm3: number
      grade_kg_per_t: Record<string, number>
      /** Base types this scenario blends (weights), for resampling. */
      base: Record<string, number>
      /** False when part of the class is unresolved (X with unknown albedo). */
      resolved: boolean
    }
  >
  /** Per base type: confidence grade and nominal mineral wt%. */
  types: Record<string, { confidence: string; minerals_wt_pct: Record<string, number> }>
  /** Element wt% of each mineral. */
  mineral_yield_wt_pct: Record<string, Record<string, number>>
  h_in_water: number
  externals: Record<string, { label: string; why: string }>
  products: ProductEntry[]
}

export interface ProductEntry {
  id: string
  label: string
  group: string
  processes: number
  feeds: { id: string; label: string; elements: string[] }[]
  elements: string[]
  imported: string[]
}

export async function loadProductSupply(url: string): Promise<ProductSupplyModel> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`)
  return res.json()
}

/**
 * Bodies larger than this are counted as if they were this size: a station can
 * only work so much of one body, and without a cap Ceres-sized bodies would
 * pull every station onto themselves.
 */
export const MINING_DIAMETER_CAP_KM = 100

/** The taxonomy scenario for an asteroid (class, or class@X=P/M/E/? for X-bearing classes). */
export function scenarioKey(model: ProductSupplyModel, className: string | null, albedo: number | null) {
  if (!className) return null
  if (model.scenarios[className]) return className
  const { P_below, E_above } = model.x_albedo_split
  const suffix =
    albedo === null || !Number.isFinite(albedo) ? '?' : albedo < P_below ? 'P' : albedo <= E_above ? 'M' : 'E'
  const key = `${className}@X=${suffix}`
  return model.scenarios[key] ? key : null
}

export interface ElementSummary {
  id: string
  label: string
  /** Bodies in the filtered set with a non-zero grade. */
  carriers: number
  /** Tonnes in the filtered set (bodies counted up to the mining cap). */
  tonnes: number
}

export interface PreparedProblem {
  problem: StationProblem
  /** The product's asteroid-sourced inputs. */
  elements: ElementSummary[]
  /** Label of every tracked element, by id. */
  labels: Record<string, string>
  /** 1 where the row carries at least one of the product's inputs. */
  carries: Uint8Array
}

/** Compile the JSON model into the arrays the optimiser samples from. */
function samplingModel(model: ProductSupplyModel, product: ProductEntry, scenarioKeys: string[]): SamplingModel {
  const elements = model.elements.map((el) => el.id)
  const E = elements.length
  const minerals = Object.keys(model.mineral_yield_wt_pct)
  const M = minerals.length
  const mineralYield = new Float32Array(M * E)
  minerals.forEach((m, mi) => {
    for (const [el, y] of Object.entries(model.mineral_yield_wt_pct[m])) {
      const e = elements.indexOf(el)
      if (e >= 0) mineralYield[mi * E + e] = y / 100
    }
  })
  const typeKeys = Object.keys(model.types)
  const typeMinerals = new Float32Array(typeKeys.length * M)
  const typeKappa = new Float32Array(typeKeys.length)
  typeKeys.forEach((t, ti) => {
    const wt = model.types[t].minerals_wt_pct
    const total = Object.values(wt).reduce((sum, v) => sum + v, 0) || 1
    for (const [m, v] of Object.entries(wt)) {
      const mi = minerals.indexOf(m)
      if (mi >= 0) typeMinerals[ti * M + mi] = v / total
    }
    typeKappa[ti] = CONFIDENCE_KAPPA[model.types[t].confidence] ?? CONFIDENCE_KAPPA.L
  })
  const scenarioGrade = new Float32Array(scenarioKeys.length * E)
  const scenarioBases = scenarioKeys.map((key, si) => {
    const sc = model.scenarios[key]
    elements.forEach((el, e) => (scenarioGrade[si * E + e] = sc.grade_kg_per_t[el] ?? 0))
    const entries = Object.entries(sc.base ?? {}).filter(([b]) => typeKeys.includes(b))
    const total = entries.reduce((sum, [, w]) => sum + w, 0)
    if (!sc.resolved || entries.length === 0 || total <= 0) return { types: [], weights: [] }
    return { types: entries.map(([b]) => typeKeys.indexOf(b)), weights: entries.map(([, w]) => w / total) }
  })
  return {
    elements,
    required: Int32Array.from(product.elements.map((id) => elements.indexOf(id)).filter((e) => e >= 0)),
    hIndex: elements.indexOf('H'),
    waterIndex: elements.indexOf('water'),
    hInWater: model.h_in_water,
    mineralCount: M,
    mineralYield,
    typeCount: typeKeys.length,
    typeMinerals,
    typeKappa,
    scenarioCount: scenarioKeys.length,
    scenarioGrade,
    scenarioBases,
  }
}

/**
 * Build the optimiser's input for one product. Every filtered asteroid is
 * included (k-means assigns all of them); bodies without a usable class or
 * size carry no weight.
 */
export function prepareProblem(
  dataset: AsteroidDataset,
  model: ProductSupplyModel,
  product: ProductEntry,
  mask: Uint8Array,
  /** Include Centaurs and Kuiper-belt objects (far outliers that would each take a station). */
  includeOuter = false,
): PreparedProblem {
  const labels: Record<string, string> = Object.fromEntries(model.elements.map((el) => [el.id, el.label]))
  const scenarioKeys = Object.keys(model.scenarios)
  const scenarioIndex = new Map(scenarioKeys.map((k, i) => [k, i]))
  const req = product.elements
  const carriers = new Int32Array(req.length)
  const tonnes = new Float64Array(req.length)

  const rows: number[] = []
  const outer = REGIONS.indexOf('Beyond Jupiter')
  for (let k = 0; k < dataset.count; k++) {
    if (mask[k] !== 0 && (includeOuter || dataset.region[k] !== outer)) rows.push(k)
  }
  const n = rows.length
  const x = new Float32Array(n * 3)
  const a = new Float32Array(n)
  const phase = new Float32Array(n)
  const mass = new Float32Array(n)
  const scenario = new Int16Array(n).fill(-1)
  const carries = new Uint8Array(n)
  rows.forEach((k, j) => {
    x.set(toDeltaV(dataset.a[k], dataset.e[k], dataset.inclination[k]), j * 3)
    a[j] = dataset.a[k]
    phase[j] = Math.atan2(dataset.positions3[k * 3 + 1], dataset.positions3[k * 3])
    const r = dataset.records[k]
    const key = scenarioKey(model, r.taxonomy_class, r.albedo)
    const D = dataset.diameter[k]
    if (!key || !(D > 0)) return
    const sc = model.scenarios[key]
    scenario[j] = scenarioIndex.get(key)!
    const Dm = Math.min(D, MINING_DIAMETER_CAP_KM)
    mass[j] = (Math.PI / 6) * Dm ** 3 * 1e9 * sc.density_g_cm3
    req.forEach((id, e) => {
      const g = sc.grade_kg_per_t[id] ?? 0
      if (g > 0) {
        carries[j] = 1
        carriers[e]++
        tonnes[e] += (mass[j] * g) / 1000
      }
    })
  })

  return {
    problem: {
      n,
      index: Int32Array.from(rows),
      x,
      a,
      phase,
      mass,
      scenario,
      model: samplingModel(model, product, scenarioKeys),
    },
    elements: req.map((id, e) => ({ id, label: labels[id] ?? id, carriers: carriers[e], tonnes: tonnes[e] })),
    labels,
    carries,
  }
}
