// Full-page background: starfield, aurora curtains and a raymarched asteroid.
// Coordinates: p is in viewport heights, origin at the screen centre, y up.
// uScroll is the page scroll in viewport heights; each layer moves at its own
// parallax rate so the scene drifts with the page.

export const VERTEX_SHADER = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

export const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 uRes;     // canvas size in pixels
uniform float uTime;   // seconds
uniform float uScroll; // page scroll in viewport heights
uniform vec3 uAst;     // asteroid centre (xy, viewport heights) and apparent radius (z)

out vec4 outColor;

// Set to 0 to remove the light trail behind the asteroid.
#define TRAIL 1

const vec3 SKY       = vec3(0.012, 0.015, 0.022);
const vec3 AUR_EDGE  = vec3(0.32, 0.86, 1.00);
const vec3 AUR_UPPER = vec3(0.12, 0.26, 0.95);
const vec3 SUN_DIR   = vec3(-0.92, 0.32, 0.20); // normalised in main()

// Parallax rates (fraction of page scroll speed)
const float P_STARS_FAR  = 0.06;
const float P_STARS_NEAR = 0.14;
const float P_AURORA     = 0.55;
const float P_ASTEROID   = 0.45;

// ---------------------------------------------------------------- hashing
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

// ---------------------------------------------------------------- noise
float noise2(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float noise3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i),               hash13(i + vec3(1, 0, 0)), f.x),
                 mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
                 mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * noise3(p);
    p = p * 2.07 + vec3(13.1, 7.7, 3.3);
    a *= 0.5;
  }
  return s;
}
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// ---------------------------------------------------------------- stars
vec3 starLayer(vec2 q, float cells, float threshold, float t) {
  vec2 g = q * cells;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash12(id);
  if (h < threshold) return vec3(0.0);
  vec2 offset = (hash22(id + 3.1) - 0.5) * 0.7;
  float d = length(f - offset);
  float px = cells / uRes.y;               // one pixel in cell units
  float r = px * 0.8;
  float core = exp(-d * d / (2.0 * r * r));
  float b = (h - threshold) / (1.0 - threshold);
  float twinkle = 0.8 + 0.2 * sin(t * (0.4 + 1.6 * hash12(id + 7.0)) + h * 40.0);
  vec3 tint = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.94, 0.86), hash12(id + 11.0));
  return tint * core * b * b * twinkle;
}

// ---------------------------------------------------------------- aurora
// Curtains repeat down the page; the first lights the gap between the About
// section and the map.
vec3 aurora(vec2 p, float t) {
  const float PERIOD = 2.6;
  float wy = p.y - uScroll * P_AURORA;    // world y, up positive
  float u = -(wy + 1.02);                 // distance below the first curtain (sits under the About section)
  float n = max(floor((u + PERIOD * 0.5) / PERIOD), 0.0);
  float local = u - n * PERIOD;           // > 0 below the curtain's lower edge

  float x = p.x;
  // Folded curtain: the lower edge wanders and the rays follow the folds.
  float fold = 0.16 * sin(x * 1.1 + n * 2.3 + t * 0.03)
             + 0.10 * (noise2(vec2(x * 1.4 + t * 0.02, n * 5.0)) - 0.5);
  float d = local - fold;
  float xr = x + 0.6 * fold;

  // Sharp lower edge, long faint rays upwards.
  float body = d > 0.0 ? exp(-d * 18.0) : exp(d * 2.7);
  float r1 = noise2(vec2(xr * 22.0 + n * 9.0, t * 0.05));
  float r2 = noise2(vec2(xr * 61.0 - t * 0.08, n * 2.0));
  float rays = 0.25 + 0.75 * (r1 * r1 * 0.7 + r2 * 0.3);
  float span = smoothstep(0.2, 0.7, noise2(vec2(x * 0.5 - t * 0.012, n * 3.0 + 1.0)));
  float rim = exp(-abs(d) * 40.0) * 0.6;   // bright line at the lower edge

  float upper = clamp(-d * 1.4, 0.0, 1.0);
  vec3 col = mix(AUR_EDGE, AUR_UPPER, upper);
  return col * (body * rays + rim * r1) * span * 0.42;
}

// ---------------------------------------------------------------- asteroid
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1, 0, 0, 0, c, s, 0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0, -s, 0, 1, 0, s, 0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0, -s, c, 0, 0, 0, 1); }

float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / k1;
}

// Large-scale body: an irregular two-lobed ellipsoid with lumps.
float shape(vec3 p) {
  float d = sdEllipsoid(p, vec3(1.0, 0.66, 0.56));
  d = smin(d, sdEllipsoid(p - vec3(0.50, 0.14, -0.08), vec3(0.52, 0.48, 0.42)), 0.30);
  d -= 0.30 * (noise3(p * 1.1 + 4.0) - 0.5);
  d -= 0.10 * (noise3(p * 2.6 + 9.0) - 0.5);
  return d;
}

// Simple craters on a 3D cell grid: parabolic bowl with a raised rim.
float craterField(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float h = 0.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(x, y, z);
    vec3 r = hash33(i + o);
    if (r.y < 0.35) continue;             // not every cell has a crater
    vec3 c = o + 0.15 + 0.7 * hash33(i + o + 19.7) - f;
    float size = mix(0.18, 0.55, r.x * r.x);
    float d = length(c) / size;
    if (d > 2.2) continue;
    float bowl = d * d - 1.0;
    float rim = 0.32 * exp(-6.0 * (d - 1.0) * (d - 1.0));
    h += smin(bowl, rim, 0.35) * size;
  }
  return h;
}

// Full surface: body + two crater scales + regolith roughness.
float detail(vec3 p) {
  float d = shape(p);
  // Depth/diameter ~0.13 (fresh simple craters are ~0.2; these are degraded).
  d -= 0.11 * craterField(p * 2.4);
  d -= 0.04 * craterField(p * 6.1 + 7.3);
  d -= 0.03 * (fbm3(p * 7.0) - 0.47);
  return d;
}

vec3 calcNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.004;
  return normalize(k.xyy * detail(p + k.xyy * e) +
                   k.yyx * detail(p + k.yyx * e) +
                   k.yxy * detail(p + k.yxy * e) +
                   k.xxx * detail(p + k.xxx * e));
}

float softShadow(vec3 p, vec3 l) {
  float s = 1.0, t = 0.03;
  for (int i = 0; i < 18; i++) {
    float h = shape(p + l * t);
    s = min(s, 10.0 * h / t);
    t += clamp(h * 0.8, 0.02, 0.25);
    if (s < 0.001 || t > 2.5) break;
  }
  return clamp(s, 0.0, 1.0);
}

// Returns linear radiance of the rock at local-space point pl.
vec3 shadeAsteroid(vec3 pl, vec3 l, vec3 v, vec3 down) {
  vec3 n = calcNormal(pl);
  float mu0 = max(dot(n, l), 0.0);
  float mu = max(dot(n, v), 0.0);
  // Lommel-Seeliger (regolith) blended with Lambert for relief.
  float ls = mu0 / (mu0 + mu + 1e-3);
  float diffuse = mix(ls, mu0, 0.45);
  float shadow = mu0 > 0.0 ? softShadow(pl + n * 0.01, l) : 0.0;

  float albedo = 0.11 * (0.6 + 0.8 * fbm3(pl * 3.1 + 2.0));
  albedo *= 0.85 + 0.3 * noise3(pl * 14.0);
  vec3 rock = vec3(1.0, 0.96, 0.91) * albedo;

  vec3 col = rock * diffuse * shadow * 5.5;
  // Faint blue fill from below, as if lit by the aurora.
  float fill = 0.5 + 0.5 * dot(n, down);
  col += rock * vec3(0.30, 0.55, 1.0) * fill * fill * 0.22;
  return col;
}

// ---------------------------------------------------------------- main
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime;

  // Background
  vec3 col = SKY * (0.8 + 0.4 * noise2(p * 1.7 + 3.0));
  col += starLayer(p - vec2(0.0, uScroll * P_STARS_FAR), 70.0, 0.93, t) * 0.6;
  col += starLayer(p - vec2(0.0, uScroll * P_STARS_NEAR) + 17.0, 28.0, 0.965, t);
  col += aurora(p, t);

  vec2 c = uAst.xy + vec2(0.0, uScroll * P_ASTEROID);
  float radius = uAst.z;

#if TRAIL
  {
    vec2 v = p - c;
    vec2 dir = normalize(vec2(-1.0, -0.42));
    float along = dot(v, dir) / radius;
    float perp = dot(v, vec2(-dir.y, dir.x)) / radius;
    float w = 0.35 + 0.18 * along;
    float trail = exp(-perp * perp / (w * w)) * smoothstep(0.6, 1.6, along) * exp(-along * 0.32);
    col += vec3(0.55, 0.75, 1.0) * trail * 0.11;
  }
#endif

  // Asteroid
  vec2 d2 = (p - c) / radius;             // in asteroid radii
  if (dot(d2, d2) < 1.7) {
    const float CAM = 6.0;
    vec3 ro = vec3(0.0, 0.0, CAM);
    vec3 rd = normalize(vec3(d2, -CAM));

    mat3 R = rotX(0.55) * rotZ(0.35) * rotY(t * 0.05 + 1.3);
    vec3 sun = normalize(SUN_DIR);

    float b = dot(ro, rd);
    float h = b * b - (dot(ro, ro) - 1.69);
    if (h > 0.0) {
      h = sqrt(h);
      float tm = -b - h, tEnd = -b + h;
      float minD = 1e9, tClosest = tm;
      bool hit = false;
      for (int i = 0; i < 80; i++) {
        float dist = shape(R * (ro + rd * tm));
        if (dist < minD) { minD = dist; tClosest = tm; }
        if (dist < 0.0015) { hit = true; tClosest = tm; break; }
        tm += dist * 0.6;
        if (tm > tEnd) break;
      }
      float px = 1.0 / (uRes.y * radius); // one pixel in asteroid radii
      float coverage = hit ? 1.0 : 1.0 - smoothstep(0.0, 1.5 * px, minD);
      if (coverage > 0.0) {
        vec3 pl = R * (ro + rd * tClosest);
        vec3 rock = shadeAsteroid(pl, R * sun, R * -rd, R * vec3(0.0, -1.0, 0.0));
        rock = 1.0 - exp(-rock * 1.1);          // tone map
        rock = pow(rock, vec3(1.0 / 2.2));      // to display space
        col = mix(col, rock, coverage);
      }
    }
  }

  // Dither to avoid banding in the aurora.
  col += (hash12(gl_FragCoord.xy + fract(t)) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}
`

/** Asteroid placement for a viewport: centre (viewport heights from centre) and radius. */
export function asteroidPlacement(width: number, height: number): [number, number, number] {
  const aspect = width / height
  if (aspect < 0.85) {
    // Portrait: above the hero text.
    return [aspect * 0.5 * 0.42, 0.29, 0.11]
  }
  return [aspect * 0.5 * 0.52, 0.1, 0.2]
}
