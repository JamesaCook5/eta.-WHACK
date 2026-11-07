import type { AsteroidDataset } from './types'

/**
 * A range whose ends equal the slider domain is open-ended on that side,
 * so outliers beyond the slider and records with unknown values stay included
 * until the user narrows the range.
 */
export interface RangeFilter {
  domain: [number, number]
  value: [number, number]
}

export interface AsteroidFilters {
  /** Class indices into dataset.classes. Empty means all classes. */
  classes: number[]
  a: RangeFilter
  /** Expressed in log10(km). */
  diameterLog: RangeFilter
  inclination: RangeFilter
}

const A_DOMAIN_CAP = 6
const INCLINATION_DOMAIN_CAP = 60

const roundDown = (v: number, step: number) => Math.floor(v / step) * step
const roundUp = (v: number, step: number) => Math.ceil(v / step) * step

function openRange(min: number, max: number): RangeFilter {
  return { domain: [min, max], value: [min, max] }
}

export function defaultFilters(dataset: AsteroidDataset | null): AsteroidFilters {
  if (!dataset) {
    return {
      classes: [],
      a: openRange(1.5, 5.5),
      diameterLog: openRange(-1, 3),
      inclination: openRange(0, 40),
    }
  }
  const { a, diameter, inclination } = dataset.domains
  const aMin = roundDown(a.min, 0.1)
  const aMax = Math.max(aMin + 0.1, Math.min(roundUp(a.max, 0.1), A_DOMAIN_CAP))
  const dMin = roundDown(Math.log10(diameter.min), 0.1)
  const dMax = Math.max(dMin + 0.1, roundUp(Math.log10(diameter.max), 0.1))
  const iMin = Math.max(0, roundDown(inclination.min, 1))
  const iMax = Math.max(iMin + 1, Math.min(roundUp(inclination.max, 1), INCLINATION_DOMAIN_CAP))
  return {
    classes: [],
    a: openRange(aMin, aMax),
    diameterLog: openRange(dMin, dMax),
    inclination: openRange(iMin, iMax),
  }
}

export function isRangeActive(range: RangeFilter): boolean {
  return range.value[0] > range.domain[0] || range.value[1] < range.domain[1]
}

function bounds(range: RangeFilter): [number, number] {
  const lo = range.value[0] > range.domain[0] ? range.value[0] : -Infinity
  const hi = range.value[1] < range.domain[1] ? range.value[1] : Infinity
  return [lo, hi]
}

/** Returns a per-asteroid mask: 1 passes all filters, 0 is filtered out. */
export function applyFilters(dataset: AsteroidDataset, filters: AsteroidFilters): Uint8Array {
  const mask = new Uint8Array(dataset.count)
  const classSet = filters.classes.length > 0 ? new Set(filters.classes) : null
  const [aLo, aHi] = bounds(filters.a)
  const [iLo, iHi] = bounds(filters.inclination)
  const diameterActive = isRangeActive(filters.diameterLog)
  const [dLogLo, dLogHi] = bounds(filters.diameterLog)
  const dLo = Number.isFinite(dLogLo) ? 10 ** dLogLo : -Infinity
  const dHi = Number.isFinite(dLogHi) ? 10 ** dLogHi : Infinity

  const { a, inclination, diameter, taxonomy } = dataset
  for (let k = 0; k < dataset.count; k++) {
    if (classSet && !classSet.has(taxonomy[k])) continue
    const ak = a[k]
    if (ak < aLo || ak > aHi) continue
    const ik = inclination[k]
    if (ik < iLo || ik > iHi) continue
    if (diameterActive) {
      const dk = diameter[k]
      if (Number.isNaN(dk) || dk < dLo || dk > dHi) continue
    }
    mask[k] = 1
  }
  return mask
}
