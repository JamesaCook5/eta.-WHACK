/**
 * Orbital regions used to choose where a station goes. Each record's
 * `orbit_class` (the SsODNet dynamical class, e.g. "MB>Inner", "NEA>Apollo>PHA")
 * is mapped to one of these, ordered roughly by distance from the Sun.
 */
export const REGIONS = [
  'Near-Earth',
  'Mars-crosser',
  'Hungaria',
  'Inner belt',
  'Phocaea',
  'Middle belt',
  'Outer belt',
  'Cybele / Hilda',
  'Jupiter Trojans',
  'Beyond Jupiter',
] as const

export type Region = (typeof REGIONS)[number]

/** Index into REGIONS, or -1 when the class is missing or unrecognised. */
export function regionIndex(orbitClass: string | null): number {
  if (!orbitClass) return -1
  const c = orbitClass
  const pick = (r: Region) => REGIONS.indexOf(r)
  if (c.startsWith('NEA')) return pick('Near-Earth')
  if (c.startsWith('Mars-Crosser')) return pick('Mars-crosser')
  if (c.startsWith('Hungaria')) return pick('Hungaria')
  if (c.startsWith('MB>Inner')) return pick('Inner belt')
  if (c.startsWith('Phocaea')) return pick('Phocaea')
  if (c.startsWith('MB>Middle')) return pick('Middle belt')
  if (c.startsWith('MB>Outer')) return pick('Outer belt')
  if (c.startsWith('MB>Cybele') || c.startsWith('MB>Hilda')) return pick('Cybele / Hilda')
  if (c.startsWith('Trojan')) return pick('Jupiter Trojans')
  if (c.startsWith('Centaur') || c.startsWith('KBO')) return pick('Beyond Jupiter')
  return -1
}
