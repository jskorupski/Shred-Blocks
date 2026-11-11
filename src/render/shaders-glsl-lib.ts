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

// Euclidean Voronoi edge distance reserved for the Title Screen Mystic Stone Relic (u_blueprintMix > 0)
vec2 voronoiRockCrack(vec2 x) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  float md = 8.0;
  float shardHash = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hashRelic22(n + g);
      vec2 r = g + (0.14 + 0.72 * o) - f;
      float d = dot(r, r);
      if (d < md) {
        md = d;
        mr = r;
        mg = g;
        shardHash = o.x;
      }
    }
  }
  md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      if (abs(g.x - mg.x) + abs(g.y - mg.y) > 0.01) {
        vec2 o = hashRelic22(n + g);
        vec2 r = g + (0.14 + 0.72 * o) - f;
        if (dot(mr - r, mr - r) > 0.00001) {
          md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
        }
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

// Branchless 3-segment Elder-Futhark rune table (8 glyphs x 3 segments = 24 vec4s, zero SIMD divergence):
// 0 fehu, 1 algiz, 2 tiwaz, 3 gebo, 4 raidho/kenaz, 5 sowilo, 6 thurisaz, 7 laguz/ansuz
const vec4 RUNE_SEGS[24] = vec4[24](
  vec4(0.0, -0.25, 0.0, 0.25), vec4(0.0, 0.04, 0.17, 0.21), vec4(0.0, -0.08, 0.16, 0.08),
  vec4(0.0, -0.25, 0.0, 0.25), vec4(0.0, 0.03, -0.17, 0.21), vec4(0.0, 0.03, 0.17, 0.21),
  vec4(0.0, -0.25, 0.0, 0.25), vec4(0.0, 0.25, -0.15, 0.09), vec4(0.0, 0.25, 0.15, 0.09),
  vec4(-0.17, 0.21, 0.17, -0.21), vec4(0.17, 0.21, -0.17, -0.21), vec4(-0.17, 0.21, 0.17, -0.21),
  vec4(-0.08, -0.24, -0.08, 0.24), vec4(-0.08, 0.22, 0.14, 0.05), vec4(0.14, 0.05, -0.08, -0.1),
  vec4(0.12, 0.23, -0.1, 0.05), vec4(-0.1, 0.05, 0.1, -0.05), vec4(0.1, -0.05, -0.12, -0.23),
  vec4(0.0, -0.25, 0.0, 0.25), vec4(0.0, 0.14, 0.16, 0.0), vec4(0.16, 0.0, 0.0, -0.14),
  vec4(-0.04, -0.25, -0.04, 0.25), vec4(-0.04, 0.22, 0.16, 0.07), vec4(-0.04, 0.05, 0.14, -0.09)
);

float runeDist(vec2 p, int id) {
  int baseIdx = clamp(id, 0, 7) * 3;
  vec4 s0 = RUNE_SEGS[baseIdx];
  vec4 s1 = RUNE_SEGS[baseIdx + 1];
  vec4 s2 = RUNE_SEGS[baseIdx + 2];
  return min(sdSeg(p, s0.xy, s0.zw), min(sdSeg(p, s1.xy, s1.zw), sdSeg(p, s2.xy, s2.zw)));
}

// Fast 120Hz Relic Stone relief (BLOCK-STONE-01): returns vec2(recess, rakingLight) in a single pass.
// Chips occur strictly on bevels & outer cell rims (never Swiss-cheese craters in the flat center), and
// rune SDF runs only inside the central [0.32 x 0.32] glyph box on top faces.
vec2 stoneRelief(vec2 bp, float z, float isTop, float wornBand, vec2 lightDir) {
  vec2 cellF = fract(bp);
  float rimMask = smoothstep(0.04, 0.55, wornBand) * (1.0 - isTop);
  float recess = 0.0;
  float raking = 0.0;
  if (rimMask > 0.02) {
    vec2 sp = bp + z * vec2(0.73, 1.31);
    float c0 = smoothstep(0.56, 0.66, relicNoise(sp * 3.8 + 37.0)) * rimMask;
    float cL = smoothstep(0.56, 0.66, relicNoise((sp + lightDir * 0.024) * 3.8 + 37.0)) * rimMask;
    recess += c0 * 0.9;
    raking += (c0 - cL) * 7.0;
  }
  if (isTop > 0.2) {
    vec2 cellHash = hashRelic22(floor(bp) + 3.0);
    vec2 cuv = cellF - 0.5 - (cellHash - 0.5) * 0.05;
    if (max(abs(cuv.x), abs(cuv.y)) < 0.32) {
      float flipX = fract(cellHash.y * 7.0) < 0.5 ? -1.0 : 1.0;
      bool rot90 = fract(cellHash.y * 13.0) < 0.35;
      vec2 p0 = vec2(cuv.x * flipX, cuv.y);
      vec2 pL = vec2((cuv.x + lightDir.x * 0.02) * flipX, cuv.y + lightDir.y * 0.02);
      if (rot90) {
        p0 = vec2(-p0.y, p0.x);
        pL = vec2(-pL.y, pL.x);
      }
      int glyphId = int(floor(cellHash.x * 8.0));
      float s0 = 1.0 - smoothstep(0.024, 0.054, runeDist(p0 * 1.12, glyphId));
      float sL = 1.0 - smoothstep(0.024, 0.054, runeDist(pL * 1.12, glyphId));
      recess += s0 * isTop * 0.92;
      raking += (s0 - sL) * isTop * 7.0;
    }
  }
  return vec2(clamp(recess, 0.0, 1.0), clamp(raking, -0.5, 0.5));
}
`;
