'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { AsteroidDataset } from '@/lib/asteroids/types'
import { buildColorBuffer } from '@/lib/asteroids/class-colors'
import { PLANET_ORBITS, orbitPolyline } from '@/lib/mission/bodies'
import { cn } from '@/lib/utils'
import { asteroidLabel } from '@/lib/asteroids/label'
import type { StationOverlay } from '@/lib/stations/colors'
import { MapLegend } from './map-legend'
import { StationKey } from './station-key'
import { StationPin } from './station-pin'

/**
 * 3D map (React Three Fiber). Heliocentric ecliptic coordinates, z up.
 *
 * "Compressed" scale keeps each asteroid's direction from the Sun but draws its
 * distance as r^0.5 (1 au stays at 1), so the inner planets, the belt and the
 * Jupiter Trojans fit in one view without zooming out. "Linear" draws true au.
 */
export type DistanceScale = 'compressed' | 'linear'
const COMPRESSION_EXPONENT = 0.5
const PICK_RADIUS_PX = 9
const FLY_RATE = 6 // higher = faster camera moves

/** The parts of drei's OrbitControls the camera rig uses. */
type OrbitControlsLike = { target: THREE.Vector3; update: () => void }

function scaledRadius(r: number, mode: DistanceScale) {
  return mode === 'linear' ? r : Math.pow(r, COMPRESSION_EXPONENT)
}

/** Apply the distance scale to interleaved x, y, z positions (au). */
function scalePositions(src: Float32Array, mode: DistanceScale): Float32Array {
  if (mode === 'linear') return src
  const out = new Float32Array(src.length)
  for (let k = 0; k < src.length; k += 3) {
    const x = src[k], y = src[k + 1], z = src[k + 2]
    const r = Math.hypot(x, y, z)
    const f = r > 0 ? scaledRadius(r, mode) / r : 0
    out[k] = x * f
    out[k + 1] = y * f
    out[k + 2] = z * f
  }
  return out
}

/**
 * Camera start position for each scale: looking at the Sun from above and to the side.
 * Narrow (portrait) views step back further so the whole belt still fits across.
 */
function homeCamera(mode: DistanceScale, aspect = 1.4, extent = 0) {
  // extent: largest scaled radius that must fit (e.g. a station at the Jupiter Trojans).
  const fits = mode === 'linear' ? 3.6 : 1.9
  const d = (mode === 'linear' ? 9.5 : 5.2) * Math.max(1, 0.9 / aspect) * Math.max(1, extent / fits)
  return new THREE.Vector3(0, -d * 0.78, d * 0.62)
}

// ---------------------------------------------------------------- shaders

const POINT_VERT = /* glsl */ `
attribute float aState;
attribute vec3 aColor;
uniform float uSize;
uniform float uPixelRatio;
varying vec4 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // Mild size attenuation gives a sense of depth; clamped so far points stay visible.
  float s = uSize * uPixelRatio * (5.0 / max(-mv.z, 0.05));
  gl_PointSize = clamp(s, 1.6 * uPixelRatio, 7.0 * uPixelRatio);
  vColor = vec4(aColor, aState > 0.5 ? 0.8 : 0.08);
}`

const POINT_FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * (1.0 - smoothstep(0.4, 0.5, d)));
}`

const MARK_VERT = /* glsl */ `
uniform float uSize;
uniform float uPixelRatio;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * uPixelRatio;
}`

const MARK_FRAG = /* glsl */ `
uniform float uRing;
uniform vec3 uColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = 1.0 - smoothstep(0.44, 0.5, d);
  if (uRing > 0.5) a *= smoothstep(0.3, 0.36, d); // hollow ring for a station's suppliers
  if (a <= 0.0) discard;
  gl_FragColor = vec4(uColor, a);
}`

// ---------------------------------------------------------------- scene parts

function AsteroidPoints({
  positions,
  colors,
  mask,
}: {
  positions: Float32Array
  colors: Uint8Array
  mask: Uint8Array | null
}) {
  const invalidate = useThree((s) => s.invalidate)
  const dpr = useThree((s) => s.viewport.dpr)
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('aColor', new THREE.BufferAttribute(new Uint8Array(positions.length), 3, true))
    g.setAttribute('aState', new THREE.BufferAttribute(new Float32Array(positions.length / 3).fill(1), 1))
    g.computeBoundingSphere()
    return g
  }, [positions])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: POINT_VERT,
        fragmentShader: POINT_FRAG,
        uniforms: { uSize: { value: 2.2 }, uPixelRatio: { value: 1 } },
        transparent: true,
        depthWrite: false,
      }),
    [],
  )

  useEffect(() => {
    material.uniforms.uPixelRatio.value = dpr
    invalidate()
  }, [dpr, material, invalidate])

  // Colours change with the station plan and focus; update them in place.
  useEffect(() => {
    const attr = geometry.getAttribute('aColor') as THREE.BufferAttribute
    if (colors.length === attr.array.length) (attr.array as Uint8Array).set(colors)
    attr.needsUpdate = true
    invalidate()
  }, [colors, geometry, invalidate])

  useEffect(() => {
    const state = geometry.getAttribute('aState') as THREE.BufferAttribute
    const arr = state.array as Float32Array
    if (mask && mask.length === arr.length) for (let k = 0; k < arr.length; k++) arr[k] = mask[k]
    else arr.fill(1)
    state.needsUpdate = true
    invalidate()
  }, [mask, geometry, invalidate])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  return <points geometry={geometry} material={material} frustumCulled={false} />
}

function Markers({
  positions,
  indices,
  size,
  ring,
  color = '#ffffff',
  order = 2,
}: {
  positions: Float32Array
  indices: number[]
  size: number
  ring: boolean
  color?: string
  order?: number
}) {
  const dpr = useThree((s) => s.viewport.dpr)
  const geometry = useMemo(() => {
    const data = new Float32Array(indices.length * 3)
    indices.forEach((i, k) => data.set(positions.subarray(i * 3, i * 3 + 3), k * 3))
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(data, 3))
    return g
  }, [positions, indices])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: MARK_VERT,
        fragmentShader: MARK_FRAG,
        uniforms: {
          uSize: { value: size },
          uPixelRatio: { value: dpr },
          uRing: { value: ring ? 1 : 0 },
          uColor: { value: new THREE.Color(color) },
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    [size, dpr, ring, color],
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  if (indices.length === 0) return null
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={order} />
}

/** Scale a heliocentric point (au) with the distance scale. */
function scalePoint([x, y, z]: [number, number, number], mode: DistanceScale): [number, number, number] {
  const r = Math.hypot(x, y, z)
  const f = r > 0 ? scaledRadius(r, mode) / r : 0
  return [x * f, y * f, z * f]
}

/** Where each station landed in the Monte Carlo draws: faint dots in its colour. */
function MonteCarloCloud({ stations, mode }: { stations: StationOverlay[]; mode: DistanceScale }) {
  const clouds = useMemo(
    () =>
      stations
        .filter((s) => s.cloud && !s.dim)
        .map((s) => {
          const xy = s.cloud!
          const pts = new Float32Array((xy.length / 2) * 3)
          for (let d = 0; d < xy.length / 2; d++) {
            const [x, y] = scalePoint([xy[d * 2], xy[d * 2 + 1], 0], mode)
            pts[d * 3] = x
            pts[d * 3 + 1] = y
          }
          return { s, pts, indices: Array.from({ length: xy.length / 2 }, (_, i) => i) }
        }),
    [stations, mode],
  )
  return (
    <>
      {clouds.map(({ s, pts, indices }) => (
        <Markers key={s.label} positions={pts} indices={indices} size={4} ring={false} color={s.color} order={3} />
      ))}
    </>
  )
}

/**
 * Moves the station pins (plain DOM over the canvas) to their projected screen
 * positions on every rendered frame; pins behind the camera are hidden.
 */
function PinProjector({ points, pins }: { points: [number, number, number][]; pins: React.RefObject<(HTMLDivElement | null)[]> }) {
  const invalidate = useThree((s) => s.invalidate)
  const v = useMemo(() => new THREE.Vector3(), [])
  useEffect(() => invalidate(), [points, invalidate])
  useFrame(({ camera, size }) => {
    points.forEach((p, k) => {
      const el = pins.current[k]
      if (!el) return
      v.set(p[0], p[1], p[2]).project(camera)
      const visible = v.z < 1
      el.style.visibility = visible ? 'visible' : 'hidden'
      el.style.transform = `translate(${(v.x * 0.5 + 0.5) * size.width}px, ${(0.5 - v.y * 0.5) * size.height}px)`
    })
  })
  return null
}

function Orbits({ mode, stations }: { mode: DistanceScale; stations: StationOverlay[] }) {
  const lines = useMemo(
    () =>
      [PLANET_ORBITS.earth, PLANET_ORBITS.mars].map((orbit) => {
        const flat = orbitPolyline(orbit, 256)
        const pts: [number, number, number][] = []
        for (let k = 0; k < flat.length; k += 2) {
          const x = flat[k], y = flat[k + 1]
          const r = Math.hypot(x, y)
          const f = scaledRadius(r, mode) / r
          pts.push([x * f, y * f, 0])
        }
        pts.push(pts[0])
        return pts
      }),
    [mode],
  )
  // Station orbits: a ring of radius a in the ecliptic.
  const rings = useMemo(
    () =>
      stations.map((s) => {
        const r = scaledRadius(s.a, mode)
        const pts: [number, number, number][] = []
        for (let k = 0; k <= 256; k++) {
          const t = (k / 256) * Math.PI * 2
          pts.push([r * Math.cos(t), r * Math.sin(t), 0])
        }
        return {
          key: s.label,
          color: s.color,
          pts,
          dim: s.dim,
        }
      }),
    [stations, mode],
  )
  return (
    <>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color="white" transparent opacity={0.35} lineWidth={1} />
      ))}
      {rings.map((ring) => (
        <group key={ring.key}>
          <Line
            points={ring.pts}
            color={ring.color}
            lineWidth={ring.dim ? 1 : 1.5}
            transparent
            opacity={ring.dim ? 0.2 : 0.6}
            dashed
            dashSize={0.05}
            gapSize={0.03}
            depthTest={false}
            renderOrder={3}
          />
        </group>
      ))}
    </>
  )
}

/** Screen-space picking: project every asteroid and take the nearest within PICK_RADIUS_PX. */
function Picker({
  positions,
  onHover,
  onSelect,
}: {
  positions: Float32Array
  onHover: (index: number, x: number, y: number) => void
  onSelect: (index: number) => void
}) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const controls = useThree((s) => s.controls) as unknown as THREE.EventDispatcher<{ change: object }> | null

  // Anything under the cursor changes when the camera moves, so drop the hover.
  useEffect(() => {
    if (!controls) return
    let hovering = false
    const onChange = () => {
      if (hovering) onHover(-1, 0, 0)
      hovering = false
    }
    const mark = () => (hovering = true)
    controls.addEventListener('change', onChange)
    gl.domElement.addEventListener('pointermove', mark)
    return () => {
      controls.removeEventListener('change', onChange)
      gl.domElement.removeEventListener('pointermove', mark)
    }
  }, [controls, gl, onHover])

  useEffect(() => {
    const el = gl.domElement
    const m = new THREE.Matrix4()
    let down: { x: number; y: number } | null = null
    let frame = 0
    let pending: { x: number; y: number } | null = null

    const pick = (sx: number, sy: number) => {
      m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      const e = m.elements
      const w = size.width
      const h = size.height
      let best = -1
      let bestD = PICK_RADIUS_PX * PICK_RADIUS_PX
      for (let k = 0, n = positions.length; k < n; k += 3) {
        const x = positions[k], y = positions[k + 1], z = positions[k + 2]
        const cw = e[3] * x + e[7] * y + e[11] * z + e[15]
        if (cw <= 0) continue
        const px = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / cw * 0.5 + 0.5) * w
        const py = (0.5 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw * 0.5) * h
        const d = (px - sx) ** 2 + (py - sy) ** 2
        if (d < bestD) {
          bestD = d
          best = k / 3
        }
      }
      return best
    }

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerType !== 'mouse') return
      if (ev.buttons !== 0) {
        onHover(-1, 0, 0)
        return
      }
      pending = { x: ev.offsetX, y: ev.offsetY }
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (pending) onHover(pick(pending.x, pending.y), pending.x, pending.y)
      })
    }
    const onDown = (ev: PointerEvent) => {
      down = { x: ev.offsetX, y: ev.offsetY }
    }
    const onUp = (ev: PointerEvent) => {
      if (down && Math.hypot(ev.offsetX - down.x, ev.offsetY - down.y) < 5) onSelect(pick(ev.offsetX, ev.offsetY))
      down = null
    }
    const onLeave = () => onHover(-1, 0, 0)

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [camera, gl, size, positions, onHover, onSelect])

  return null
}

export interface CameraRig {
  /** Move the orbit centre to `target`, keeping the current viewing angle and distance. */
  focus: (target: THREE.Vector3) => void
  /** Return to the starting view around the Sun. */
  home: () => void
  /** Move the camera towards (factor < 1) or away from (factor > 1) the orbit centre. */
  dolly: (factor: number) => void
}

/** Smooth camera moves for focus/home, driven by the render loop only while moving. */
function Rig({ mode, extent, rigRef }: { mode: DistanceScale; extent: number; rigRef: React.RefObject<CameraRig | null> }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsLike | null
  const invalidate = useThree((s) => s.invalidate)
  const aspect = useThree((s) => s.size.width / Math.max(s.size.height, 1))
  const goal = useRef<{ target: THREE.Vector3; camera: THREE.Vector3 | null } | null>(null)

  useEffect(() => {
    rigRef.current = {
      focus: (target) => {
        goal.current = { target: target.clone(), camera: null }
        invalidate()
      },
      home: () => {
        goal.current = { target: new THREE.Vector3(), camera: homeCamera(mode, aspect, extent) }
        invalidate()
      },
      dolly: (factor) => {
        if (!controls) return
        const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor)
        if (offset.length() < 0.02 || offset.length() > 80) return
        goal.current = { target: controls.target.clone(), camera: controls.target.clone().add(offset) }
        invalidate()
      },
    }
  }, [camera, controls, invalidate, mode, aspect, extent, rigRef])

  // First frame with controls: place the camera at the home view for this canvas's shape.
  const placed = useRef(false)
  useEffect(() => {
    if (!controls || placed.current) return
    placed.current = true
    camera.position.copy(homeCamera(mode, aspect, extent))
    controls.target.set(0, 0, 0)
    controls.update()
    invalidate()
  }, [controls, camera, mode, aspect, extent, invalidate])

  useFrame((_, dt) => {
    const g = goal.current
    if (!g || !controls) return
    const t = 1 - Math.exp(-dt * FLY_RATE)
    const prevTarget = controls.target.clone()
    controls.target.lerp(g.target, t)
    if (g.camera) camera.position.lerp(g.camera, t)
    else camera.position.add(controls.target.clone().sub(prevTarget)) // keep angle and distance
    controls.update()
    const done =
      controls.target.distanceTo(g.target) < 1e-4 && (!g.camera || camera.position.distanceTo(g.camera) < 1e-3)
    if (done) goal.current = null
    else invalidate()
  })

  return null
}

// ---------------------------------------------------------------- component

interface Map3DProps {
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

export function Map3D({
  dataset,
  mask,
  stations,
  colors: colorOverride,
  freshStations,
  onStationHover,
  onStationClick,
  hovered,
  selected,
  onHover,
  onSelect,
  emptyMessage,
}: Map3DProps) {
  const [mode, setMode] = useState<DistanceScale>('compressed')
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null)
  const rigRef = useRef<CameraRig | null>(null)
  const callbacks = useRef({ onHover, onSelect })
  callbacks.current = { onHover, onSelect }

  const positions = useMemo(() => (dataset ? scalePositions(dataset.positions3, mode) : null), [dataset, mode])
  const baseColors = useMemo(() => (dataset ? buildColorBuffer(dataset) : null), [dataset])
  const colors = colorOverride ?? baseColors
  const hoverSelected = useMemo(() => [hovered, selected].filter((i) => i >= 0), [hovered, selected])

  // Fly to the selected asteroid, whether it was picked on the map or in the candidates list.
  useEffect(() => {
    if (!positions || selected < 0) return
    rigRef.current?.focus(new THREE.Vector3(positions[selected * 3], positions[selected * 3 + 1], positions[selected * 3 + 2]))
  }, [selected, positions])

  // Station pins live outside the canvas; PinProjector keeps them on their stations.
  const pinRefs = useRef<(HTMLDivElement | null)[]>([])
  const pinPoints = useMemo(() => stations.map((s) => scalePoint(s.position, mode)), [stations, mode])

  // Home view also fits every planned station; a new plan zooms out if one would be off screen.
  const stationExtent = useMemo(
    () => Math.max(0, ...stations.map((s) => scaledRadius(Math.hypot(s.position[0], s.position[1]), mode) * 1.1)),
    [stations, mode],
  )
  useEffect(() => {
    if (freshStations && stationExtent > (mode === 'linear' ? 3.6 : 1.9)) {
      // Wait a frame so the rig has the new extent.
      const t = window.setTimeout(() => rigRef.current?.home(), 50)
      return () => window.clearTimeout(t)
    }
  }, [freshStations, stationExtent, mode])

  // Changing the scale changes every distance, so start again from the home view.
  useEffect(() => {
    rigRef.current?.home()
  }, [mode])


  const handlers = useMemo(
    () => ({
      hover: (index: number, x: number, y: number) => {
        callbacks.current.onHover(index)
        setTooltip(index >= 0 ? { x, y } : null)
      },
      select: (index: number) => callbacks.current.onSelect(index),
    }),
    [],
  )

  const onKeyDown = (event: React.KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      '+': () => rigRef.current?.dolly(1 / 1.4),
      '=': () => rigRef.current?.dolly(1 / 1.4),
      '-': () => rigRef.current?.dolly(1.4),
      '0': () => rigRef.current?.home(),
      Escape: () => callbacks.current.onSelect(-1),
    }
    const run = keys[event.key]
    if (run) {
      event.preventDefault()
      run()
    }
  }

  const tooltipLabel = dataset && hovered >= 0 && tooltip ? asteroidLabel(dataset, hovered) : null

  return (
    <div
      data-map-root=""
      className="relative h-full w-full overflow-hidden rounded-md bg-[#070707] focus-visible:outline-offset-[-2px]"
      tabIndex={0}
      role="img"
      aria-label="3D map of the inner solar system: the Sun, the orbits of Earth and Mars, and asteroids in their ecliptic positions. Drag to rotate, right-drag or two fingers to pan, scroll or pinch to zoom, click to select and centre on an asteroid. Plus and minus zoom, 0 resets the view, Escape clears the selection."
      onKeyDown={onKeyDown}
    >
      <Canvas
        className="!absolute inset-0 cursor-crosshair"
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, premultipliedAlpha: true }}
        camera={{ position: homeCamera('compressed').toArray(), up: [0, 0, 1], fov: 45, near: 0.005, far: 500 }}
      >
        {positions && colors && (
          <>
            <AsteroidPoints positions={positions} colors={colors} mask={mask} />
            <MonteCarloCloud stations={stations} mode={mode} />
            <PinProjector points={pinPoints} pins={pinRefs} />
            <Markers positions={positions} indices={hoverSelected} size={8} ring={false} />
            <Picker positions={positions} onHover={handlers.hover} onSelect={handlers.select} />
          </>
        )}
        <Orbits mode={mode} stations={stations} />
        <mesh>
          <sphereGeometry args={[0.025, 16, 16]} />
          <meshBasicMaterial color="white" />
        </mesh>
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} zoomToCursor minDistance={0.02} maxDistance={80} />
        <Rig mode={mode} extent={stationExtent} rigRef={rigRef} />
      </Canvas>

      {tooltipLabel && tooltip && (
        <div
          className="pointer-events-none absolute z-10 rounded-md bg-[#1b1b1b] px-2 py-1 font-mono text-xs whitespace-nowrap text-white"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          {tooltipLabel}
        </div>
      )}

      {emptyMessage && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
          <p className="max-w-sm text-center text-sm leading-relaxed text-white/75">{emptyMessage}</p>
        </div>
      )}

      <p className="pointer-events-none absolute top-3 left-3 max-w-[calc(100%-12rem)] truncate font-mono text-[11px] text-white/55">
        Sun-centred · ecliptic · {mode === 'compressed' ? 'distance shown as √r' : 'true distance (au)'}
      </p>
      <StationKey stations={stations} className="top-11 max-w-[calc(100%-1.5rem)] sm:top-8 sm:max-w-[calc(100%-12rem)]" />
      {stations.map((s, k) => (
        <div
          key={s.label}
          ref={(el) => {
            pinRefs.current[k] = el
          }}
          className="absolute top-0 left-0 z-10"
          style={{ visibility: 'hidden' }}
        >
          <StationPin
            station={s}
            fresh={freshStations}
            onHover={(on) => onStationHover(on ? k : -1)}
            onClick={() => onStationClick(k)}
          />
        </div>
      ))}

      <div className="absolute top-2 right-2 inline-flex gap-1 rounded-md bg-[#070707]/80 p-1" role="group" aria-label="Distance scale">
        {(['compressed', 'linear'] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              'h-7 rounded-md px-2.5 font-mono text-[11px] transition-colors',
              mode === m ? 'bg-white text-[#0e0e0e]' : 'text-white/75 hover:bg-white/10 hover:text-white',
            )}
          >
            {m === 'compressed' ? 'Compressed' : 'Linear'}
          </button>
        ))}
      </div>

      <div className="absolute right-3 bottom-3 flex gap-1">
        {[
          { label: '+', aria: 'Zoom in', run: () => rigRef.current?.dolly(1 / 1.5) },
          { label: '−', aria: 'Zoom out', run: () => rigRef.current?.dolly(1.5) },
          { label: 'Reset', aria: 'Reset view', run: () => rigRef.current?.home() },
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

      {dataset && !colorOverride && <MapLegend dataset={dataset} />}
    </div>
  )
}
