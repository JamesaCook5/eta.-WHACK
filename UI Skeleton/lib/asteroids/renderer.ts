/** Map view: centre in au, scale in CSS pixels per au. */
export interface MapView {
  cx: number
  cy: number
  scale: number
}

export type RGBA = [number, number, number, number]

export interface OrbitLine {
  points: Float32Array
  color: RGBA
  /** Draw as round dots of this size (CSS px) instead of a thin line. */
  dotSize?: number
  /** Points form a triangle strip (a filled band), drawn under the asteroids. */
  band?: boolean
  /** Points are pairs of line ends (gl.LINES), drawn on top of the asteroids. */
  segments?: boolean
}

/** Asteroids drawn with a ring of one colour (e.g. the suppliers of one station). */
export interface RingGroup {
  indices: number[]
  color: [number, number, number]
}

const POINT_VERT = `#version 300 es
in vec2 aPos;
in float aState;
in vec3 aColor;
uniform vec2 uCenter;
uniform float uScale;
uniform vec2 uViewport;
uniform float uSize;
uniform int uPass;
uniform int uHover;
uniform int uSelected;
uniform vec3 uAccent;
uniform vec3 uRingColor;
out vec4 vColor;
out float vSize;
out float vRing;
void main() {
  vec2 p = (aPos - uCenter) * uScale;
  gl_Position = vec4(p / (uViewport * 0.5), 0.0, 1.0);
  float size;
  vRing = 0.0;
  if (uPass == 0) {
    // Coloured by taxonomic class; filtered-out asteroids stay as a faint trace.
    size = uSize;
    vColor = vec4(aColor, aState > 0.5 ? 0.78 : 0.1);
  } else if (gl_VertexID == uSelected) {
    size = uSize * 3.4;
    vColor = vec4(1.0, 1.0, 1.0, 1.0);
  } else if (gl_VertexID == uHover) {
    size = uSize * 3.0;
    vColor = vec4(1.0, 1.0, 1.0, 1.0);
  } else {
    // Highlighted asteroids (e.g. a station's suppliers): ring around the class-coloured point.
    size = max(uSize * 5.0, 13.0);
    vColor = vec4(uRingColor, 1.0);
    vRing = 1.0;
  }
  gl_PointSize = size;
  vSize = size;
}`

const POINT_FRAG = `#version 300 es
precision mediump float;
in vec4 vColor;
in float vSize;
in float vRing;
out vec4 outColor;
void main() {
  float alpha = vColor.a;
  if (vRing > 0.5) {
    float d = length(gl_PointCoord - 0.5);
    float edge = 1.0 / vSize;
    float inner = 0.5 - 2.4 / vSize;
    alpha *= smoothstep(inner - edge, inner, d) * (1.0 - smoothstep(0.5 - edge, 0.5, d));
    if (alpha <= 0.0) discard;
  } else if (vSize > 3.5) {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    alpha *= 1.0 - smoothstep(0.5 - 1.0 / vSize, 0.5, d);
  }
  outColor = vec4(vColor.rgb, alpha);
}`

const LINE_VERT = `#version 300 es
in vec2 aPos;
uniform vec2 uCenter;
uniform float uScale;
uniform vec2 uViewport;
uniform float uPointSize;
void main() {
  vec2 p = (aPos - uCenter) * uScale;
  gl_Position = vec4(p / (uViewport * 0.5), 0.0, 1.0);
  gl_PointSize = uPointSize;
}`

const LINE_FRAG = `#version 300 es
precision mediump float;
uniform vec4 uColor;
uniform bool uRound;
out vec4 outColor;
void main() {
  if (uRound && length(gl_PointCoord - 0.5) > 0.5) discard;
  outColor = uColor;
}`

const DEFAULT_POINT_COLOR = 0xb0 // grey until class colours are set
const ACCENT_COLOR: [number, number, number] = [0x52 / 255, 0xcb / 255, 0xff / 255]
const PANEL_COLOR: RGBA = [7 / 255, 7 / 255, 7 / 255, 1]

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compile failed')
  }
  return shader
}

function link(gl: WebGL2RenderingContext, vert: string, frag: string) {
  const program = gl.createProgram()!
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vert))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, frag))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'Program link failed')
  }
  return program
}

export class AsteroidRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly pointProgram: WebGLProgram
  private readonly lineProgram: WebGLProgram
  private readonly pointVao: WebGLVertexArrayObject
  private readonly positionBuffer: WebGLBuffer
  private readonly stateBuffer: WebGLBuffer
  private readonly colorBuffer: WebGLBuffer
  private readonly highlightBuffer: WebGLBuffer
  private readonly visibleBuffer: WebGLBuffer
  private readonly lineVao: WebGLVertexArrayObject
  private readonly lineBuffer: WebGLBuffer
  private readonly sunBuffer: WebGLBuffer
  private readonly pointUniforms: Record<string, WebGLUniformLocation | null>
  private readonly lineUniforms: Record<string, WebGLUniformLocation | null>

  private count = 0
  private readonly cullCellAu = 0.25
  private pointGrid = new Map<string, { x: number; y: number; indices: number[] }>()
  private highlightCount = 0
  private ringRanges: { offset: number; count: number; color: [number, number, number] }[] = []
  private hover = -1
  private selected = -1
  private orbits: { offset: number; length: number; color: RGBA; dotSize?: number; band?: boolean; segments?: boolean }[] = []
  private width = 1
  private height = 1
  private dpr = 1

  constructor(canvas: HTMLCanvasElement) {
    // alpha: true so the browser doesn't treat this canvas as an opaque layer that
    // hides the page background canvas. Alpha writes are masked after the clear,
    // so the output stays fully opaque.
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true })
    if (!gl) throw new Error('WebGL2 is not available in this browser')
    this.gl = gl

    this.pointProgram = link(gl, POINT_VERT, POINT_FRAG)
    this.lineProgram = link(gl, LINE_VERT, LINE_FRAG)
    const uniforms = (program: WebGLProgram, names: string[]) =>
      Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)]))
    this.pointUniforms = uniforms(this.pointProgram, [
      'uCenter', 'uScale', 'uViewport', 'uSize', 'uPass', 'uHover', 'uSelected', 'uAccent', 'uRingColor',
    ])
    this.lineUniforms = uniforms(this.lineProgram, [
      'uCenter', 'uScale', 'uViewport', 'uPointSize', 'uColor', 'uRound',
    ])

    this.positionBuffer = gl.createBuffer()!
    this.stateBuffer = gl.createBuffer()!
    this.colorBuffer = gl.createBuffer()!
    this.highlightBuffer = gl.createBuffer()!
    this.visibleBuffer = gl.createBuffer()!
    this.pointVao = gl.createVertexArray()!
    gl.bindVertexArray(this.pointVao)
    const posLoc = gl.getAttribLocation(this.pointProgram, 'aPos')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)
    const stateLoc = gl.getAttribLocation(this.pointProgram, 'aState')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stateBuffer)
    gl.enableVertexAttribArray(stateLoc)
    gl.vertexAttribPointer(stateLoc, 1, gl.UNSIGNED_BYTE, false, 0, 0)
    const colorLoc = gl.getAttribLocation(this.pointProgram, 'aColor')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer)
    gl.enableVertexAttribArray(colorLoc)
    gl.vertexAttribPointer(colorLoc, 3, gl.UNSIGNED_BYTE, true, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.visibleBuffer)
    gl.bindVertexArray(null)

    this.lineBuffer = gl.createBuffer()!
    this.sunBuffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sunBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0]), gl.STATIC_DRAW)
    this.lineVao = gl.createVertexArray()!
  }

  setPositions(positions: Float32Array) {
    const gl = this.gl
    this.count = positions.length / 2
    this.pointGrid.clear()
    for (let i = 0; i < this.count; i++) {
      const x = positions[i * 2], y = positions[i * 2 + 1]
      const cx = Math.floor(x / this.cullCellAu), cy = Math.floor(y / this.cullCellAu)
      const key = `${cx},${cy}`
      let cell = this.pointGrid.get(key)
      if (!cell) this.pointGrid.set(key, (cell = { x: cx, y: cy, indices: [] }))
      cell.indices.push(i)
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    this.setMask(new Uint8Array(this.count).fill(1))
    this.setColors(new Uint8Array(this.count * 3).fill(DEFAULT_POINT_COLOR))
  }

  /** Per-asteroid RGB bytes, interleaved (length = count * 3). */
  setColors(colors: Uint8Array) {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW)
  }

  setMask(mask: Uint8Array) {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stateBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, mask, gl.DYNAMIC_DRAW)
  }

  setHighlights(groups: RingGroup[], hover: number, selected: number) {
    const gl = this.gl
    this.hover = hover
    this.selected = selected
    const indices: number[] = []
    this.ringRanges = []
    for (const group of groups) {
      if (group.indices.length === 0) continue
      this.ringRanges.push({ offset: indices.length, count: group.indices.length, color: group.color })
      indices.push(...group.indices)
    }
    // Hover and selection last so they draw on top; the shader picks them out by index.
    const tail = indices.length
    if (hover >= 0) indices.push(hover)
    if (selected >= 0) indices.push(selected)
    if (indices.length > tail) this.ringRanges.push({ offset: tail, count: indices.length - tail, color: [1, 1, 1] })
    this.highlightCount = indices.length
    gl.bindVertexArray(this.pointVao)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.highlightBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.DYNAMIC_DRAW)
    gl.bindVertexArray(null)
  }

  setOrbits(lines: OrbitLine[]) {
    const gl = this.gl
    const total = lines.reduce((sum, l) => sum + l.points.length, 0)
    const data = new Float32Array(total)
    let offset = 0
    this.orbits = lines.map((l) => {
      data.set(l.points, offset)
      const entry = {
        offset: offset / 2,
        length: l.points.length / 2,
        color: l.color,
        dotSize: l.dotSize,
        band: l.band,
        segments: l.segments,
      }
      offset += l.points.length
      return entry
    })
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
  }

  resize(width: number, height: number, dpr: number) {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.dpr = dpr
    const canvas = this.gl.canvas as HTMLCanvasElement
    canvas.width = Math.round(this.width * dpr)
    canvas.height = Math.round(this.height * dpr)
  }

  draw(view: MapView, pointSizeCss: number) {
    const gl = this.gl
    const vw = gl.canvas.width
    const vh = gl.canvas.height
    const scale = view.scale * this.dpr
    gl.viewport(0, 0, vw, vh)
    gl.colorMask(true, true, true, true)
    gl.clearColor(...PANEL_COLOR)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.colorMask(true, true, true, false)
    gl.enable(gl.BLEND)

    gl.useProgram(this.lineProgram)
    const lu = this.lineUniforms
    gl.uniform2f(lu.uCenter, view.cx, view.cy)
    gl.uniform1f(lu.uScale, scale)
    gl.uniform2f(lu.uViewport, vw, vh)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.bindVertexArray(this.lineVao)
    const lineLoc = gl.getAttribLocation(this.lineProgram, 'aPos')
    gl.enableVertexAttribArray(lineLoc)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer)
    gl.vertexAttribPointer(lineLoc, 2, gl.FLOAT, false, 0, 0)
    // Bands and planet orbits under the asteroids; dotted (station) orbits are drawn on top further down.
    gl.uniform1i(lu.uRound, 0)
    for (const orbit of this.orbits) {
      if (orbit.dotSize || orbit.segments) continue
      gl.uniform4f(lu.uColor, ...orbit.color)
      gl.drawArrays(orbit.band ? gl.TRIANGLE_STRIP : gl.LINE_LOOP, orbit.offset, orbit.length)
    }

    if (this.count > 0) {
      gl.useProgram(this.pointProgram)
      const pu = this.pointUniforms
      gl.uniform2f(pu.uCenter, view.cx, view.cy)
      gl.uniform1f(pu.uScale, scale)
      gl.uniform2f(pu.uViewport, vw, vh)
      gl.uniform1f(pu.uSize, pointSizeCss * this.dpr)
      gl.uniform3f(pu.uAccent, ...ACCENT_COLOR)
      gl.uniform1i(pu.uHover, this.hover)
      gl.uniform1i(pu.uSelected, this.selected)
      gl.bindVertexArray(this.pointVao)

      // Normal blending keeps class colours true where points overlap
      // (additive blending would wash dense regions out to white).
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.uniform1i(pu.uPass, 0)
      const margin = Math.max(2, pointSizeCss * 2) / Math.max(view.scale, 1e-9)
      const halfW = this.width / (2 * view.scale) + margin
      const halfH = this.height / (2 * view.scale) + margin
      const x0 = Math.floor((view.cx - halfW) / this.cullCellAu)
      const x1 = Math.floor((view.cx + halfW) / this.cullCellAu)
      const y0 = Math.floor((view.cy - halfH) / this.cullCellAu)
      const y1 = Math.floor((view.cy + halfH) / this.cullCellAu)
      const cellCount = (x1 - x0 + 1) * (y1 - y0 + 1)
      const visible: number[] = []
      const collect = (cell: { x: number; y: number; indices: number[] }) => {
        const left = cell.x * this.cullCellAu, bottom = cell.y * this.cullCellAu
        if (left > view.cx + halfW || left + this.cullCellAu < view.cx - halfW || bottom > view.cy + halfH || bottom + this.cullCellAu < view.cy - halfH) return
        visible.push(...cell.indices)
      }
      if (cellCount > this.pointGrid.size * 2) {
        for (const cell of this.pointGrid.values()) collect(cell)
      } else {
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          const cell = this.pointGrid.get(`${x},${y}`)
          if (cell) collect(cell)
        }
      }
      if (visible.length < this.count * 0.85) visible.sort((a, b) => a - b)
      if (visible.length < this.count * 0.85) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.visibleBuffer)
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(visible), gl.DYNAMIC_DRAW)
        gl.drawElements(gl.POINTS, visible.length, gl.UNSIGNED_INT, 0)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.highlightBuffer)
      } else {
        gl.drawArrays(gl.POINTS, 0, this.count)
      }

      if (this.highlightCount > 0) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.highlightBuffer)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
        gl.uniform1i(pu.uPass, 1)
        for (const range of this.ringRanges) {
          gl.uniform3f(pu.uRingColor, ...range.color)
          gl.drawElements(gl.POINTS, range.count, gl.UNSIGNED_INT, range.offset * 4)
        }
      }
    }

    gl.useProgram(this.lineProgram)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.bindVertexArray(this.lineVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer)
    gl.vertexAttribPointer(lineLoc, 2, gl.FLOAT, false, 0, 0)
    for (const orbit of this.orbits) {
      if (orbit.segments) {
        gl.uniform1i(lu.uRound, 0)
        gl.uniform4f(lu.uColor, ...orbit.color)
        gl.drawArrays(gl.LINES, orbit.offset, orbit.length)
      } else if (orbit.dotSize) {
        gl.uniform1i(lu.uRound, 1)
        gl.uniform4f(lu.uColor, ...orbit.color)
        gl.uniform1f(lu.uPointSize, orbit.dotSize * this.dpr)
        gl.drawArrays(gl.POINTS, orbit.offset, orbit.length)
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.sunBuffer)
    gl.vertexAttribPointer(lineLoc, 2, gl.FLOAT, false, 0, 0)
    gl.uniform1i(lu.uRound, 1)
    gl.uniform1f(lu.uPointSize, 9 * this.dpr)
    gl.uniform4f(lu.uColor, 1, 1, 1, 1)
    gl.drawArrays(gl.POINTS, 0, 1)
    gl.bindVertexArray(null)
  }

  dispose() {
    const gl = this.gl
    gl.deleteBuffer(this.positionBuffer)
    gl.deleteBuffer(this.stateBuffer)
    gl.deleteBuffer(this.colorBuffer)
    gl.deleteBuffer(this.highlightBuffer)
    gl.deleteBuffer(this.lineBuffer)
    gl.deleteBuffer(this.sunBuffer)
    gl.deleteVertexArray(this.pointVao)
    gl.deleteVertexArray(this.lineVao)
    gl.deleteProgram(this.pointProgram)
    gl.deleteProgram(this.lineProgram)
  }
}
