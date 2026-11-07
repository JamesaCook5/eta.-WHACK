/**
 * PLACEHOLDER MODULE — resource-to-taxonomy mapping.
 *
 * Replace this file with the real mapping. The rest of the app only depends on
 * `RESOURCES`, `ResourceId` and `taxonomyMatchesResource`.
 *
 * The current mapping is a qualitative grouping by the leading letter of the
 * taxonomic class (Tholen / Bus-DeMeo complexes). It carries no yield values.
 */

export const RESOURCES = [
  { id: 'water', label: 'Water / volatiles' },
  { id: 'metals', label: 'Metals' },
  { id: 'silicates', label: 'Silicates' },
] as const

export type ResourceId = (typeof RESOURCES)[number]['id']

const COMPLEXES_BY_RESOURCE: Record<ResourceId, readonly string[]> = {
  water: ['C', 'B', 'D', 'F', 'G', 'P', 'T'],
  metals: ['M', 'X', 'E'],
  silicates: ['S', 'Q', 'V', 'A', 'K', 'L', 'O', 'R'],
}

export function taxonomyMatchesResource(taxonomyClass: string | null, resource: ResourceId): boolean {
  if (!taxonomyClass) return false
  const complex = taxonomyClass.charAt(0).toUpperCase()
  return COMPLEXES_BY_RESOURCE[resource].includes(complex)
}
