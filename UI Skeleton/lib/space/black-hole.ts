// Methodology page background: a quiet black hole with a lensed starfield.
// A cheap 2-D approximation, not a ray-traced metric:
//   * shadow: a black disc edged by a thin photon ring;
//   * accretion disk: a tilted ellipse whose near half crosses in front of the
//     shadow; the far half is bent up and over the top as a lensed halo;
//   * Keplerian swirl (inner gas turns faster) and Doppler beaming (the side
//     moving towards us is brighter);
//   * background stars pushed outward around the hole (weak lensing).
// p is in viewport heights, origin at the screen centre, y up. The hole sits
// upper right, drifts up as the page scrolls and dims so text stays readable.

export { VERTEX_SHADER } from './shader'

export const BLACK_HOLE_SHADER = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform float uScroll;

out vec4 outColor;

const vec3 SKY      = vec3(0.010, 0.012, 0.020);
const vec3 DISK_HOT = vec3(0.86, 0.95, 1.00);
const vec3 DISK_MID = vec3(0.32, 0.72, 1.00);
const vec3 DISK_OUT = vec3(0.10, 0.22, 0.75);
const float PI = 3.14159265;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

float stars(vec2 q, float density, float size) {
  vec2 cell = floor(q * density);
  vec2 f = fract(q * density) - 0.5;
  float h = hash12(cell);
  if (h < 0.93) return 0.0;
  vec2 offset = vec2(hash12(cell + 3.1), hash12(cell + 7.7)) - 0.5;
  float d = length(f - offset * 0.7);
  float twinkle = 0.75 + 0.25 * sin(uTime * (0.6 + h * 1.4) + h * 40.0);
  return smoothstep(size, 0.0, d) * (h - 0.93) * 14.0 * twinkle;
}

// Disk emission at elliptical radius er and angle phi (disk plane).
float diskLight(float er, float phi, float rIn, float rOut) {
  if (er < rIn * 0.9 || er > rOut * 1.25) return 0.0;
  float spin = uTime * 0.22 * pow(rIn / er, 1.5);
  float a = phi - spin;
  vec2 polar = vec2(cos(a), sin(a)) * 2.4 + er / rIn * 1.6;
  float streak = fbm(polar + vec2(0.0, er * 22.0));
  float radial = smoothstep(rIn * 0.9, rIn * 1.15, er) * pow(clamp(rIn / er, 0.0, 1.0), 1.6);
  float edge = 1.0 - smoothstep(rOut * 0.75, rOut * 1.25, er);
  return radial * edge * (0.45 + 0.9 * streak);
}

vec3 diskColour(float er, float rIn) {
  float t = clamp((er - rIn) / (rIn * 2.2), 0.0, 1.0);
  return t < 0.5 ? mix(DISK_HOT, DISK_MID, t * 2.0) : mix(DISK_MID, DISK_OUT, t * 2.0 - 1.0);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float aspect = uRes.x / uRes.y;

  // Placement: upper right on wide screens, top centre-right on narrow ones.
  // On narrow screens it sits smaller and higher, clear of the page title.
  vec2 c = aspect > 1.15 ? vec2(0.30 * aspect, 0.16) : vec2(0.30 * aspect, 0.40);
  c.y += uScroll * 0.35;
  float shadowR = aspect > 1.15 ? 0.105 : 0.05;

  vec2 d = p - c;
  float r = length(d);

  // Weakly lensed starfield: sample stars further out than they appear.
  vec2 q = p + d / max(r, 1e-4) * (shadowR * shadowR * 1.6) / max(r, shadowR);
  vec3 col = SKY;
  col += vec3(0.75, 0.85, 1.0) * stars(q + vec2(0.0, uScroll * 0.05), 70.0, 0.06);
  col += vec3(0.55, 0.7, 1.0) * stars(q * 1.7 + 11.0, 120.0, 0.05) * 0.6;

  // Disk frame: tilted, seen nearly edge-on.
  float tilt = -0.32;
  mat2 rot = mat2(cos(tilt), sin(tilt), -sin(tilt), cos(tilt));
  vec2 dd = rot * d;
  float incl = 0.17;
  vec2 e = vec2(dd.x, dd.y / incl);
  float er = length(e);
  float phi = atan(e.y, e.x);
  float rIn = shadowR * 1.25;
  float rOut = shadowR * 3.6;
  float doppler = 1.0 + 0.55 * cos(phi + PI);  // left side approaches, brighter

  float disk = diskLight(er, phi, rIn, rOut) * doppler;
  vec3 diskCol = diskColour(er, rIn) * disk;

  // Lensed far side of the disk: a halo bent over (and faintly under) the shadow.
  float ang = atan(dd.y, dd.x);
  float haloR = shadowR * 1.32;
  float halo = exp(-pow((r - haloR) / (shadowR * 0.22), 2.0));
  halo *= 0.35 + 0.65 * smoothstep(-0.6, 0.9, sin(ang));   // brighter on top
  halo *= 0.55 + 0.6 * fbm(vec2(cos(ang - uTime * 0.18), sin(ang - uTime * 0.18)) * 3.0 + 4.0);
  halo *= 1.0 + 0.45 * cos(ang + PI);
  vec3 haloCol = mix(DISK_MID, DISK_HOT, 0.45) * halo * 0.9;

  // Thin photon ring right at the shadow edge.
  float ring = exp(-pow((r - shadowR * 1.03) / (shadowR * 0.035), 2.0));
  vec3 ringCol = DISK_HOT * ring * 0.9;

  // Soft glow around the whole system.
  vec3 glow = DISK_OUT * 0.10 * exp(-r / (shadowR * 2.8));

  bool inShadow = r < shadowR;
  bool nearSide = dd.y < 0.0;
  vec3 behind = inShadow ? vec3(0.0) : col + haloCol + glow;
  if (!inShadow) behind += ringCol;
  // Far half of the disk is hidden by the shadow; the near half crosses in front.
  vec3 front = (nearSide || !inShadow) ? diskCol : vec3(0.0);
  col = behind + front;

  // Keep it quiet: dim overall, fade as the reader scrolls into the text.
  float calm = mix(0.85, 0.32, smoothstep(0.0, 1.6, uScroll));
  col = SKY + (col - SKY) * calm;
  col *= 1.0 - 0.35 * length(p * vec2(0.55, 0.9));
  outColor = vec4(col, 1.0);
}
`
