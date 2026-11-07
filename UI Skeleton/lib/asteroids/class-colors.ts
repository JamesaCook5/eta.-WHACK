import type { AsteroidDataset } from './types'
import { CLASS_SHADES } from './class-shades'

/**
 * Composition categories. Every asteroid is placed in one of them using its
 * taxonomic class and, where the class allows more than one, its albedo.
 * A class whose members split across categories (e.g. X, CX) appears under
 * each category it has members in.
 *
 * Class letters (Bus-DeMeo / Tholen):
 * - Metallic: M.
 * - Silicates: S, Q, A, K, L, R, O, V, E (E = enstatite).
 * - Carbon: C, B, F, G and the dark primitive types D, P, T, Z.
 * - X: featureless; could be any of the three (Tholen P / M / E by albedo).
 * - U: unclassifiable; ignored when combined with other letters.
 *
 * Keep the rule in asteroidCategory() in sync with
 * scripts/generate_class_shades.py, which generates the shades.
 */
export const CATEGORIES = [
  { id: 'metallic', label: 'Metallic', fallback: '#F08A3A' },
  { id: 'silicate', label: 'Silicates', fallback: '#6CE0A0' },
  { id: 'carbon', label: 'Carbon', fallback: '#2887E8' },
  { id: 'unknown', label: 'Unknown', fallback: '#7A7A7A' },
] as const

export type CategoryId = (typeof CATEGORIES)[number]['id']
export const CATEGORY_IDS: CategoryId[] = CATEGORIES.map((c) => c.id)

const LETTER_CATEGORY: Record<string, CategoryId> = {
  M: 'metallic',
  ...Object.fromEntries([...'SQAKLROVE'].map((l) => [l, 'silicate' as const])),
  ...Object.fromEntries([...'CBFGDPTZ'].map((l) => [l, 'carbon' as const])),
}

/** Albedo thresholds (Tholen's split of the X-complex into P / M / E). */
const DARK_BELOW = 0.1
const BRIGHT_ABOVE = 0.3
const TYPICAL_ALBEDO: Record<Exclude<CategoryId, 'unknown'>, number> = {
  carbon: 0.06,
  metallic: 0.18,
  silicate: 0.25,
}

/** Categories a class label allows, from its capital letters. */
export function candidateCategories(className: string | null | undefined): CategoryId[] {
  if (!className) return []
  const out = new Set<CategoryId>()
  for (const letter of className.replace(/[^A-Z]/g, '')) {
    if (letter === 'X') {
      out.add('carbon').add('metallic').add('silicate')
    } else if (LETTER_CATEGORY[letter]) {
      out.add(LETTER_CATEGORY[letter])
    }
  }
  return [...out]
}

/** One category per asteroid: from the class alone where it is unambiguous, otherwise from albedo. */
export function asteroidCategory(className: string | null | undefined, albedo: number | null): CategoryId {
  const candidates = candidateCategories(className)
  if (candidates.length === 0) return 'unknown'
  if (candidates.length === 1) return candidates[0]
  const capitals = (className ?? '').replace(/[^A-Z]/g, '')
  if (albedo === null || !Number.isFinite(albedo)) {
    // No albedo: fall back to the first letter's category (X alone: carbon, the most common outcome).
    const first = capitals[0]
    return first === 'X' ? 'carbon' : (LETTER_CATEGORY[first] ?? candidates[0])
  }
  let preferred: CategoryId[]
  if (albedo < DARK_BELOW) preferred = ['carbon']
  else if (albedo > BRIGHT_ABOVE) preferred = ['silicate']
  else preferred = capitals === 'X' ? ['metallic'] : ['silicate', 'metallic']
  const hit = preferred.find((c) => candidates.includes(c))
  if (hit) return hit
  return candidates.reduce((best, c) =>
    Math.abs(TYPICAL_ALBEDO[c as keyof typeof TYPICAL_ALBEDO] - albedo) <
    Math.abs(TYPICAL_ALBEDO[best as keyof typeof TYPICAL_ALBEDO] - albedo)
      ? c
      : best,
  )
}

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((c) => c.id === id)!.label
}

/** Shade for a class within a category (e.g. X as Metallic is orange, X as Carbon is blue). */
export function classColor(className: string | null | undefined, category: CategoryId): string {
  const key = `${className ?? 'Unclassified'}|${category}`
  return CLASS_SHADES[key] ?? CATEGORIES.find((c) => c.id === category)!.fallback
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Per-asteroid RGB (0-255), interleaved, for the map's colour attribute. */
export function buildColorBuffer(dataset: AsteroidDataset): Uint8Array {
  const cache = new Map<number, [number, number, number]>()
  const out = new Uint8Array(dataset.count * 3)
  for (let k = 0; k < dataset.count; k++) {
    const key = dataset.taxonomy[k] * CATEGORY_IDS.length + dataset.category[k]
    let rgb = cache.get(key)
    if (!rgb) {
      rgb = hexToRgb(classColor(dataset.classes[dataset.taxonomy[k]], CATEGORY_IDS[dataset.category[k]]))
      cache.set(key, rgb)
    }
    out[k * 3] = rgb[0]
    out[k * 3 + 1] = rgb[1]
    out[k * 3 + 2] = rgb[2]
  }
  return out
}
