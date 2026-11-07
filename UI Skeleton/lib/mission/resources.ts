/**
 * PLACEHOLDER MODULE — resource-to-composition mapping.
 *
 * Replace this file with the real mapping. The rest of the app only depends on
 * `RESOURCES`, `ResourceId` and `categoryMatchesResource`.
 *
 * Each product draws on one composition category. Asteroids get their category
 * from their class and albedo (asteroidCategory in lib/asteroids/class-colors.ts),
 * so e.g. a moderate-albedo X-type counts towards metals. No yield values are used.
 */

import type { CategoryId } from '@/lib/asteroids/class-colors'

export const RESOURCES = [
  { id: 'water', label: 'Water / volatiles' },
  { id: 'metals', label: 'Metals' },
  { id: 'silicates', label: 'Silicates' },
] as const

export type ResourceId = (typeof RESOURCES)[number]['id']

const CATEGORY_BY_RESOURCE: Record<ResourceId, CategoryId> = {
  water: 'carbon',
  metals: 'metallic',
  silicates: 'silicate',
}

export function categoryMatchesResource(category: CategoryId, resource: ResourceId): boolean {
  return CATEGORY_BY_RESOURCE[resource] === category
}
