/**
 * Shared GLSL noise / fracture / rune / relief helpers for the main fragment shader (`BLOCK-STONE-01`,
 * `MYSTIC-RELIC-01`), interpolated into `MAIN_FRAGMENT_SHADER` (`ARCH-ERGONOMICS-01`).
 */
export const GLSL_STONE_LIB = `
vec2 hashRelic22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Smooth 2D value noise (drives living crack-glow pulses & stone mottling)
float relicNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hashRelic22(i).x;
  float b = hashRelic22(i + vec2(1.0, 0.0)).x;
  float c = hashRelic22(i + vec2(0.0, 1.0)).x;
  float d = hashRelic22(i + vec2(1.0, 1.0)).x;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Euclidean Voronoi edge distance reserved for the Title Screen Mystic Stone Relic (u_blueprintMix > 0).
// Caches the 3x3 neighbor offsets in rv[9] so the edge-distance pass does zero redundant hashRelic22 calls.
vec2 voronoiRockCrack(vec2 x) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  vec2 rv[9];
  vec2 mr = vec2(0.0);
  int minIdx = 0;
  float md = 8.0;
  float shardHash = 0.0;
  int k = 0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hashRelic22(n + g);
      vec2 r = g + (0.14 + 0.72 * o) - f;
      rv[k] = r;
      float d = dot(r, r);
      if (d < md) {
        md = d;
        mr = r;
        minIdx = k;
        shardHash = o.x;
      }
      k++;
    }
  }
  md = 8.0;
  for (int idx = 0; idx < 9; idx++) {
    if (idx != minIdx) {
      vec2 r = rv[idx];
      vec2 diff = r - mr;
      float d2 = dot(diff, diff);
      if (d2 > 0.00001) {
        md = min(md, dot(0.5 * (mr + r), diff * inversesqrt(d2)));
      }
    }
  }
  return vec2(md, shardHash);
}

float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

// Branchless 3-segment archaic mason / Elder-Futhark stone-mark table (8 glyphs x 3 segments = 24 vec4s, zero arrows):
// 0 fehu, 1 algiz, 2 hagalaz, 3 gebo, 4 raidho, 5 sowilo, 6 thurisaz, 7 ansuz
const vec4 RUNE_SEGS[24] = vec4[24](
  vec4(0.0, -0.24, 0.0, 0.24), vec4(0.0, 0.04, 0.16, 0.20), vec4(0.0, -0.08, 0.15, 0.08),
  vec4(0.0, -0.24, 0.0, 0.24), vec4(0.0, 0.03, -0.16, 0.20), vec4(0.0, 0.03, 0.16, 0.20),
  vec4(-0.11, -0.22, -0.11, 0.22), vec4(0.11, -0.22, 0.11, 0.22), vec4(-0.11, 0.08, 0.11, -0.08),
  vec4(-0.16, 0.20, 0.16, -0.20), vec4(0.16, 0.20, -0.16, -0.20), vec4(-0.16, 0.20, 0.16, -0.20),
  vec4(-0.08, -0.23, -0.08, 0.23), vec4(-0.08, 0.21, 0.13, 0.05), vec4(0.13, 0.05, -0.08, -0.09),
  vec4(0.11, 0.22, -0.09, 0.05), vec4(-0.09, 0.05, 0.09, -0.05), vec4(0.09, -0.05, -0.11, -0.22),
  vec4(0.0, -0.24, 0.0, 0.24), vec4(0.0, 0.13, 0.15, 0.0), vec4(0.15, 0.0, 0.0, -0.13),
  vec4(-0.04, -0.24, -0.04, 0.24), vec4(-0.04, 0.21, 0.15, 0.07), vec4(-0.04, 0.05, 0.13, -0.09)
);

float runeDist(vec2 p, int id) {
  int baseIdx = clamp(id, 0, 7) * 3;
  vec4 s0 = RUNE_SEGS[baseIdx];
  vec4 s1 = RUNE_SEGS[baseIdx + 1];
  vec4 s2 = RUNE_SEGS[baseIdx + 2];
  return min(sdSeg(p, s0.xy, s0.zw), min(sdSeg(p, s1.xy, s1.zw), sdSeg(p, s2.xy, s2.zw)));
}

// Fast 120Hz Relic Stone worn relief (BLOCK-STONE-01): returns vec3(edgeNick, runeGroove, rakingLight)
// using smooth analytic offset along lightDir (zero dFdx/dFdy 2x2 pixel-quad blockiness).
vec3 stoneRelief(
  vec2 bp,
  float z,
  float isTop,
  float edgeProx,
  float cornerProx,
  vec2 lightDir,
  float grainLow,
  float grainMed
) {
  float nick = 0.0;
  float raking = 0.0;
  // Sparse, smooth-worn edge & corner nicks (wrapping slightly onto the outer top shoulder & corners)
  if (edgeProx > 0.34) {
    vec2 sp = bp + z * vec2(0.82, 1.28);
    float c0 = relicNoise(sp * 5.2 + grainMed * 0.22 + 37.0);
    float cL = relicNoise((sp + lightDir * 0.026) * 5.2 + grainMed * 0.22 + 37.0);
    float m = smoothstep(0.42, 0.84, edgeProx + cornerProx * 0.18) * mix(1.0, 0.55, isTop);
    float thresh = 0.67 - cornerProx * 0.11;
    float k0 = smoothstep(thresh, thresh + 0.13, c0) * m;
    float kL = smoothstep(thresh, thresh + 0.13, cL) * m;
    nick = k0;
    raking += (k0 - kL) * 2.5;
  }
  float groove = 0.0;
  if (isTop > 0.2) {
    vec2 cellHash = hashRelic22(floor(bp) + 3.0);
    vec2 cuv = fract(bp) - 0.5 - (cellHash - 0.5) * 0.06;
    if (max(abs(cuv.x), abs(cuv.y)) < 0.27) {
      float flipX = fract(cellHash.y * 7.0) < 0.5 ? -1.0 : 1.0;
      bool rot90 = fract(cellHash.y * 13.0) < 0.42;
      vec2 warp = vec2(grainMed, grainLow) * 0.012;
      vec2 p0 = vec2((cuv.x + warp.x) * flipX, cuv.y + warp.y);
      vec2 pL = vec2((cuv.x + warp.x + lightDir.x * 0.022) * flipX, cuv.y + warp.y + lightDir.y * 0.022);
      if (rot90) {
        p0 = vec2(-p0.y, p0.x);
        pL = vec2(-pL.y, pL.x);
      }
      int glyphId = int(floor(cellHash.x * 8.0));
      float aa = clamp(fwidth(bp.x) * 1.2, 0.006, 0.020);
      // Soft, wide-shouldered profile + uneven wear so markings read as faint, centuries-rubbed stone carvings
      float strokeWear = mix(0.22, 0.92, smoothstep(-0.26, 0.32, grainLow * 0.72 + grainMed * 0.50));
      float cellAge = mix(0.32, 0.84, fract(cellHash.x * 19.3 + cellHash.y * 7.1));
      float fade = strokeWear * cellAge * (1.0 - smoothstep(0.36, 0.64, edgeProx)) * isTop;
      float g0 = (1.0 - smoothstep(0.008, 0.042 + aa, runeDist(p0 * 1.48, glyphId))) * fade;
      float gL = (1.0 - smoothstep(0.008, 0.042 + aa, runeDist(pL * 1.48, glyphId))) * fade;
      groove = g0;
      raking += (g0 - gL) * 1.42;
    }
  }
  return vec3(clamp(nick, 0.0, 1.0), clamp(groove, 0.0, 1.0), clamp(raking, -0.22, 0.22));
}
`;
