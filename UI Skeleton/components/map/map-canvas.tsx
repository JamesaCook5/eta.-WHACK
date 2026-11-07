'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AsteroidDataset } from '@/lib/asteroids/types'
import { AsteroidRenderer, type MapView, type OrbitLine } from '@/lib/asteroids/renderer'
import { SpatialIndex } from '@/lib/asteroids/spatial-index'
import { PLANET_ORBITS, orbitPolyline } from '@/lib/mission/bodies'
import { asteroidLabel } from './candidates-panel'
import { CATEGORIES, CATEGORY_IDS, buildColorBuffer, classColor } from '@/lib/asteroids/class-colors'

const MIN_SCALE = 15
const MAX_SCALE = 40000
const FIT_RADIUS_AU = 3.8
const PICK_RADIUS_PX = 8

const pointSize = (scale: number) => Math.min(7, Math.max(2, 2 * Math.pow(scale / 120, 0.35)))

interface MapCanvasProps {
  dataset: AsteroidDataset | null
  mask: Uint8Array | null
  candidates: number[]
  hovered: number
  selected: number
  onHover: (index: number) => void
  onSelect: (index: number) => void
  emptyMessage: string | null
}

export function MapCanvas({
  dataset,
  mask,
  candidates,
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

  const requestDraw = () => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      const view = viewRef.current
      rendererRef.current?.draw(view, pointSize(view.scale))
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
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      observer.disconnect()
      canvas.removeEventListener('wheel', onWheel)
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
    rendererRef.current?.setHighlights(candidates, hovered, selected)
    requestDraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, hovered, selected, dataset])

  useEffect(() => {
    const lines: OrbitLine[] = [
      { points: orbitPolyline(PLANET_ORBITS.earth), color: [1, 1, 1, 0.4] },
      { points: orbitPolyline(PLANET_ORBITS.mars), color: [1, 1, 1, 0.4] },
    ]
    rendererRef.current?.setOrbits(lines)
    requestDraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Legend: each category with its most common shades.
  const legend = useMemo(() => {
    if (!dataset) return []
    return CATEGORIES.map((cat, ci) => {
      const counts = new Map<number, number>()
      for (let k = 0; k < dataset.count; k++) {
        if (dataset.category[k] === ci) counts.set(dataset.taxonomy[k], (counts.get(dataset.taxonomy[k]) ?? 0) + 1)
      }
      const shades = [...counts.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 4)
        .map(([classIndex]) => classColor(dataset.classes[classIndex], CATEGORY_IDS[ci]))
      return { id: cat.id, label: cat.label, shades }
    }).filter((entry) => entry.shades.length > 0)
  }, [dataset])

  const tooltipLabel = dataset && hovered >= 0 && tooltip ? asteroidLabel(dataset, hovered) : null

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden rounded-md bg-[#070707]">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label="Top-down map of the inner solar system showing the Sun, the orbits of Earth and Mars, and asteroids. Drag to pan, scroll or pinch to zoom, click to select. Arrow keys pan, plus and minus zoom, 0 resets the view."
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
          className="pointer-events-none absolute z-10 rounded-md bg-[#1b1b1b] px-2 py-1 font-mono text-xs whitespace-nowrap text-white"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          {tooltipLabel}
        </div>
      )}

      {(glError || emptyMessage) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
          <p className="max-w-sm text-center text-sm leading-relaxed text-white/75">
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
            className="h-8 min-w-8 rounded-md bg-white/10 px-2 font-mono text-xs text-white transition-colors hover:bg-white/18 active:bg-white/8"
          >
            {b.label}
          </button>
        ))}
      </div>
      {dataset && (
        <ul
          aria-label="Composition colours"
          className="pointer-events-none absolute bottom-3 left-3 flex max-w-[calc(100%-8.5rem)] flex-wrap gap-x-3 gap-y-1 rounded-md bg-[#070707]/80 px-2.5 py-1.5 font-mono text-[11px] text-white/75"
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
      )}
      <p className="pointer-events-none absolute top-3 left-3 font-mono text-[11px] text-white/55">
        Sun-centred · x–y plane · au
      </p>
    </div>
  )
}
