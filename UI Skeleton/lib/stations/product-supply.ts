/**
 * Product → asteroid supply model, generated from the DAGs by
 * tools/build_product_supply_data.py (repo root). The UI reads it for the
 * product list, groups and labels; the planning itself is done in Python
 * (asteroid_industry/stations.py, see ./api.ts).
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
