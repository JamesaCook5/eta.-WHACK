/** Hand-picked colours for S1…S8; the map colours every asteroid by its station. */
export const STATION_COLORS = ['#FF5FD2', '#FFE14D', '#B794FF', '#FF6B5E', '#5EF0FF', '#D7FF5A', '#FFA24D', '#4D9DFF'] as const

/** Beyond 8 stations: hues a golden angle apart, alternating lightness, so neighbours in the list differ. */
function generatedColor(k: number) {
  const h = (k * 137.508) % 360
  const s = 0.85
  const l = k % 2 ? 0.62 : 0.72
  const f = (n: number) => {
    const t = (n + h / 30) % 12
    const v = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(t - 3, 9 - t, 1))
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

export function stationColor(k: number) {
  return k < STATION_COLORS.length ? STATION_COLORS[k] : generatedColor(k)
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
  /** Monte Carlo positions of the station, interleaved x, y (au); null until the draws finish. */
  cloud: Float32Array | null
  /** Another station is in focus: draw this one faded. */
  dim: boolean
  /** True for the station in focus (hovered or pinned). */
  active: boolean
  /** Focus is held by a click (until clicked again). */
  pinned: boolean
  /** Many stations on the map: draw a small dot and show the label only on hover or focus. */
  compact: boolean
  /** Hover card: a title line and short detail lines. */
  info: { title: string; lines: string[] }
}
