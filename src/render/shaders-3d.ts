import { ENVIRONMENT_MESHES, type MeshData } from './mesh-generator';
import { type GLMeshHandle, INSTANCE_STRIDE } from './render-types';

export { MAIN_VERTEX_SHADER } from './shaders-main-vertex';
export { PARTICLE_FRAGMENT_SHADER, PARTICLE_VERTEX_SHADER } from './shaders-particles';

export const MAIN_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

in vec3 v_worldPos;
in vec3 v_localPos;
in vec3 v_normal;
in vec2 v_uv;

uniform vec4 u_color;
uniform vec3 u_capColor;
uniform vec4 u_clipPlane;
uniform int u_useClipPlane;
uniform int u_useTexture;
uniform int u_materialStyle; // 0=standard, 1=gummy, 2=wood, 3=neon, 4=unlit_overlay, 5=stone_surface, 6=relic_stone
uniform sampler2D u_atlas;
uniform float u_blueprintMix;
uniform vec3 u_boardInfo; // x = cols * 0.5, y = rows * 0.5, z = timeSec
uniform vec3 u_stoneTint; // subtle mineral tint multiplier from equipped tray + skin
uniform int u_highContrast;

out vec4 outColor;

vec2 hashRelic22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Smooth 2D value noise (drives uneven, living crack-glow pulses & stone mottling)
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

// Euclidean Voronoi edge distance for authentic angular geological stone fractures (zero sine loops)
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

// Relic Stone relief height (BLOCK-STONE-01): rough grit, chunks broken off the worn rim, small spalled flakes,
// and irregular hand-carved socket sigils (per-cell jitter, radius, depth & erosion). Sampled twice by the
// caller (here + a step toward the light) for smooth per-pixel relief shading without derivative blockiness.
float stoneRelief(vec2 bp, float z, float isTop, float wornBand) {
  vec2 sp = bp + z * vec2(0.73, 1.31);
  float grit = relicNoise(sp * 3.1) * 0.4 + relicNoise(sp * 8.3 + 2.0) * 0.35 + relicNoise(sp * 19.0 + 4.0) * 0.25;
  float chipNoise = relicNoise(sp * 4.2 + 40.0) * 0.65 + relicNoise(sp * 9.5 + 9.0) * 0.35;
  float chip = smoothstep(0.5, 0.6, chipNoise) * smoothstep(0.05, 0.55, wornBand) * (1.0 - isTop * 0.55);
  vec2 sv = voronoiRockCrack(sp * 3.4 + relicNoise(sp * 2.0) * 0.6 + 23.0);
  float spall = step(0.9, sv.y) * smoothstep(0.0, 0.05, sv.x);
  vec2 cellHash = hashRelic22(floor(bp) + 3.0);
  vec2 cuv = fract(bp) - 0.5 - (cellHash - 0.5) * 0.08;
  float rr = length(cuv);
  float ang = atan(cuv.y, cuv.x);
  float erode = smoothstep(0.22, 0.62, relicNoise(vec2(ang * 1.9 + cellHash.x * 20.0, rr * 7.0 + cellHash.y * 9.0)));
  float sigDepth = mix(0.35, 1.0, cellHash.x);
  float ringG = (1.0 - smoothstep(0.012, 0.05, abs(rr - (0.17 + cellHash.y * 0.05)))) * erode * sigDepth;
  float drill = (1.0 - smoothstep(0.01, 0.045, rr)) * sigDepth * 0.8;
  float sigil = clamp(ringG + drill, 0.0, 1.0) * isTop;
  return grit * 0.32 - chip * 1.0 - spall * 0.3 - sigil * 0.75;
}

void main() {
  if (u_useClipPlane == 1) {
    float clipDist = dot(v_worldPos, u_clipPlane.xyz) + u_clipPlane.w;
    if (clipDist < 0.0) {
      discard;
    }
    if (!gl_FrontFacing) {
      outColor = vec4(u_capColor, u_color.a);
      return;
    }
  }

  if (u_useTexture == 1) {
    vec4 texel = texture(u_atlas, v_uv);
    if (texel.a < 0.08) {
      discard;
    }
    if (u_materialStyle == 4) {
      vec3 badgeRgb = texel.rgb * u_color.rgb;
      if (u_blueprintMix > 0.001) {
        float bLum = dot(badgeRgb, vec3(0.299, 0.587, 0.114));
        vec3 carvedBadge = mix(vec3(0.22, 0.18, 0.20), vec3(0.90, 0.82, 0.68), smoothstep(0.08, 0.72, bLum));
        badgeRgb = mix(badgeRgb, carvedBadge, u_blueprintMix);
      }
      outColor = vec4(badgeRgb, texel.a * u_color.a * mix(1.0, 0.90, u_blueprintMix));
      return;
    }
  }

  if (u_materialStyle == 4) {
    vec3 flatRgb = u_color.rgb;
    if (u_blueprintMix > 0.001) {
      flatRgb = mix(flatRgb, vec3(0.76, 0.66, 0.52), u_blueprintMix * 0.88);
    }
    outColor = vec4(flatRgb, u_color.a * mix(1.0, 0.52, u_blueprintMix));
    return;
  }

  vec3 N = normalize(v_normal);
  vec3 L1 = normalize(vec3(-0.35, -0.55, 0.76));
  vec3 L2 = normalize(vec3(0.45, 0.35, 0.82));
  vec3 V = normalize(vec3(0.0, 0.21, 0.97));
  vec3 H = normalize(L1 + V);

  float diff1 = max(dot(N, L1), 0.0);
  float diff2 = max(dot(N, L2), 0.0) * 0.28;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);

  vec3 base = u_color.rgb;
  float specPower = 28.0;
  float specStrength = 0.26;
  vec3 emissive = vec3(0.0);

  if (u_materialStyle == 1) {
    // gummy_jelly: subsurface glow + glossy highlight
    specPower = 48.0;
    specStrength = u_highContrast == 1 ? 0.34 : 0.45;
    base = mix(base, vec3(1.0), 0.12 * rim);
  } else if (u_materialStyle == 2) {
    // carved_wood (WOOD-GRAIN-01): stained hardwood. Concentric growth rings around a log axis running along
    // block-local X (flowing cathedral arcs on top faces, end-grain arcs on sides), noise-warped figure,
    // earlywood/latewood contrast, elongated open pores, and a satin varnish sheen.
    vec3 wq = v_localPos;
    // Fine straight-grained hardwood: long fiber lines running along block-local X whose spacing drifts with
    // low-frequency noise (no regular waves), thin dark latewood lines, fine pores, and occasional dark knots
    // that the grain visibly bends around.
    float figureWarp = relicNoise(vec2(wq.x * 0.55, wq.y * 1.8) + 3.7) * 1.1 + relicNoise(vec2(wq.x * 1.6, wq.y * 4.0)) * 0.3;
    vec2 knotCell = floor(wq.xy * vec2(0.55, 0.8));
    vec2 knotHash = hashRelic22(knotCell + 17.0);
    vec2 knotPos = (knotCell + 0.25 + 0.5 * knotHash) / vec2(0.55, 0.8);
    vec2 knotRel = (wq.xy - knotPos) * vec2(0.8, 1.7);
    float knotDist = length(knotRel);
    float hasKnot = step(0.55, hashRelic22(knotCell + 5.0).x);
    float knotBend = hasKnot * 0.55 * exp(-knotDist * knotDist * 9.0) * sign(knotRel.y + 1e-4);
    float ringCoord = wq.y * 11.0 + figureWarp * 2.2 + (wq.z - 0.3) * 3.0 + knotBend * 6.0;
    float ringPhase = fract(ringCoord);
    float latewood = smoothstep(0.78, 0.9, ringPhase) * (1.0 - smoothstep(0.95, 1.0, ringPhase));
    float earlywood = 1.0 - latewood;
    float fibers = relicNoise(vec2(wq.x * 3.0, wq.y * 140.0 + figureWarp * 30.0)) - 0.5;
    float pores = smoothstep(0.7, 0.93, relicNoise(vec2(wq.x * 10.0, wq.y * 210.0 + figureWarp * 40.0)));
    float streak = relicNoise(vec2(wq.x * 0.5, wq.y * 9.0 + figureWarp)) - 0.5;
    float knotRings = hasKnot * exp(-knotDist * knotDist * 22.0) * (0.5 + 0.5 * sin(knotDist * 70.0));
    float knotCore = hasKnot * (1.0 - smoothstep(0.07, 0.14, knotDist));
    float knotHalo = hasKnot * exp(-knotDist * knotDist * 14.0) * 0.6;
    float woodAmp = u_highContrast == 1 ? 0.45 : 1.0;
    vec3 stained = mix(base, base * vec3(1.05, 0.9, 0.74) + vec3(0.045, 0.026, 0.006), 0.42);
    float woodLum =
      1.0 + (-latewood * 0.2 + fibers * 0.07 - pores * 0.08 + streak * 0.1 - knotHalo * 0.16 - knotRings * 0.12 - knotCore * 0.45) * woodAmp;
    base = clamp(stained * woodLum, 0.0, 1.0);
    specPower = 22.0;
    specStrength = 0.13 + earlywood * 0.05;
  } else if (u_materialStyle == 6) {
    // relic_stone (BLOCK-STONE-01, default skin): heavy pigmented ancient stone with mineral mottling, hue drift,
    // grain, pitting, hairline veins, worn edges, and a carved socket sigil on every top cell.
    vec2 bp = v_localPos.xy;
    float sAmp6 = u_highContrast == 1 ? 0.45 : 1.0;
    // Time-worn rounded edges: bend the flat chamfer/upper-side normals along a smooth quarter-round profile so
    // the deep worn bevel shades like an eroded, rounded stone edge instead of a crisp machined facet.
    float faceNz = N.z;
    float wornBand = clamp((v_localPos.z - (0.58 - 0.16)) / 0.16, 0.0, 1.0);
    if (N.z < 0.95 && wornBand > 0.0) {
      vec3 sideN = normalize(vec3(N.xy, 0.0001));
      float roundT = wornBand * wornBand * (3.0 - 2.0 * wornBand);
      N = normalize(mix(sideN, vec3(0.0, 0.0, 1.0), roundT * 0.92));
      diff1 = max(dot(N, L1), 0.0);
      diff2 = max(dot(N, L2), 0.0) * 0.28;
      rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);
    }
    float bMottle = relicNoise(bp * 2.2 + v_localPos.z * 1.7) * 0.6 + relicNoise(bp * 6.3 + 3.1) * 0.4 - 0.5;
    float bVein = 1.0 - smoothstep(0.0, 0.022 + fwidth(bp.x) * 0.8, voronoiRockCrack(bp * 1.25 + bMottle * 0.4 + 11.0).x);
    float isTopFace = smoothstep(0.86, 0.96, faceNz) * step(0.45, v_localPos.z);
    // Hewn stone relief: height sampled here and one step toward the light -> raking-light shading of chips,
    // flakes and carved sigils (bright lit lips, dark shadowed hollows), plus recess grime.
    vec2 lightStep = normalize(-L1.xy) * 0.022;
    float reliefH = stoneRelief(bp, v_localPos.z, isTopFace, wornBand);
    float reliefL = stoneRelief(bp + lightStep, v_localPos.z, isTopFace, wornBand);
    float raking = clamp((reliefL - reliefH) * 8.0, -0.5, 0.5) * sAmp6;
    float recess = clamp(-reliefH, 0.0, 1.0);
    float chip = smoothstep(0.25, 0.9, recess) * (1.0 - isTopFace * 0.4);
    float spall = 0.0;
    float grit = relicNoise(bp * 8.3 + 2.0);
    float sigil = recess * isTopFace;
    // Worn, chalky exposed edges (rounded chamfer band) + large blotchy weathering zones
    float edgeWear = (1.0 - smoothstep(0.88, 0.97, faceNz)) * smoothstep(0.15, 0.6, wornBand);
    float regionVar = relicNoise(bp * 0.85 + v_localPos.z * 0.6 + 31.0) - 0.5;
    float stoneLum =
      1.0 + (bMottle * 0.28 + regionVar * 0.22 + (grit - 0.5) * 0.12 - bVein * 0.16 - spall * 0.05) * sAmp6;
    // Time-faded pigment: bleached toward warm chalky stone on weathered zones & edges; freshly broken chunks
    // expose deeper, less-faded pigment; carved grooves collect dark grime.
    vec3 lumC = vec3(dot(base, vec3(0.299, 0.587, 0.114)));
    float fadeAmt = clamp(0.3 + regionVar * 0.45 + edgeWear * 0.35 - chip * 0.4, 0.0, 0.8) * mix(1.0, 0.4, float(u_highContrast));
    vec3 pigment = mix(base, lumC * vec3(1.05, 1.0, 0.92) + vec3(0.09, 0.085, 0.075), fadeAmt);
    float hueDrift = (relicNoise(bp * 1.4 + 21.0) - 0.5) * 0.18 * sAmp6;
    pigment *= vec3(1.0 + hueDrift, 1.0 + hueDrift * 0.3, 1.0 - hueDrift);
    float grime = recess * 0.38;
    base = clamp(pigment * stoneLum * (1.0 - grime * mix(1.0, 0.6, float(u_highContrast))) * (1.0 + raking * 0.55), 0.0, 1.0);
    specPower = 14.0;
    specStrength = 0.06;
  } else if (u_materialStyle == 3) {
    // neon_cyber (NEON-CYBER-01): glossy black-glass/chrome shell reflecting a cool sky gradient, bright
    // self-lit neon edges in the block color, and glowing circuit traces + pads on top that pulse in time
    // (static under Reduced Motion). Emissive is added after lighting so it stays vivid.
    vec3 lpN = v_localPos;
    float isTop3 = smoothstep(0.86, 0.96, N.z) * step(0.45, lpN.z);
    float hcMul = u_highContrast == 1 ? 0.55 : 1.0;
    vec3 neonCol = min(vec3(1.0), base * 1.3 + 0.1);
    vec3 R = reflect(-V, N);
    float sky = smoothstep(-0.2, 0.95, R.y * 0.55 + R.z * 0.45);
    vec3 env = mix(vec3(0.02, 0.015, 0.06), vec3(0.62, 0.7, 1.0), sky) + base * 0.3 * sky;
    float coreMul = u_highContrast == 1 ? 0.35 : 0.12;
    base = base * coreMul + vec3(0.012, 0.015, 0.028) + env * 0.42;
    float bevelEdge = (1.0 - smoothstep(0.8, 0.95, N.z)) * smoothstep(0.12, 0.4, N.z);
    vec2 gq = lpN.xy * 4.0;
    vec2 gc = floor(gq);
    vec2 gf = fract(gq) - 0.5;
    vec2 gh = hashRelic22(gc + 9.0);
    float lineD = mix(abs(gf.x), abs(gf.y), step(0.5, gh.x));
    float traceAA = fwidth(gq.x) * 1.5;
    float trace = (1.0 - smoothstep(0.045, 0.045 + traceAA, lineD)) * step(0.35, gh.y);
    float pad = (1.0 - smoothstep(0.11, 0.11 + traceAA, length(gf))) * step(0.82, gh.y);
    float tN = max(u_boardInfo.z, 0.0) * step(0.0, u_boardInfo.z);
    float pulse = 0.55 + 0.45 * smoothstep(0.72, 1.0, fract(lpN.x * 0.35 + lpN.y * 0.2 - tN * 0.45));
    float circuit = clamp(trace + pad, 0.0, 1.0) * isTop3;
    // Polished glass sheen: a soft diagonal reflection streak sweeping across top faces
    float sheenBand = 1.0 - smoothstep(0.0, 0.16, abs(fract((v_worldPos.x + v_worldPos.y) * 0.16 + 0.1) - 0.5));
    base += vec3(0.75, 0.82, 1.0) * sheenBand * isTop3 * 0.22 * hcMul + vec3(0.6, 0.7, 1.0) * rim * 0.25;
    emissive = neonCol * (bevelEdge * 0.95 + circuit * 0.85 * pulse * hcMul);
    specPower = 96.0;
    specStrength = 0.85;
  } else if (u_materialStyle == 5) {
    // stone_surface (STONE-FLOOR-01): world-space weathered stone on tray floors, walls & pillars.
    // Luminance-only modulation keeps each Board Tray's palette identity; u_stoneTint adds a faint mineral cast.
    vec2 sp = v_worldPos.xy + v_worldPos.z * vec2(0.7, 1.3);
    float sMottle = relicNoise(sp * 1.15) * 0.65 + relicNoise(sp * 3.1 + 4.7) * 0.35 - 0.5;
    float sGrain = (relicNoise(sp * 37.0 + 3.0) - 0.5) * 2.0;
    float sPit = smoothstep(0.8, 0.95, relicNoise(sp * 21.0 + sMottle * 3.0 + 5.0));
    float sVein = 1.0 - smoothstep(0.0, 0.03 + fwidth(sp.x) * 0.8, voronoiRockCrack(sp * 0.85 + sMottle * 0.3).x);
    float sAmp = u_highContrast == 1 ? 0.45 : 1.0;
    float sLum = 1.0 + (sMottle * 0.2 + sGrain * 0.03 - sPit * 0.08 - sVein * 0.15) * sAmp;
    base = clamp(base * sLum * mix(vec3(1.0), u_stoneTint, 0.35), 0.0, 1.0);
    specPower = 16.0;
    specStrength = 0.09;
  }

  float spec = pow(max(dot(N, H), 0.0), specPower) * specStrength;
  float ambient = u_highContrast == 1 ? 0.54 : 0.50;
  float heightShade = clamp((v_localPos.z - 0.54) * 1.45, -0.08, 0.14);
  float studRim = (v_localPos.z > 0.565 && N.z < 0.96 && N.z > 0.05) ? (0.16 * max(dot(N, L1), -0.35)) : 0.0;
  vec3 lit = base * (ambient + diff1 * 0.49 + diff2 + heightShade) + vec3(spec + studRim) + emissive;

  if (u_highContrast == 1) {
    // Crisp high-contrast 3D bevel edge contour so every block and wall edge has razor-sharp definition
    float edgeBevel = smoothstep(0.58, 0.16, abs(N.z));
    lit = mix(min(vec3(1.0), lit * 1.08), lit * 0.34, edgeBevel * 0.58);
  }

  float blueprintAlpha = 1.0;

  if (u_blueprintMix > 0.001) {
    // Mystic Stone Relic Mode (STONE-TABLET-01 / MYSTIC-RELIC-01): renders the board as a 100% solid
    // (alpha = 1.0) weathered stone bas-relief, desaturated and faintly mineral-tinted per theme (u_stoneTint),
    // with Voronoi fissures, grime, chiseled bevels, and a noise-driven crackPulse amethyst-orchid/gold glow;
    // it fades into full gameplay color as u_blueprintMix -> 0.
    float isSunkenRoom = smoothstep(-0.02, -0.10, v_worldPos.z);
    vec3 restoredRgb = clamp(u_color.rgb / mix(1.0, 0.58, isSunkenRoom), 0.0, 1.0);
    float maxC = max(restoredRgb.r, max(restoredRgb.g, restoredRgb.b));
    float minC = min(restoredRgb.r, min(restoredRgb.g, restoredRgb.b));
    float chroma = maxC - minC;
    // Separates all 9 block/gate colors (chroma >= 0.50) from all 5 tray floors/walls (chroma <= 0.28)
    float isPiece = smoothstep(0.30, 0.44, chroma);
    float localWorldZ = v_worldPos.z + isSunkenRoom * 0.18;
    float isElevatedStone = smoothstep(0.035, 0.18, localWorldZ);

    vec2 relCenter = v_worldPos.xy - u_boardInfo.xy;
    float distCenter = length(relCenter);
    float maxHalfSpan = max(u_boardInfo.x, u_boardInfo.y);
    float normDist = clamp(distCenter / max(maxHalfSpan * 1.22, 2.5), 0.0, 1.35);
    float radialWarmth = clamp(1.0 - normDist * 0.42, 0.0, 1.0);
    float caveVignette = clamp(1.0 - smoothstep(0.52, 1.28, normDist) * 0.22, 0.78, 1.0);

    // Directional top-left raking sanctuary light for bas-relief stone carving
    vec3 L_rake = normalize(vec3(-0.58, -0.66, 0.48));
    float rakeDot = dot(N, L_rake);
    float rakeShade = clamp(0.83 + rakeDot * 0.30, 0.58, 1.15);

    // Ancient stone weathering: organic patina mottling + deep pitting + angular Voronoi rock cracks & dirt
    vec2 wp = v_worldPos.xy;
    float warpA =
      sin(wp.x * 2.1 + wp.y * 1.6) * 0.52 +
      cos(wp.x * 4.3 - wp.y * 3.1) * 0.28 +
      sin(wp.x * 8.7 + wp.y * 7.3) * 0.12;
    float warpB =
      cos(wp.y * 2.4 - wp.x * 1.8) * 0.52 +
      sin(wp.y * 4.9 + wp.x * 2.7) * 0.28 +
      cos(wp.y * 9.1 - wp.x * 6.5) * 0.12;
    float ageMottle = sin(wp.x * 1.75 + warpA) * cos(wp.y * 1.95 + warpB);
    float grainCoarse =
      sin(wp.x * 19.0 + cos(wp.y * 17.0) * 1.4) *
      cos(wp.y * 21.0 - sin(wp.x * 15.0) * 1.3) * 0.024;
    float grainFine =
      sin(wp.x * 49.0 + sin(wp.y * 37.0)) *
      cos(wp.y * 53.0 + sin(wp.x * 31.0)) * 0.018;
    float stonePitting =
      smoothstep(0.62, 0.95, sin(wp.x * 59.0 + warpA * 4.2) * cos(wp.y * 63.0 + warpB * 4.2)) * -0.064;
    float stoneGrain = grainCoarse + grainFine + stonePitting;

    // Angular Voronoi geological fractures (sharp jagged straight fissures & 3-way Y-junctions, zero loops)
    vec2 rockJag =
      vec2(sin(wp.y * 8.5 + wp.x * 5.2), cos(wp.x * 8.1 - wp.y * 5.8)) * 0.030 +
      vec2(sin(wp.y * 22.0 - wp.x * 14.0), cos(wp.x * 20.0 + wp.y * 16.0)) * 0.010;
    vec2 vorMajor = voronoiRockCrack(wp * 0.88 + rockJag);
    vec2 vorMinor = voronoiRockCrack(wp * 2.05 - rockJag * 1.35 + vec2(5.7, 3.1));

    float pxScale = clamp(fwidth(wp.x) * 0.85, 0.004, 0.028);
    float majorRegionMask = smoothstep(-0.08, 0.56, sin(wp.x * 0.95 - wp.y * 0.82 + 0.8) * cos(wp.y * 0.88 + wp.x * 0.64) + 0.24);
    float minorRegionMask = clamp(majorRegionMask * 0.85 + smoothstep(0.14, 0.0, vorMajor.x) * 0.65, 0.0, 1.0);

    // Wide dark eroded crack bevel + subsurface bloom + crisp anti-aliased inner fissure core
    float crackBloom = (1.0 - smoothstep(0.006, 0.148 + pxScale, vorMajor.x)) * majorRegionMask;
    float majorCrackValley = (1.0 - smoothstep(0.008, 0.076 + pxScale, vorMajor.x)) * majorRegionMask;
    float deepRelicCrack = (1.0 - smoothstep(0.0, 0.032 + pxScale, vorMajor.x)) * majorRegionMask;
    float mysticCrackCore =
      (1.0 - smoothstep(0.0, 0.018 + pxScale * 0.9, vorMajor.x)) * smoothstep(0.14, 0.64, majorRegionMask);
    float branchCrack =
      (1.0 - smoothstep(0.0, 0.024 + pxScale * 0.8, vorMinor.x)) * minorRegionMask * 0.68;
    float stoneCrack = clamp(majorCrackValley * 0.48 + deepRelicCrack * 0.65 + branchCrack, 0.0, 0.92);
    float shardTiltTone = (vorMajor.y - 0.5) * 0.055 + (vorMinor.y - 0.5) * 0.024;

    // Theme-matched desaturated mineral stone tint (cool slate-gray, warm sandstone, smoky basalt, etc.)
    vec3 stoneTint = dot(u_stoneTint, vec3(1.0)) > 0.1
      ? clamp(u_stoneTint, vec3(0.84), vec3(1.16))
      : vec3(1.0);

    // A. Recessed Carved Stone Bed vs. Chiseled Tablet Rim/Pillars (tinted gently by active theme)
    vec3 recessedBed = mix(vec3(0.188, 0.186, 0.194), vec3(0.242, 0.238, 0.244), radialWarmth) * stoneTint;
    vec3 chiseledFrame = mix(vec3(0.322, 0.318, 0.316), vec3(0.392, 0.386, 0.382), radialWarmth) * stoneTint;
    vec3 neutralStone = mix(recessedBed, chiseledFrame, isElevatedStone);
    neutralStone += vec3(0.022, 0.021, 0.020) * stoneTint * ageMottle + vec3(shardTiltTone * 0.65);
    neutralStone *= mix(1.0, 0.80, isSunkenRoom) * caveVignette;

    // B. Desaturated Mineral Stone Pieces (~98.5% weathered stone matched to active theme, zero punchy chroma)
    float pieceLum = dot(restoredRgb, vec3(0.299, 0.587, 0.114));
    float valueIndex = clamp(pieceLum * 0.62 + (restoredRgb.r * 0.21 + restoredRgb.g * 0.11 + restoredRgb.b * 0.06), 0.0, 1.0);
    vec3 darkSandstone = vec3(0.354, 0.350, 0.346) * stoneTint;
    vec3 paleLimestone = vec3(0.504, 0.498, 0.490) * stoneTint;
    vec3 quarryStone = mix(darkSandstone, paleLimestone, valueIndex);
    vec3 mineralPigment = mix(quarryStone, restoredRgb, 0.015);
    mineralPigment += vec3(0.024, 0.022, 0.021) * stoneTint * ageMottle + vec3(shardTiltTone);
    mineralPigment *= mix(1.0, 0.80, isSunkenRoom) * caveVignette;

    vec3 tabletSurface = mix(neutralStone, mineralPigment, isPiece) * rakeShade + vec3(stoneGrain);

    // Unearthed ancient dirt, earthy soot/moss grime blotches & spalled stone edges
    vec2 cellUv = fract(v_worldPos.xy);
    float borderDist = min(min(cellUv.x, 1.0 - cellUv.x), min(cellUv.y, 1.0 - cellUv.y));
    float dirtPatchLarge = smoothstep(-0.22, 0.68, sin(wp.x * 1.08 - wp.y * 0.92 + warpB * 1.65) * cos(wp.y * 1.28 + wp.x * 0.82 - warpA * 1.45));
    float dirtPatchFine = smoothstep(0.02, 0.80, sin(wp.x * 5.4 + warpA * 3.2) * cos(wp.y * 6.1 - warpB * 3.0));
    float edgeChipMask =
      (1.0 - smoothstep(0.012, 0.095, borderDist)) *
      smoothstep(0.08, 0.72, sin(wp.x * 13.5 + warpB * 4.0) * cos(wp.y * 14.5 - warpA * 4.0));
    float creviceGrime =
      (1.0 - smoothstep(0.008, 0.118, borderDist)) * mix(0.60, 0.40, isPiece) +
      smoothstep(0.95, 0.42, abs(N.z)) * 0.36 +
      majorCrackValley * 0.48;
    float grimeAmount = clamp(
      dirtPatchLarge * 0.42 + dirtPatchFine * 0.28 + creviceGrime * 0.48 + edgeChipMask * 0.46,
      0.0,
      0.84
    );
    vec3 sootUmber = vec3(0.092, 0.088, 0.092) * mix(vec3(1.0), stoneTint, 0.55);
    vec3 weatheredSilt = vec3(0.206, 0.200, 0.196) * stoneTint;
    vec3 ancientEarthDirt = mix(sootUmber, weatheredSilt, dirtPatchFine);
    tabletSurface = mix(tabletSurface, ancientEarthDirt, grimeAmount * 0.64);

    // 1. Dark Carved Mortar Joints, Chipped Edges & Deep Fracture Shadows
    float cellMortarGroove =
      (1.0 - smoothstep(0.016, 0.050, borderDist)) * mix(mix(0.48, 0.14, isElevatedStone), 0.10, isPiece);
    float innerInscribedGroove =
      (1.0 - smoothstep(0.006, 0.022, abs(borderDist - 0.108))) * isPiece * 0.10;
    float shadowBevelGroove =
      smoothstep(0.96, 0.50, abs(N.z)) * smoothstep(0.16, -0.48, rakeDot) * mix(0.46, 0.56, isPiece);
    float studCarveGroove =
      (v_localPos.z > 0.555 && N.z < 0.965) ? (0.40 * smoothstep(0.25, -0.45, rakeDot) + 0.18) : 0.0;

    float grooveDarkness = clamp(
      cellMortarGroove + innerInscribedGroove + shadowBevelGroove + studCarveGroove + stoneCrack + edgeChipMask * 0.32,
      0.0,
      0.82
    );
    tabletSurface *= (1.0 - grooveDarkness);

    // 2. Sunlit Limestone Chisel Catch-Lights & Broken Shard Lip Highlights
    float cleanHighlightMask = clamp(1.0 - grimeAmount * 0.58 - stoneCrack * 0.80, 0.16, 1.0);
    float litBevelCatch =
      smoothstep(0.96, 0.50, abs(N.z)) * smoothstep(-0.04, 0.55, rakeDot) * mix(0.30, 0.46, isPiece);
    float litStudCatch =
      (v_localPos.z > 0.56 && N.z < 0.965) ? (0.36 * smoothstep(-0.04, 0.55, rakeDot)) : 0.0;
    float innerRimCatch =
      (1.0 - smoothstep(0.006, 0.018, abs(borderDist - 0.090))) * isPiece * 0.05;
    float crackLipCatch =
      clamp(majorCrackValley - deepRelicCrack, 0.0, 1.0) * smoothstep(-0.05, 0.45, rakeDot) * 0.28;

    float cornerCross =
      (1.0 - smoothstep(0.010, 0.028, min(cellUv.x, 1.0 - cellUv.x))) *
      (1.0 - smoothstep(0.055, 0.135, min(cellUv.y, 1.0 - cellUv.y))) +
      (1.0 - smoothstep(0.010, 0.028, min(cellUv.y, 1.0 - cellUv.y))) *
      (1.0 - smoothstep(0.055, 0.135, min(cellUv.x, 1.0 - cellUv.x)));
    float masonTicks = clamp(cornerCross, 0.0, 1.0) * (1.0 - isPiece) * (1.0 - isElevatedStone) * 0.14;

    float hatchA = sin((v_worldPos.x + v_worldPos.y) * 46.0);
    float hatchB = sin((v_worldPos.x - v_worldPos.y) * 46.0);
    float chiselHatch =
      smoothstep(0.80, 0.97, hatchA) * mix(0.025, 0.075, isPiece) +
      smoothstep(0.88, 0.985, hatchB) * 0.04 * isPiece;

    float highlightStrength = clamp(
      (max(litBevelCatch, litStudCatch) + innerRimCatch + masonTicks + chiselHatch) * cleanHighlightMask + crackLipCatch,
      0.0,
      0.76
    );

    vec3 warmLimestoneHighlight = vec3(0.675, 0.665, 0.650) * mix(vec3(1.0), stoneTint, 0.78);
    vec3 stoneArtifact = mix(tabletSurface, warmLimestoneHighlight, highlightStrength);

    if (u_highContrast == 1) {
      vec3 hcStone = mix(neutralStone * 0.80, mix(quarryStone * 1.08, restoredRgb, 0.06) * rakeShade, isPiece);
      hcStone = mix(hcStone, ancientEarthDirt, grimeAmount * 0.45);
      hcStone *= (1.0 - grooveDarkness * 1.12);
      vec3 hcHighlight = clamp(vec3(0.90, 0.89, 0.88) * mix(vec3(1.0), stoneTint, 0.65), 0.0, 1.0);
      stoneArtifact = mix(hcStone, hcHighlight, clamp(highlightStrength * 1.15, 0.0, 0.90));
    }

    // 3. Pulsating Mystic Relic Glow (warm amethyst-orchid purple & sanctuary amber-gold with bloom + crepuscular rays)
    float animTime = max(u_boardInfo.z, 0.0);
    float isAnimated = step(0.0, u_boardInfo.z);
    float breathPrimary = mix(0.74, 0.5 + 0.5 * sin(animTime * 1.85), isAnimated);
    float breathWave = mix(0.70, 0.5 + 0.5 * sin(animTime * 2.30 - normDist * 2.8 + warpA * 0.8), isAnimated);
    float mysticPulse = mix(0.50, 1.0, breathPrimary * 0.64 + breathWave * 0.36);

    float leyToneMix = clamp(
      0.5 + 0.5 * sin(wp.x * 0.72 - wp.y * 0.68 + animTime * 0.46 * isAnimated + warpB * 0.7),
      0.0,
      1.0
    );
    vec3 arcanePurple = vec3(0.78, 0.34, 0.99);
    vec3 warmOrchid = vec3(0.96, 0.45, 0.84);
    vec3 arcaneGold = vec3(1.00, 0.75, 0.38);
    vec3 mysticColor = mix(
      mix(arcanePurple, warmOrchid, smoothstep(0.14, 0.72, leyToneMix)),
      arcaneGold,
      smoothstep(0.60, 1.0, leyToneMix) * 0.42
    );

    // Incandescent energy inside Voronoi fractures + wide subsurface bloom + subtle radial crepuscular light shafts.
    // Living-energy pulses (MYSTIC-RELIC-01): two drifting value-noise fields + a noise-phased heartbeat make each
    // fissure region throb independently from dim ember-dark to bright, as if something stirs inside the stone.
    float tA = animTime * isAnimated;
    float pulseField =
      relicNoise(wp * 0.58 + vec2(tA * 0.19, -tA * 0.14)) * 0.6 +
      relicNoise(wp * 1.42 - vec2(tA * 0.33, tA * 0.27) + 7.3) * 0.4;
    float heartbeat = mix(0.7, 0.5 + 0.5 * sin(tA * 1.9 + pulseField * 11.0), isAnimated);
    float crackPulse = 0.1 + 0.9 * smoothstep(0.22, 0.86, pulseField) * (0.5 + 0.5 * heartbeat);
    float crackLines = mysticCrackCore + branchCrack * 0.58;
    float crackGlow = crackLines * (0.18 + 1.12 * crackPulse);
    float crackHalo =
      (majorCrackValley * 0.44 + crackBloom * 0.32) * smoothstep(0.12, 0.64, majorRegionMask) * crackPulse;
    float rayTheta = atan(relCenter.y, relCenter.x);
    float rayShaft = pow(
      0.5 + 0.5 * sin(rayTheta * 5.0 - animTime * 0.28 * isAnimated + sin(rayTheta * 2.0 + 0.9)),
      2.3
    );
    float godRaySweep =
      rayShaft * (1.0 - smoothstep(0.10, 1.22, normDist)) * (0.07 + 0.26 * (crackBloom + mysticCrackCore) * crackPulse) * mysticPulse;

    float centerMask = exp(-normDist * normDist * 1.35);
    float mortarLey =
      (1.0 - smoothstep(0.004, 0.032, borderDist)) *
      (1.0 - isPiece * 0.78) *
      (0.10 + 0.22 * breathWave) *
      (0.32 + 0.68 * centerMask);
    float blockBaseUnderGlow =
      isPiece * smoothstep(0.38, 0.01, localWorldZ) * smoothstep(0.94, 0.30, abs(N.z)) * 0.44 * mysticPulse;
    float heartAura = centerMask * 0.12 * mysticPulse;
    float mysticRim = rim * (0.09 + 0.16 * mysticPulse) * caveVignette;

    float totalMysticGlow = clamp(
      crackGlow + crackHalo + godRaySweep + mortarLey + blockBaseUnderGlow + heartAura + mysticRim,
      0.0,
      1.18
    );
    stoneArtifact += mysticColor * totalMysticGlow;
    stoneArtifact = mix(
      stoneArtifact,
      vec3(1.0, 0.89, 0.99),
      clamp(crackGlow * crackPulse * 0.5, 0.0, 0.5)
    );

    lit = mix(lit, stoneArtifact, u_blueprintMix);
    // Relic Awakening surge (RELIC-AWAKEN-01): every fissure blazes in the crack-glow palette (mysticColor)
    // while a bright radial transmutation wave of the same amethyst-orchid-gold light sweeps outward.
    float awaken = (1.0 - u_blueprintMix) * step(u_blueprintMix, 0.998);
    float waveDist = normDist - awaken * 1.7;
    float wave = exp(-waveDist * waveDist * 30.0) * smoothstep(0.0, 0.06, awaken);
    float flare = sin(clamp(awaken * 1.4, 0.0, 1.0) * 3.14159265);
    float awakenGlow = (wave * 0.78 + (crackLines * 1.25 + crackHalo * 0.6) * flare) * step(0.001, awaken);
    lit += mysticColor * awakenGlow;
    lit = mix(lit, vec3(1.0, 0.9, 0.99), clamp(crackLines * flare * 0.55, 0.0, 0.6) * step(0.001, awaken));
    // Keep opaque 3D stone geometry 100% solid (blueprintAlpha = 1.0) so plinth, floor, walls,
    // and blocks never alpha-bleed through one another like a ghosted rendering error.
    blueprintAlpha = 1.0;
  }

  outColor = vec4(clamp(lit, 0.0, 1.0), u_color.a * blueprintAlpha);
}
`;

export function createShaderProgram(
  gl: WebGL2RenderingContext,
  vsSource: string,
  fsSource: string
): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }

  const prog = gl.createProgram();
  if (!prog) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.detachShader(prog, vs);
  gl.detachShader(prog, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

export function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s);
    return null;
  }
  return s;
}

export function createMeshHandle(gl: WebGL2RenderingContext, mesh: MeshData): GLMeshHandle {
  const vao = gl.createVertexArray();
  const posBuffer = gl.createBuffer();
  const normBuffer = gl.createBuffer();
  const uvBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  if (!vao || !posBuffer || !normBuffer || !uvBuffer || !indexBuffer) {
    throw new Error('Failed to allocate WebGL2 mesh buffers');
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, normBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.uvs, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  return {
    vao,
    posBuffer,
    normBuffer,
    uvBuffer,
    indexBuffer,
    indexCount: mesh.indices.length,
  };
}

export interface ParticleInstancedVaoHandle {
  vao: WebGLVertexArrayObject;
  posBuf: WebGLBuffer;
  normBuf: WebGLBuffer;
  idxBuf: WebGLBuffer;
  instBuf: WebGLBuffer;
  indexCount: number;
}

export function createParticleInstancedVao(
  gl: WebGL2RenderingContext,
  instanceByteLength: number
): ParticleInstancedVaoHandle | null {
  const cube = ENVIRONMENT_MESHES.unitParticleCube;
  const vao = gl.createVertexArray();
  const posBuf = gl.createBuffer();
  const normBuf = gl.createBuffer();
  const idxBuf = gl.createBuffer();
  const instBuf = gl.createBuffer();
  if (!vao || !posBuf || !normBuf || !idxBuf || !instBuf) return null;

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, cube.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
  gl.bufferData(gl.ARRAY_BUFFER, cube.normals, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cube.indices, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, instanceByteLength, gl.DYNAMIC_DRAW);

  const strideBytes = INSTANCE_STRIDE * 4;
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, strideBytes, 0);
  gl.vertexAttribDivisor(3, 1);

  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 4, gl.FLOAT, false, strideBytes, 16);
  gl.vertexAttribDivisor(4, 1);
  gl.bindVertexArray(null);

  return { vao, posBuf, normBuf, idxBuf, instBuf, indexCount: cube.indices.length };
}
