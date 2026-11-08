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
}
