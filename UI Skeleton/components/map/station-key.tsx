'use client'

import { cn } from '@/lib/utils'
import type { StationOverlay } from '@/lib/stations/colors'

/** Top-left key for the station rings, shared by the 2D and 3D maps. */
/** Stations listed in the key; with more, the active one is kept and the rest summarised. */
const KEY_LIMIT = 10

export function StationKey({ stations, className }: { stations: StationOverlay[]; className?: string }) {
  if (stations.length === 0) return null
  const active = stations.find((s) => s.active)
  const listed = stations.length <= KEY_LIMIT ? stations : active ? [active] : stations.slice(0, KEY_LIMIT - 2)
  const hidden = stations.length - listed.length
  return (
    <ul
      aria-label="Station orbits"
      className={cn(
        'pointer-events-none absolute top-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-x-3 gap-y-1 rounded-md bg-[#070707]/80 px-2.5 py-1.5 text-[11px] text-white',
        className,
      )}
    >
      {listed.map((s) => (
        <li key={s.label} className={cn('flex items-center gap-1.5 tabular-nums', s.dim && 'opacity-40')}>
          <span aria-hidden="true" className="size-2 rounded-full ring-1 ring-white/30" style={{ backgroundColor: s.color }} />
          {s.label}, {s.a.toFixed(2)} AU
        </li>
      ))}
      {hidden > 0 && (
        <li className="text-white">
          {active ? `${stations.length} stations` : `and ${hidden} more`}. Hover a pin for details
        </li>
      )}
    </ul>
  )
}
