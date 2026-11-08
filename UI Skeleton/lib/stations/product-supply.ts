import type { AsteroidDataset } from '@/lib/asteroids/types'
import { toDeltaV, type StationProblem } from './optimise'

/**
 * Product → asteroid supply model, generated from the DAGs by
 * tools/build_product_supply_data.py (repo root).
 */
export const PRODUCT_SUPPLY_URL = '/data/product-supply.json'

export interface ProductSupplyModel {
  x_albedo_split: { P_below: number; E_above: number }
  elements: { id: string; label: string }[]
  groups: string[]
  scenarios: Record<string, { density_g_cm3: number; grade_kg_per_t: Record<string, number> }>
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
 * Bodies larger than this supply at the same rate as one this size: a station
 * mines a body at a finite rate, so supply follows surface area (D²) up to
 * this cap rather than total mass. Keeps Ceres-sized bodies from swamping
 * every product.
 */
export const SUPPLY_DIAMETER_CAP_KM = 100

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
  /** Tonnes in the filtered set. */
  tonnes: number
}

export interface PreparedProblem {
  problem: StationProblem
  elements: ElementSummary[]
}

/** Build the optimiser's input for one product from the filtered asteroids. */
export function prepareProblem(
  dataset: AsteroidDataset,
  model: ProductSupplyModel,
  product: ProductEntry,
  mask: Uint8Array,
): PreparedProblem {
  const ids = product.elements
  const E = ids.length
  const labels = new Map(model.elements.map((el) => [el.id, el.label]))
  const scenarioCache = new Map<string, { density: number; grades: Float64Array } | null>()

  const rows: number[] = []
  const rawSupply: number[] = []
  const rawTonnes: number[] = []
  const totals = new Float64Array(E)
  const tonnesTotal = new Float64Array(E)
  const carriers = new Int32Array(E)

  for (let k = 0; k < dataset.count; k++) {
    if (mask[k] === 0) continue
    const D = dataset.diameter[k]
    if (!(D > 0)) continue
    const r = dataset.records[k]
    const key = scenarioKey(model, r.taxonomy_class, r.albedo)
    if (!key) continue
    let scen = scenarioCache.get(key)
    if (scen === undefined) {
      const s = model.scenarios[key]
      const grades = new Float64Array(E)
      ids.forEach((id, e) => (grades[e] = s.grade_kg_per_t[id] ?? 0))
      scen = grades.some((g) => g > 0) ? { density: s.density_g_cm3, grades } : null
      scenarioCache.set(key, scen)
    }
    if (!scen) continue
    const area = Math.min(D, SUPPLY_DIAMETER_CAP_KM) ** 2
    const massT = (Math.PI / 6) * D ** 3 * 1e9 * scen.density
    rows.push(k)
    for (let e = 0; e < E; e++) {
      const g = scen.grades[e]
      rawSupply.push(area * g)
      rawTonnes.push((massT * g) / 1000)
      totals[e] += area * g
      tonnesTotal[e] += (massT * g) / 1000
      if (g > 0) carriers[e]++
    }
  }

  const n = rows.length
  const x = new Float32Array(n * 3)
  const phase = new Float32Array(n)
  const supply = new Float32Array(n * E)
  const tonnes = Float32Array.from(rawTonnes)
  rows.forEach((k, j) => {
    x.set(toDeltaV(dataset.a[k], dataset.e[k], dataset.inclination[k]), j * 3)
    phase[j] = Math.atan2(dataset.positions3[k * 3 + 1], dataset.positions3[k * 3])
    for (let e = 0; e < E; e++) supply[j * E + e] = totals[e] > 0 ? rawSupply[j * E + e] / totals[e] : 0
  })

  return {
    problem: { elements: ids, n, x, phase, supply, tonnes, index: Int32Array.from(rows) },
    elements: ids.map((id, e) => ({
      id,
      label: labels.get(id) ?? id,
      carriers: carriers[e],
      tonnes: tonnesTotal[e],
    })),
  }
}
