'use client'

import { cn } from '@/lib/utils'
import type { StationOverlay } from '@/lib/stations/colors'

/** Top-left key for the station rings, shared by the 2D and 3D maps. */
export function StationKey({ stations, className }: { stations: StationOverlay[]; className?: string }) {
  if (stations.length === 0) return null
  return (
    <ul
      aria-label="Station orbits"
      className={cn(
        'pointer-events-none absolute top-8 left-3 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-x-3 gap-y-1 rounded-md bg-[#070707]/80 px-2.5 py-1.5 font-mono text-[11px] text-white/80',
        className,
      )}
    >
      {stations.map((s) => (
        <li key={s.label} className={cn('flex items-center gap-1.5 tabular-nums', s.dim && 'opacity-40')}>
          <span aria-hidden="true" className="size-2 rounded-full ring-1 ring-white/30" style={{ backgroundColor: s.color }} />
          {s.label} · {s.a.toFixed(2)} au
        </li>
      ))}
    </ul>
  )
}
