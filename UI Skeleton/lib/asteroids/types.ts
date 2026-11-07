export interface AsteroidRecord {
  number: number | null
  name: string | null
  x: number
  y: number
  z: number
  a: number
  e: number
  i: number
  taxonomy_class: string | null
  diameter_km: number | null
  albedo: number | null
}

export interface NumericDomain {
  min: number
  max: number
}

/**
 * Column-oriented view of the dataset, built once at load time so filtering,
 * scoring and rendering can iterate typed arrays instead of objects.
 */
export interface AsteroidDataset {
  count: number
  records: AsteroidRecord[]
  /** Interleaved heliocentric x, y in au (top-down projection). */
  positions: Float32Array
  a: Float32Array
  e: Float32Array
  inclination: Float32Array
  /** NaN where the diameter is unknown. */
  diameter: Float32Array
  /** Index into `classes`; 0 is reserved for unclassified records. */
  taxonomy: Uint16Array
  classes: string[]
  classCounts: number[]
  domains: {
    a: NumericDomain
    diameter: NumericDomain
    inclination: NumericDomain
  }
}

export const UNCLASSIFIED = 'Unclassified'
