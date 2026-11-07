import { UNCLASSIFIED, type AsteroidDataset, type AsteroidRecord } from './types'
import { REGIONS, regionIndex } from './regions'
import { CATEGORY_IDS, asteroidCategory } from './class-colors'

/** Static, preprocessed subset of the IMCCE SsODNet ssoBFT table. */
export const DATASET_URL = '/data/asteroids.json'

export class DatasetMissingError extends Error {
  constructor(url: string) {
    super(`No dataset found at ${url}`)
    this.name = 'DatasetMissingError'
  }
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function normaliseRecord(raw: Record<string, unknown>): AsteroidRecord | null {
  const x = toNumber(raw.x)
  const y = toNumber(raw.y)
  const z = toNumber(raw.z)
  const a = toNumber(raw.a)
  const e = toNumber(raw.e)
  const i = toNumber(raw.i)
  if (x === null || y === null || z === null || a === null || e === null || i === null) {
    return null
  }
  const taxonomy = typeof raw.taxonomy_class === 'string' ? raw.taxonomy_class.trim() : ''
  return {
    number: toNumber(raw.number),
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : null,
    x,
    y,
    z,
    a,
    e,
    i,
    taxonomy_class: taxonomy.length > 0 ? taxonomy : null,
    diameter_km: toNumber(raw.diameter_km),
    albedo: toNumber(raw.albedo),
    orbit_class: typeof raw.orbit_class === 'string' && raw.orbit_class.length > 0 ? raw.orbit_class : null,
  }
}

export function buildDataset(rawRecords: Record<string, unknown>[]): AsteroidDataset {
  const records: AsteroidRecord[] = []
  for (const raw of rawRecords) {
    const record = normaliseRecord(raw)
    if (record) records.push(record)
  }

  const count = records.length
  const positions = new Float32Array(count * 2)
  const a = new Float32Array(count)
  const e = new Float32Array(count)
  const inclination = new Float32Array(count)
  const diameter = new Float32Array(count)
  const taxonomy = new Uint16Array(count)
  const region = new Uint8Array(count)
  const category = new Uint8Array(count)
  const regionCounts = REGIONS.map(() => 0)

  const classIndex = new Map<string, number>([[UNCLASSIFIED, 0]])
  const classes = [UNCLASSIFIED]
  const classCounts = [0]

  let aMin = Infinity
  let aMax = -Infinity
  let dMin = Infinity
  let dMax = -Infinity
  let iMin = Infinity
  let iMax = -Infinity

  for (let k = 0; k < count; k++) {
    const r = records[k]
    positions[k * 2] = r.x
    positions[k * 2 + 1] = r.y
    a[k] = r.a
    e[k] = r.e
    inclination[k] = r.i
    diameter[k] = r.diameter_km ?? Number.NaN

    const cls = r.taxonomy_class ?? UNCLASSIFIED
    let idx = classIndex.get(cls)
    if (idx === undefined) {
      idx = classes.length
      classIndex.set(cls, idx)
      classes.push(cls)
      classCounts.push(0)
    }
    taxonomy[k] = idx
    classCounts[idx]++

    category[k] = CATEGORY_IDS.indexOf(asteroidCategory(r.taxonomy_class, r.albedo))

    const ri = regionIndex(r.orbit_class)
    region[k] = ri < 0 ? 255 : ri
    if (ri >= 0) regionCounts[ri]++

    if (r.a < aMin) aMin = r.a
    if (r.a > aMax) aMax = r.a
    if (r.i < iMin) iMin = r.i
    if (r.i > iMax) iMax = r.i
    if (r.diameter_km !== null && r.diameter_km > 0) {
      if (r.diameter_km < dMin) dMin = r.diameter_km
      if (r.diameter_km > dMax) dMax = r.diameter_km
    }
  }

  return {
    count,
    records,
    positions,
    a,
    e,
    inclination,
    diameter,
    taxonomy,
    classes,
    classCounts,
    category,
    region,
    regionCounts,
    domains: {
      a: { min: Number.isFinite(aMin) ? aMin : 0, max: Number.isFinite(aMax) ? aMax : 1 },
      diameter: { min: Number.isFinite(dMin) ? dMin : 0.1, max: Number.isFinite(dMax) ? dMax : 1 },
      inclination: { min: Number.isFinite(iMin) ? iMin : 0, max: Number.isFinite(iMax) ? iMax : 1 },
    },
  }
}

export async function loadDataset(url: string = DATASET_URL): Promise<AsteroidDataset> {
  const response = await fetch(url)
  if (response.status === 404) throw new DatasetMissingError(url)
  if (!response.ok) throw new Error(`Dataset request failed with ${response.status}`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) throw new DatasetMissingError(url)

  const body: unknown = await response.json()
  const rows = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray((body as { records?: unknown }).records)
      ? (body as { records: unknown[] }).records
      : null
  if (!rows) throw new Error('Dataset must be an array of records or { records: [...] }')

  return buildDataset(rows as Record<string, unknown>[])
}
