'use client'

import { useEffect, useRef } from 'react'
import { FRAGMENT_SHADER, VERTEX_SHADER, asteroidPlacement } from '@/lib/space/shader'

const FPS = 30
const MIN_SCALE = 0.4
// Fixed time used when the user prefers reduced motion.
const STILL_TIME = 40

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

function createProgram(gl: WebGL2RenderingContext) {
  const program = gl.createProgram()
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'Program link failed')
  }
  return program
}

/**
 * Fixed full-viewport canvas behind the page. The scene scrolls with the page
 * through the uScroll uniform, so the canvas itself never moves.
 */
export function SpaceBackground() {
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
    let uniforms: Record<'uRes' | 'uTime' | 'uScroll' | 'uAst', WebGLUniformLocation | null>
    let scale = 0.75 // render resolution relative to CSS pixels
    let raf = 0
    let lastFrame = 0
    let slowFrames = 0

    const init = () => {
      try {
        program = createProgram(gl)
      } catch (err) {
        console.error('[space-background]', err)
        program = null
        return
      }
      gl.useProgram(program)
      uniforms = {
        uRes: gl.getUniformLocation(program, 'uRes'),
        uTime: gl.getUniformLocation(program, 'uTime'),
        uScroll: gl.getUniformLocation(program, 'uScroll'),
        uAst: gl.getUniformLocation(program, 'uAst'),
      }
      resize()
    }

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

    const draw = (now: number) => {
      if (!program || gl.isContextLost()) return
      const time = reducedMotion.matches ? STILL_TIME : (now - start) / 1000
      gl.uniform2f(uniforms.uRes, canvas.width, canvas.height)
      gl.uniform1f(uniforms.uTime, time)
      gl.uniform1f(uniforms.uScroll, window.scrollY / Math.max(canvas.clientHeight, 1))
      gl.uniform3f(uniforms.uAst, ...asteroidPlacement(canvas.clientWidth, canvas.clientHeight))
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const elapsed = now - lastFrame
      if (elapsed < 1000 / FPS - 2) return
      // If frames keep arriving late, the GPU is struggling: render fewer pixels.
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

    const resume = () => {
      cancelAnimationFrame(raf)
      if (document.hidden || !program) return
      if (reducedMotion.matches) {
        draw(performance.now())
      } else {
        lastFrame = 0
        raf = requestAnimationFrame(loop)
      }
    }
    const stop = () => cancelAnimationFrame(raf)

    // With reduced motion there is no loop, so redraw on scroll instead.
    let scrollQueued = false
    const onScroll = () => {
      if (!reducedMotion.matches || scrollQueued) return
      scrollQueued = true
      requestAnimationFrame(() => {
        scrollQueued = false
        draw(performance.now())
      })
    }
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
    const resizeObserver = new ResizeObserver(() => {
      resize()
      if (reducedMotion.matches) draw(performance.now())
    })

    init()
    resume()
    resizeObserver.observe(canvas)
    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    reducedMotion.addEventListener('change', resume)
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)

    return () => {
      stop()
      resizeObserver.disconnect()
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
