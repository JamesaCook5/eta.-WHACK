export interface OrbitElements {
  /** Semi-major axis, au. */
  a: number
  e: number
  /** Longitude of perihelion, degrees. */
  varpi: number
}

/** J2000 mean elements (JPL approximate planetary positions). */
export const PLANET_ORBITS: Record<'earth' | 'mars', OrbitElements & { label: string }> = {
  earth: { label: 'Earth', a: 1.00000261, e: 0.01671123, varpi: 102.93768193 },
  mars: { label: 'Mars', a: 1.52371034, e: 0.0933941, varpi: -23.94362959 },
}


/** Ellipse with the Sun at one focus, projected onto the ecliptic plane. */
export function orbitPolyline(orbit: OrbitElements, segments = 256): Float32Array {
  const points = new Float32Array(segments * 2)
  const p = orbit.a * (1 - orbit.e * orbit.e)
  const varpi = (orbit.varpi * Math.PI) / 180
  for (let s = 0; s < segments; s++) {
    const nu = (s / segments) * Math.PI * 2
    const r = p / (1 + orbit.e * Math.cos(nu))
    points[s * 2] = r * Math.cos(nu + varpi)
    points[s * 2 + 1] = r * Math.sin(nu + varpi)
  }
  return points
}
