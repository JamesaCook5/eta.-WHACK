import type { AsteroidDataset } from '@/lib/asteroids/types'

export const MATERIAL_SUPPLY_URL = '/data/material-supply.json'

export interface MaterialRoute {
  id: string
  name: string
  inputs: string[]
  outputs: string[]
  external_inputs: string[]
}

export interface MaterialSupplyModel {
  classes: Record<string, { density_g_cm3: number }>
  scenarios: Record<string, { canonical_code: string | null; mineral_wt_pct: Record<string, number>; coverage_fraction: number }>
  minerals: Record<string, { label: string; source_material_id: string; routes: MaterialRoute[]; downstream_external_inputs: string[] }>
  material_labels: Record<string, string>
  external_materials: Record<string, { label: string; role: string; startup_mass_kg: number | null; makeup_kg_per_tonne_feed: number | null }>
}

export interface MaterialSupplySummary {
  index: number
  tonnes: number
  classCode: string
  orbitAu: number
}

export async function loadMaterialSupply(url = MATERIAL_SUPPLY_URL): Promise<MaterialSupplyModel> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Material supply data request failed with ${response.status}`)
  return response.json() as Promise<MaterialSupplyModel>
}

function classCode(taxonomy: string | null, model: MaterialSupplyModel): string | null {
  if (!taxonomy) return null
  const exact = taxonomy.trim()
  if (model.scenarios[exact]) return exact
  const match = exact.match(/\b([A-Za-z][A-Za-z0-9]*)\b/)
  return match && model.scenarios[match[1]] ? match[1] : null
}

export function estimateFeedstock(
  dataset: AsteroidDataset,
  model: MaterialSupplyModel,
  mineralId: string,
  mask?: Uint8Array | null,
): MaterialSupplySummary[] {
  const out: MaterialSupplySummary[] = []
  for (let index = 0; index < dataset.count; index++) {
    if (mask && !mask[index]) continue
    const record = dataset.records[index]
    const code = classCode(record.taxonomy_class, model)
    const scenario = code ? model.scenarios[code] : null
    const fraction = scenario ? (scenario.mineral_wt_pct[mineralId] ?? 0) / 100 : 0
    const density = (code && model.classes[code]?.density_g_cm3) || 2
    if (!record.diameter_km || record.diameter_km <= 0 || fraction <= 0) continue
    // Bulk density is a class proxy. This estimates raw feedstock mass, not recovered product.
    const tonnes = (Math.PI / 6) * record.diameter_km ** 3 * density * 1e9 * fraction
    out.push({ index, tonnes, classCode: code!, orbitAu: record.a })
  }
  return out
}

