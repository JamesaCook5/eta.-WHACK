import type { AsteroidDataset } from './types'

/** "(number) Name", or whichever of the two exists. */
export function asteroidLabel(dataset: AsteroidDataset, index: number) {
  const r = dataset.records[index]
  if (r.number !== null && r.name) return `(${r.number}) ${r.name}`
  return r.name ?? (r.number !== null ? `(${r.number})` : `Record ${index}`)
}
