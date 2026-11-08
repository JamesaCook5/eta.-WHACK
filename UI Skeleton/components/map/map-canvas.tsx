'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AsteroidDataset } from '@/lib/asteroids/types'
import { AsteroidRenderer, type MapView, type OrbitLine, type RingGroup } from '@/lib/asteroids/renderer'
import { SpatialIndex } from '@/lib/asteroids/spatial-index'
import { PLANET_ORBITS, orbitPolyline } from '@/lib/mission/bodies'
import { asteroidLabel } from '@/lib/asteroids/label'
import { hexToRgb01, type StationOverlay } from '@/lib/stations/colors'
import { buildColorBuffer } from '@/lib/asteroids/class-colors'
import { MapLegend } from './map-legend'
import { StationKey } from './station-key'
import { StationPin } from './station-pin'

const MIN_SCALE = 15
const MAX_SCALE = 40000
const FIT_RADIUS_AU = 3.8
const PICK_RADIUS_PX = 8

const NO_RINGS: RingGroup[] = []
const PLANET_ORBIT_COLOR: OrbitLine['color'] = [1, 1, 1, 0.4]

/** Circle of radius a (au) in the ecliptic. */
function circle(a: number, segments: number) {
  const points = new Float32Array(segments * 2)
  for (let s = 0; s < segments; s++) {
    const t = (s / segments) * Math.PI * 2
    points[s * 2] = a * Math.cos(t)
    points[s * 2 + 1] = a * Math.sin(t)
  }
  return points
}

const pointSize = (scale: number) => Math.min(7, Math.max(2, 2 * Math.pow(scale / 120, 0.35)))

interface MapCanvasProps {
  dataset: AsteroidDataset | null
  mask: Uint8Array | null
  /** Planned stations: position, orbit ring and Monte Carlo positions. */
  stations: StationOverlay[]
  /** Per-asteroid RGB override (e.g. coloured by station); null for composition colours. */
  colors: Uint8Array | null
  /** Pulse the station markers (a new plan just arrived). */
  freshStations: boolean
  onStationHover: (k: number) => void
  onStationClick: (k: number) => void
  hovered: number
  selected: number
  onHover: (index: number) => void
  onSelect: (index: number) => void
  emptyMessage: string | null
}

export function MapCanvas({
  dataset,
  mask,
  stations,
  colors,
  freshStations,
  onStationHover,
  onStationClick,
  hovered,
  selected,
  onHover,
  onSelect,
  emptyMessage,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<AsteroidRenderer | null>(null)
  const viewRef = useRef<MapView>({ cx: 0, cy: 0, scale: 100 })
  const sizeRef = useRef({ w: 1, h: 1 })
  const fittedRef = useRef(false)
  const frameRef = useRef(0)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const dragRef = useRef({ moved: 0, pinchDist: 0 })
  const maskRef = useRef<Uint8Array | null>(null)
  const hoverRef = useRef(-1)
  const callbacksRef = useRef({ onHover, onSelect })
  callbacksRef.current = { onHover, onSelect }
  maskRef.current = mask

  const [glError, setGlError] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null)
  const index = useMemo(() => (dataset ? new SpatialIndex(dataset.positions) : null), [dataset])
  const indexRef = useRef(index)
  indexRef.current = index

  // Station pins are DOM elements over the canvas; move them with the view.
  const pinRefs = useRef<(HTMLDivElement | null)[]>([])
  const stationsRef = useRef(stations)
  stationsRef.current = stations
  const placePins = () => {
    const { w, h } = sizeRef.current
    const v = viewRef.current
    stationsRef.current.forEach((s, k) => {
      const el = pinRefs.current[k]
      if (!el) return
      const sx = w / 2 + (s.position[0] - v.cx) * v.scale
      const sy = h / 2 - (s.position[1] - v.cy) * v.scale
      el.style.transform = `translate(${sx}px, ${sy}px)`
    })
  }

  const requestDraw = () => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      const view = viewRef.current
      rendererRef.current?.draw(view, pointSize(view.scale))
      placePins()
    })
  }

  const fitView = () => {
    const { w, h } = sizeRef.current
    viewRef.current = { cx: 0, cy: 0, scale: Math.min(w, h) / 2 / FIT_RADIUS_AU }
    requestDraw()
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    let renderer: AsteroidRenderer
    try {
      renderer = new AsteroidRenderer(canvas)
    } catch (err) {
      setGlError(err instanceof Error ? err.message : 'WebGL failed to start')
      return
    }
    rendererRef.current = renderer

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      sizeRef.current = { w: width, h: height }
      renderer.resize(width, height, Math.min(window.devicePixelRatio || 1, 2))
      if (!fittedRef.current && width > 0) {
        fittedRef.current = true
        fitView()
      }
      requestDraw()
    })
    observer.observe(container)

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-event.deltaY * 0.0015))
    }
    // On the container so scrolling over a station pin still zooms the map.
    container.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      observer.disconnect()
      container.removeEventListener('wheel', onWheel)
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
      renderer.dispose()
      rendererRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!dataset || !rendererRef.current) return
    rendererRef.current.setPositions(dataset.positions)
    rendererRef.current.setColors(buildColorBuffer(dataset))
    requestDraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset])

  useEffect(() => {
    if (!mask || !rendererRef.current || !dataset || mask.length !== dataset.count) return
    rendererRef.current.setMask(mask)
    requestDraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mask, dataset])

  useEffect(() => {
    if (!dataset || !rendererRef.current) return
    rendererRef.current.setColors(colors ?? buildColorBuffer(dataset))
    requestDraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors, dataset])

  useEffect(() => {
    rendererRef.current?.setHighlights(NO_RINGS, hovered, selected)
    requestDraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovered, selected, dataset])

  useEffect(() => {
    const lines: OrbitLine[] = [
      { points: orbitPolyline(PLANET_ORBITS.earth), color: PLANET_ORBIT_COLOR },
      { points: orbitPolyline(PLANET_ORBITS.mars), color: PLANET_ORBIT_COLOR },
      // Station orbit (dotted), then where the station landed in each Monte Carlo draw.
      ...stations.map((s) => ({
        points: circle(s.a, Math.round(90 + s.a * 40)),
        color: [...hexToRgb01(s.color), s.dim ? 0.15 : 0.5] as OrbitLine['color'],
        dotSize: s.dim ? 2 : 2.5,
      })),
      ...stations
        .filter((s) => s.cloud && !s.dim)
        .map((s) => ({ points: s.cloud!, color: [...hexToRgb01(s.color), 0.35] as OrbitLine['color'], dotSize: 2.5 })),
    ]
    rendererRef.current?.setOrbits(lines)
    requestDraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations])

  // When a new plan arrives, zoom out if any station or its reach zone is off screen.
  useEffect(() => {
    if (!freshStations || stationsRef.current.length === 0) return
    const { w, h } = sizeRef.current
    const v = viewRef.current
    const off = stationsRef.current.some((s) => {
      const r = s.a
      const sx = w / 2 + (s.position[0] - v.cx) * v.scale
      const sy = h / 2 - (s.position[1] - v.cy) * v.scale
      return sx < 24 || sy < 48 || sx > w - 24 || sy > h - 48 || r * v.scale > Math.max(w, h) * 2
    })
    if (!off) return
    const rMax = Math.max(FIT_RADIUS_AU, ...stationsRef.current.map((s) => Math.hypot(s.position[0], s.position[1]) * 1.12))
    viewRef.current = { cx: 0, cy: 0, scale: Math.min(w, h) / 2 / rMax }
    requestDraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshStations])

  function toWorld(sx: number, sy: number) {
    const { w, h } = sizeRef.current
    const v = viewRef.current
    return { x: v.cx + (sx - w / 2) / v.scale, y: v.cy - (sy - h / 2) / v.scale }
  }

  function zoomAt(sx: number, sy: number, factor: number) {
    const { w, h } = sizeRef.current
    const v = viewRef.current
    const world = toWorld(sx, sy)
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
    viewRef.current = {
      scale,
      cx: world.x - (sx - w / 2) / scale,
      cy: world.y + (sy - h / 2) / scale,
    }
    requestDraw()
  }

  function pan(dx: number, dy: number) {
    const v = viewRef.current
    viewRef.current = { ...v, cx: v.cx - dx / v.scale, cy: v.cy + dy / v.scale }
    requestDraw()
  }

  function pick(sx: number, sy: number) {
    const idx = indexRef.current
    if (!idx) return -1
    const world = toWorld(sx, sy)
    return idx.nearest(world.x, world.y, PICK_RADIUS_PX / viewRef.current.scale)
  }

  function setHover(next: number, sx: number, sy: number) {
    if (next !== hoverRef.current) {
      hoverRef.current = next
      callbacksRef.current.onHover(next)
    }
    setTooltip(next >= 0 ? { x: sx, y: sy } : null)
  }

  const local = (event: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, local(event))
    dragRef.current.moved = 0
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()]
      dragRef.current.pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const p = local(event)
    const pointers = pointersRef.current
    const prev = pointers.get(event.pointerId)
    if (!prev) {
      if (event.pointerType === 'mouse') setHover(pick(p.x, p.y), p.x, p.y)
      return
    }
    pointers.set(event.pointerId, p)
    if (pointers.size === 1) {
      dragRef.current.moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y)
      pan(p.x - prev.x, p.y - prev.y)
      if (dragRef.current.moved > 4) setHover(-1, 0, 0)
    } else if (pointers.size === 2) {
      dragRef.current.moved = Infinity
      const [a, b] = [...pointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (dragRef.current.pinchDist > 0) {
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / dragRef.current.pinchDist)
      }
      dragRef.current.pinchDist = dist
    }
  }

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const pointers = pointersRef.current
    if (!pointers.has(event.pointerId)) return
    pointers.delete(event.pointerId)
    dragRef.current.pinchDist = 0
    if (pointers.size === 0 && dragRef.current.moved <= 4) {
      const p = local(event)
      callbacksRef.current.onSelect(pick(p.x, p.y))
    }
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = 60
    const { w, h } = sizeRef.current
    const handlers: Record<string, () => void> = {
      ArrowLeft: () => pan(step, 0),
      ArrowRight: () => pan(-step, 0),
      ArrowUp: () => pan(0, step),
      ArrowDown: () => pan(0, -step),
      '+': () => zoomAt(w / 2, h / 2, 1.3),
      '=': () => zoomAt(w / 2, h / 2, 1.3),
      '-': () => zoomAt(w / 2, h / 2, 1 / 1.3),
      '0': fitView,
      Escape: () => callbacksRef.current.onSelect(-1),
    }
    const handler = handlers[event.key]
    if (handler) {
      event.preventDefault()
      handler()
    }
  }

  const tooltipLabel = dataset && hovered >= 0 && tooltip ? asteroidLabel(dataset, hovered) : null

  return (
    <div ref={containerRef} data-map-root="" className="relative h-full w-full overflow-hidden rounded-md bg-[#070707]">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label="Top-down map of the inner solar system showing the Sun, the asteroids and the orbits of Earth and Mars. Drag to pan, scroll or pinch to zoom, click to select. Arrow keys pan, plus and minus zoom, 0 resets the view."
        className="absolute inset-0 h-full w-full cursor-crosshair touch-none focus-visible:outline-offset-[-2px]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(e) => {
          if (!pointersRef.current.has(e.pointerId)) setHover(-1, 0, 0)
        }}
        onKeyDown={onKeyDown}
      />

      {tooltipLabel && tooltip && (
        <div
          className="pointer-events-none absolute z-10 rounded-md bg-[#1b1b1b] px-2 py-1 text-xs whitespace-nowrap text-white"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          {tooltipLabel}
        </div>
      )}

      {(glError || emptyMessage) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
          <p className="max-w-sm text-center text-sm leading-relaxed text-white">
            {glError ? `The map needs WebGL2: ${glError}` : emptyMessage}
          </p>
        </div>
      )}

      <div className="absolute right-3 bottom-3 flex gap-1">
        {[
          { label: '+', aria: 'Zoom in', run: () => zoomAt(sizeRef.current.w / 2, sizeRef.current.h / 2, 1.5) },
          { label: '−', aria: 'Zoom out', run: () => zoomAt(sizeRef.current.w / 2, sizeRef.current.h / 2, 1 / 1.5) },
          { label: 'Reset', aria: 'Reset view', run: fitView },
        ].map((b) => (
          <button
            key={b.aria}
            type="button"
            aria-label={b.aria}
            onClick={b.run}
            className="h-8 min-w-8 rounded-md bg-white/10 px-2 text-xs text-white transition-colors hover:bg-white/18 active:bg-white/8"
          >
            {b.label}
          </button>
        ))}
      </div>
      {dataset && !colors && <MapLegend dataset={dataset} />}
      <StationKey stations={stations} />
      {stations.map((s, k) => (
        <div
          key={s.label}
          ref={(el) => {
            pinRefs.current[k] = el
            if (el) placePins()
          }}
          className="absolute top-0 left-0 z-10"
        >
          <StationPin
            station={s}
            fresh={freshStations}
            onHover={(on) => onStationHover(on ? k : -1)}
            onClick={() => onStationClick(k)}
          />
        </div>
      ))}
    </div>
  )
}
