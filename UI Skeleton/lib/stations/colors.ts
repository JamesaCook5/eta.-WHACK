/** One colour per planned station (S1…S6), chosen to stand apart from the composition colours. */
export const STATION_COLORS = ['#FF5FD2', '#FFE14D', '#B794FF', '#FF6B5E', '#5EF0FF', '#D7FF5A'] as const

export function stationColor(k: number) {
  return STATION_COLORS[k % STATION_COLORS.length]
}

export function hexToRgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** What the maps draw for one planned station. */
export interface StationOverlay {
  label: string
  color: string
  /** Semi-major axis of the station's orbit, au (drawn as a ring in the ecliptic). */
  a: number
  /** Dataset indices of its main suppliers (ringed in the station's colour). */
  suppliers: number[]
  /** Semi-major axes (au) within one reach of the station: drawn as a faint band. */
  band: [number, number]
  /**
   * Where the station marker is drawn, heliocentric ecliptic au. The plan fixes
   * a, e and i but not where along the orbit the station is, so the marker sits
   * on the ring beside the station's largest supplier.
   */
  marker: [number, number, number]
  /** Another station is in focus: draw this one faded, without its suppliers. */
  dim: boolean
}

const V_EARTH_KMS = 29.78

/** a-range within reach λ (km/s) of a circular orbit at a, using the δa/a term of the Δv metric. */
export function reachBand(a: number, reachKmS: number): [number, number] {
  const v = V_EARTH_KMS / Math.sqrt(a)
  const d = reachKmS / (v * Math.sqrt(1.25))
  return [a * Math.exp(-d), a * Math.exp(d)]
}
