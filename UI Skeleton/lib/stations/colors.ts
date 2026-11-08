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
  /** Where the station is at the dataset epoch: heliocentric ecliptic au, on its ring. */
  position: [number, number, number]
  /**
   * One-reach zone: the semi-major axes and longitudes (radians) a station can
   * reach for Δv ≤ its reach. Drawn as a shaded sector around the station.
   */
  zone: { aMin: number; aMax: number; start: number; end: number }
  /** Dataset indices of its main suppliers (ringed in the station's colour, linked to the station). */
  suppliers: number[]
  /** Another station is in focus: draw this one faded, without its suppliers. */
  dim: boolean
  /** True for the station in focus (hovered or pinned). */
  active: boolean
  /** Focus is held by a click (until clicked again). */
  pinned: boolean
  /** Hover card: a title line and short detail lines. */
  info: { title: string; lines: string[] }
}
