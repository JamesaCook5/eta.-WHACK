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
}

const POINT_VERT = `#version 300 es
in vec2 aPos;
in float aState;
uniform vec2 uCenter;
uniform float uScale;
uniform vec2 uViewport;
uniform float uSize;
uniform int uPass;
uniform int uHover;
uniform int uSelected;
uniform vec3 uBase;
uniform vec3 uAccent;
out vec4 vColor;
out float vSize;
void main() {
  vec2 p = (aPos - uCenter) * uScale;
  gl_Position = vec4(p / (uViewport * 0.5), 0.0, 1.0);
  float size;
  if (uPass == 0) {
    size = uSize;
    vColor = vec4(uBase, aState > 0.5 ? 0.8 : 0.15);
  } else if (gl_VertexID == uSelected) {
    size = uSize * 3.2;
    vColor = vec4(uAccent, 1.0);
  } else if (gl_VertexID == uHover) {
    size = uSize * 3.0;
    vColor = vec4(1.0, 1.0, 1.0, 1.0);
  } else {
    size = uSize * 2.2;
    vColor = vec4(uAccent, 1.0);
  }
  gl_PointSize = size;
  vSize = size;
}`

const POINT_FRAG = `#version 300 es
precision mediump float;
in vec4 vColor;
in float vSize;
out vec4 outColor;
void main() {
  float alpha = vColor.a;
  if (vSize > 3.5) {
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

const BASE_COLOR: [number, number, number] = [0xe8 / 255, 0xe8 / 255, 0xe8 / 255]
const ACCENT_COLOR: [number, number, number] = [1, 0xb5 / 255, 0x47 / 255]
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
  private readonly highlightBuffer: WebGLBuffer
  private readonly lineVao: WebGLVertexArrayObject
  private readonly lineBuffer: WebGLBuffer
  private readonly sunBuffer: WebGLBuffer
  private readonly pointUniforms: Record<string, WebGLUniformLocation | null>
  private readonly lineUniforms: Record<string, WebGLUniformLocation | null>

  private count = 0
  private highlightCount = 0
  private hover = -1
  private selected = -1
  private orbits: { offset: number; length: number; color: RGBA }[] = []
  private width = 1
  private height = 1
  private dpr = 1

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false })
    if (!gl) throw new Error('WebGL2 is not available in this browser')
    this.gl = gl

    this.pointProgram = link(gl, POINT_VERT, POINT_FRAG)
    this.lineProgram = link(gl, LINE_VERT, LINE_FRAG)
    const uniforms = (program: WebGLProgram, names: string[]) =>
      Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)]))
    this.pointUniforms = uniforms(this.pointProgram, [
      'uCenter', 'uScale', 'uViewport', 'uSize', 'uPass', 'uHover', 'uSelected', 'uBase', 'uAccent',
    ])
    this.lineUniforms = uniforms(this.lineProgram, [
      'uCenter', 'uScale', 'uViewport', 'uPointSize', 'uColor', 'uRound',
    ])

    this.positionBuffer = gl.createBuffer()!
    this.stateBuffer = gl.createBuffer()!
    this.highlightBuffer = gl.createBuffer()!
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
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.highlightBuffer)
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
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    this.setMask(new Uint8Array(this.count).fill(1))
  }

  setMask(mask: Uint8Array) {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stateBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, mask, gl.DYNAMIC_DRAW)
  }

  setHighlights(candidates: number[], hover: number, selected: number) {
    const gl = this.gl
    this.hover = hover
    this.selected = selected
    const indices = [...candidates]
    if (hover >= 0) indices.push(hover)
    if (selected >= 0) indices.push(selected)
    this.highlightCount = indices.length
    gl.bindVertexArray(this.pointVao)
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
      const entry = { offset: offset / 2, length: l.points.length / 2, color: l.color }
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
    gl.clearColor(...PANEL_COLOR)
    gl.clear(gl.COLOR_BUFFER_BIT)
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
    gl.uniform1i(lu.uRound, 0)
    for (const orbit of this.orbits) {
      gl.uniform4f(lu.uColor, ...orbit.color)
      gl.drawArrays(gl.LINE_LOOP, orbit.offset, orbit.length)
    }

    if (this.count > 0) {
      gl.useProgram(this.pointProgram)
      const pu = this.pointUniforms
      gl.uniform2f(pu.uCenter, view.cx, view.cy)
      gl.uniform1f(pu.uScale, scale)
      gl.uniform2f(pu.uViewport, vw, vh)
      gl.uniform1f(pu.uSize, pointSizeCss * this.dpr)
      gl.uniform3f(pu.uBase, ...BASE_COLOR)
      gl.uniform3f(pu.uAccent, ...ACCENT_COLOR)
      gl.uniform1i(pu.uHover, this.hover)
      gl.uniform1i(pu.uSelected, this.selected)
      gl.bindVertexArray(this.pointVao)

      gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
      gl.uniform1i(pu.uPass, 0)
      gl.drawArrays(gl.POINTS, 0, this.count)

      if (this.highlightCount > 0) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
        gl.uniform1i(pu.uPass, 1)
        gl.drawElements(gl.POINTS, this.highlightCount, gl.UNSIGNED_INT, 0)
      }
    }

    gl.useProgram(this.lineProgram)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.bindVertexArray(this.lineVao)
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
    gl.deleteBuffer(this.highlightBuffer)
    gl.deleteBuffer(this.lineBuffer)
    gl.deleteBuffer(this.sunBuffer)
    gl.deleteVertexArray(this.pointVao)
    gl.deleteVertexArray(this.lineVao)
    gl.deleteProgram(this.pointProgram)
    gl.deleteProgram(this.lineProgram)
  }
}
