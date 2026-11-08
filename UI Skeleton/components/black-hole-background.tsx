'use client'

import { useEffect, useRef } from 'react'
import { BLACK_HOLE_SHADER, VERTEX_SHADER } from '@/lib/space/black-hole'

const FPS = 30
const MIN_SCALE = 0.4
const STILL_TIME = 30 // frame shown when the user prefers reduced motion

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Could not create shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compile failed')
  }
  return shader
}

/** Fixed full-viewport black-hole canvas behind the methodology page. */
export function BlackHoleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
    })
    if (!gl) return // body background colour is the fallback

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const start = performance.now()
    let program: WebGLProgram | null = null
    let uniforms: Record<'uRes' | 'uTime' | 'uScroll', WebGLUniformLocation | null>
    let scale = 0.75
    let raf = 0
    let lastFrame = 0
    let slowFrames = 0

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr * scale))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr * scale))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      gl.viewport(0, 0, w, h)
    }

    const init = () => {
      try {
        const p = gl.createProgram()
        gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER))
        gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, BLACK_HOLE_SHADER))
        gl.linkProgram(p)
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'Link failed')
        program = p
      } catch (err) {
        console.error('[black-hole-background]', err)
        program = null
        return
      }
      gl.useProgram(program)
      uniforms = {
        uRes: gl.getUniformLocation(program, 'uRes'),
        uTime: gl.getUniformLocation(program, 'uTime'),
        uScroll: gl.getUniformLocation(program, 'uScroll'),
      }
      resize()
    }

    const draw = (now: number) => {
      if (!program || gl.isContextLost()) return
      gl.uniform2f(uniforms.uRes, canvas.width, canvas.height)
      gl.uniform1f(uniforms.uTime, reducedMotion.matches ? STILL_TIME : (now - start) / 1000)
      gl.uniform1f(uniforms.uScroll, window.scrollY / Math.max(canvas.clientHeight, 1))
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const elapsed = now - lastFrame
      if (elapsed < 1000 / FPS - 2) return
      // Frames arriving late means the GPU is struggling: render fewer pixels.
      if (lastFrame && elapsed > 1000 / 20) {
        if (++slowFrames > 20 && scale > MIN_SCALE) {
          scale = Math.max(MIN_SCALE, scale * 0.8)
          slowFrames = 0
          resize()
        }
      } else {
        slowFrames = Math.max(0, slowFrames - 1)
      }
      lastFrame = now
      draw(now)
    }

    const stop = () => cancelAnimationFrame(raf)
    const resume = () => {
      stop()
      if (document.hidden || !program) return
      if (reducedMotion.matches) draw(performance.now())
      else {
        lastFrame = 0
        raf = requestAnimationFrame(loop)
      }
    }
    const onScroll = () => reducedMotion.matches && requestAnimationFrame(() => draw(performance.now()))
    const onVisibility = () => (document.hidden ? stop() : resume())
    const onContextLost = (e: Event) => {
      e.preventDefault()
      stop()
      program = null
    }
    const onContextRestored = () => {
      init()
      resume()
    }
    const observer = new ResizeObserver(() => {
      resize()
      if (reducedMotion.matches) draw(performance.now())
    })

    init()
    resume()
    observer.observe(canvas)
    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    reducedMotion.addEventListener('change', resume)
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)
    return () => {
      stop()
      observer.disconnect()
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onVisibility)
      reducedMotion.removeEventListener('change', resume)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-lvh w-full"
    />
  )
}
