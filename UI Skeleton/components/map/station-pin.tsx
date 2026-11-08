'use client'

import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { StationOverlay } from '@/lib/stations/colors'

interface StationPinProps {
  station: StationOverlay
  /** Pulse briefly when a new plan arrives. */
  fresh: boolean
  onHover: (active: boolean) => void
  onClick: () => void
}

/**
 * A station on the map: subdued neutral marker with its label, a pulse when it is in
 * focus or newly placed, and a detail card on hover. Shared by the 2D and 3D
 * maps; the parent positions it so (0, 0) is the station.
 */
export function StationPin({ station, fresh, onHover, onClick }: StationPinProps) {
  const [hover, setHover] = useState(false)
  // Which side of the pin the card opens on, so it stays inside the map.
  const [side, setSide] = useState<{ x: 'left' | 'right'; y: 'up' | 'down' }>({
    x: 'right',
    y: 'down',
  })
  const ref = useRef<HTMLButtonElement>(null)
  const show = (on: boolean) => {
    if (on && ref.current) {
      const pin = ref.current.getBoundingClientRect()
      const box = ref.current.closest('[data-map-root]')?.getBoundingClientRect()
      if (box) {
        setSide({
          x: box.right - pin.right < 260 ? 'left' : 'right',
          y: box.bottom - pin.bottom < 170 ? 'up' : 'down',
        })
      }
    }
    setHover(on)
    onHover(on)
  }
  const pulse = station.active || (fresh && !station.compact)
  const showLabel = !station.compact || station.active || hover
  const diamond = station.shape === 'diamond'

  return (
    <div className={cn('relative transition-opacity', station.dim && 'opacity-45')}>
      <button
        ref={ref}
        type="button"
        aria-label={`${station.info.title}. ${station.info.lines.join('. ')}`}
        aria-pressed={station.pinned}
        onMouseEnter={() => show(true)}
        onMouseLeave={() => show(false)}
        onFocus={() => show(true)}
        onBlur={() => show(false)}
        onClick={onClick}
        className="group absolute top-0 left-0 flex -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center outline-none"
      >
        <span className={cn('relative flex items-center justify-center', station.compact ? 'size-4' : 'size-6')}>
          {pulse && (
            <span
              aria-hidden="true"
              className={cn('absolute inset-0 rounded-full opacity-70', station.active ? 'animate-ping' : '')}
              style={{
                backgroundColor: station.color,
                opacity: 0.55,
                animation: station.active ? undefined : 'ping 1s cubic-bezier(0, 0, 0.2, 1) 3',
                clipPath: diamond ? 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' : undefined,
              }}
            />
          )}
          <span
            aria-hidden="true"
            className={cn(
              diamond
                ? 'relative rotate-45 rounded-[2px] border border-white/70 shadow-[0_0_0_2px_rgba(0,0,0,0.5)] transition-transform group-focus-visible:ring-2 group-focus-visible:ring-white'
                : 'relative rounded-full border border-white/70 shadow-[0_0_0_2px_rgba(0,0,0,0.5)] transition-transform group-focus-visible:ring-2 group-focus-visible:ring-white',
              station.compact
                ? station.active
                  ? 'size-[14px]'
                  : 'size-2.5 border'
                : station.dim
                  ? 'size-3'
                  : 'size-[18px]',
              (station.active || hover) && 'scale-125',
            )}
            style={{ backgroundColor: station.color }}
          />
        </span>
      </button>
      {showLabel && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-3 -translate-y-1/2 rounded-sm px-1 py-px text-[11px] leading-tight font-semibold text-[#0b0b0b] shadow-[0_0_0_2px_rgba(0,0,0,0.6)]"
          style={{ backgroundColor: station.color }}
        >
          {station.label}
        </span>
      )}
      {hover && (
        <div
          role="tooltip"
          className={cn(
            'pointer-events-none absolute z-20 w-60 rounded-md border-l-2 bg-[#101010]/95 px-3 py-2 text-left shadow-lg',
            side.x === 'right' ? 'left-3' : 'right-3',
            side.y === 'down' ? 'top-4' : 'bottom-4',
          )}
          style={{ borderColor: '#777777' }}
        >
          <p className="text-xs text-white">{station.info.title}</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-[11px] text-white tabular-nums">
            {station.info.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
