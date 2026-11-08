'use client'

import { useMemo } from 'react'
import type { AsteroidDataset } from '@/lib/asteroids/types'
import { CATEGORIES, CATEGORY_IDS, classColor } from '@/lib/asteroids/class-colors'

/** Bottom-left legend: each composition category with its most common shades. Used by the 2D and 3D maps. */
export function MapLegend({ dataset }: { dataset: AsteroidDataset }) {
  const legend = useMemo(
    () =>
      CATEGORIES.map((cat, ci) => {
        const counts = new Map<number, number>()
        for (let k = 0; k < dataset.count; k++) {
          if (dataset.category[k] === ci) counts.set(dataset.taxonomy[k], (counts.get(dataset.taxonomy[k]) ?? 0) + 1)
        }
        const shades = [...counts.entries()]
          .sort((x, y) => y[1] - x[1])
          .slice(0, 4)
          .map(([classIndex]) => classColor(dataset.classes[classIndex], CATEGORY_IDS[ci]))
        return { id: cat.id, label: cat.label, shades }
      }).filter((entry) => entry.shades.length > 0),
    [dataset],
  )

  return (
    <ul
      aria-label="Composition colours"
      className="pointer-events-none absolute bottom-3 left-3 flex max-w-[calc(100%-8.5rem)] flex-wrap gap-x-3 gap-y-1 rounded-md bg-[#070707]/80 px-2.5 py-1.5 text-[11px] text-white"
    >
      {legend.map((entry) => (
        <li key={entry.id} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="flex -space-x-0.5">
            {entry.shades.map((colour, i) => (
              <span key={i} className="size-2 rounded-full" style={{ backgroundColor: colour }} />
            ))}
          </span>
          {entry.label}
        </li>
      ))}
    </ul>
  )
}
