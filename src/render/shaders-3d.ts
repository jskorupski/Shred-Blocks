import type { MeshData } from './mesh-generator';
import type { GLMeshHandle } from './render-types';

export { MAIN_VERTEX_SHADER } from './shaders-main-vertex';

import { GLSL_STONE_LIB } from './shaders-glsl-lib';
import {
  GLSL_RELIC_CRUST_PRECHECK,
  GLSL_RELIC_CRUST_SHADE,
  GLSL_RELIC_PLATE_STYLE,
} from './shaders-relic-crust';
import { GLSL_TRAY_MATERIALS } from './shaders-tray-materials';

export {
  createParticleInstancedVao,
  createSmokeBillboardInstancedVao,
  PARTICLE_FRAGMENT_SHADER,
  PARTICLE_VERTEX_SHADER,
  type ParticleInstancedVaoHandle,
} from './shaders-particles';

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
uniform int u_materialStyle; // 0=standard, 1=gummy, 2=wood, 3=neon, 4=unlit_overlay, 5=tray_floor, 6=relic_stone, 7=tray_wall, 8=trace, 9=plasma_arc
uniform sampler2D u_atlas;
uniform sampler2D u_relicClusterTex;
uniform float u_blueprintMix;
uniform vec3 u_boardInfo; // x = cols * 0.5, y = rows * 0.5, z = timeSec
uniform vec3 u_stoneTint;
uniform int u_trayMaterial; // TRAY-IDENTITY-01: 0 slate, 1 birch planks, 2 obsidian grid, 3 frost crystal, 4 jade terrazzo
uniform float u_blockSeed; // BLOCK-STONE-01: integer per-block seed (offsets the rune/chip cell grid) // subtle mineral tint multiplier from equipped tray + skin
uniform int u_highContrast;
uniform int u_traceCount;
uniform vec4 u_tracePts[16]; // xy = board pos, z = 0..1 sub-curve progress, w = halfWidth

out vec4 outColor;

${GLSL_STONE_LIB}
${GLSL_TRAY_MATERIALS}

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

  if (u_materialStyle == 8) {
    // MYSTIC-TRACE-01: Single-quad rounded capsule-spline motion blur + exact polyomino leading-silhouette mask
    if (u_traceCount < 2) { discard; }
    vec2 p = v_worldPos.xy;
    int segCount = min(u_traceCount - 1, 15);
    float span = max(u_tracePts[segCount].z, 0.08);
    float taperLen = min(span * 0.84, max(0.42, min(span * 0.68, 2.35)));
    float tailBaseHw = u_tracePts[0].w;
    float tipMinScale = clamp(0.15 + max(0.0, tailBaseHw - taperLen * 0.85) * 0.24, 0.15, 0.42);

    float segNormD[15];
    float segArcS[15];
    float dMin = 99.0;
    vec2 blockSpan = max(u_clipPlane.zw, vec2(1.0));
    float tailCap = max(tailBaseHw * tipMinScale, 0.06);
    for (int i = 0; i < 15; i++) {
      if (i >= segCount) break;
      vec4 a = u_tracePts[i];
      vec4 b = u_tracePts[i + 1];
      vec2 ab = b.xy - a.xy;
      float segLen = sqrt(max(dot(ab, ab), 1e-5));
      vec2 dir = ab / segLen;
      float rawProj = dot(p - a.xy, dir);
      float h = clamp(rawProj / segLen, 0.0, 1.0);
      vec2 dVec = p - (a.xy + dir * (h * segLen));
      float sClamped = mix(a.z, b.z, h);
      float taperT = clamp(sClamped / max(taperLen, 1e-4), 0.0, 1.0);
      float widthScale = mix(tipMinScale, 1.0, smoothstep(0.0, 1.0, pow(taperT, 0.66)));
      float hw = max(mix(a.w, b.w, h) * widthScale, 0.06);
      float along = dot(dVec, dir);
      vec2 latVec = dVec - dir * along;
      float alongHalf = 0.5 * (abs(dir.x) * blockSpan.x + abs(dir.y) * blockSpan.y);
      float endCap = min(hw, max(0.32, alongHalf * 0.84));
      float jointCap = min(hw, min(blockSpan.x, blockSpan.y) * 0.44);
      bool isOuterEnd = (i == 0 && along < 0.0) || (i == segCount - 1 && along >= 0.0);
      float longCap = isOuterEnd ? endCap : jointCap;
      if (i == 0 && along < 0.0) { tailCap = longCap; }
      float nd = sqrt(dot(latVec, latVec) / (hw * hw) + (along * along) / (longCap * longCap));
      segNormD[i] = nd;
      segArcS[i] = (i == 0 && rawProj < 0.0) ? (a.z + rawProj) : ((i == segCount - 1 && rawProj > segLen) ? (b.z + (rawProj - segLen)) : sClamped);
      dMin = min(dMin, nd);
    }
    if (dMin >= 1.0) { outColor = vec4(0.0); return; }

    float leadMask = 1.0;
    int headMask = int(u_blockSeed + 0.5);
    if (headMask > 0) {
      vec2 hAb = u_tracePts[segCount].xy - u_tracePts[segCount - 1].xy;
      vec2 headDir = hAb / sqrt(max(dot(hAb, hAb), 1e-5));
      vec2 headCenter = u_clipPlane.xy + u_clipPlane.zw * 0.5;
      float frontWeight = smoothstep(-0.38, 0.0, dot(p - headCenter, headDir));
      if (frontWeight > 0.001) {
        float bestShadowD = 99.0;
        float dDiff = headDir.x - headDir.y;
        float dSum = headDir.x + headDir.y;
        for (int cIdx = 0; cIdx < 16; cIdx++) {
          if ((headMask & (1 << cIdx)) == 0) continue;
          vec2 q = (u_clipPlane.xy + vec2(float(cIdx & 3) + 0.5, float(cIdx >> 2) + 0.5)) - p;
          float fMin = max(abs(q.x), abs(q.y));
          if (abs(headDir.x) > 1e-4) { float tx = max(0.0, q.x / headDir.x); fMin = min(fMin, max(abs(q.x - tx * headDir.x), abs(q.y - tx * headDir.y))); }
          if (abs(headDir.y) > 1e-4) { float ty = max(0.0, q.y / headDir.y); fMin = min(fMin, max(abs(q.x - ty * headDir.x), abs(q.y - ty * headDir.y))); }
          if (abs(dDiff) > 1e-4) { float t1 = max(0.0, (q.x - q.y) / dDiff); fMin = min(fMin, max(abs(q.x - t1 * headDir.x), abs(q.y - t1 * headDir.y))); }
          if (abs(dSum) > 1e-4) { float t2 = max(0.0, (q.x + q.y) / dSum); fMin = min(fMin, max(abs(q.x - t2 * headDir.x), abs(q.y - t2 * headDir.y))); }
          bestShadowD = min(bestShadowD, fMin - 0.46);
        }
        leadMask = mix(1.0, smoothstep(0.02, -0.18, bestShadowD), frontWeight);
      }
    }
    if (leadMask < 0.002) { outColor = vec4(0.0); return; }

    float wSum = 0.0;
    float sSum = 0.0;
    for (int i = 0; i < 15; i++) {
      if (i >= segCount) break;
      float w = exp(-14.0 * (segNormD[i] - dMin));
      wSum += w;
      sSum += w * segArcS[i];
    }
    float smoothS = sSum / max(wSum, 1e-5);
    float smoothU = clamp(smoothS / span, 0.0, 1.0);
    float tailT = clamp((smoothS + tailCap) / max(taperLen + tailCap, 1e-4), 0.0, 1.0);
    float crossProfile = pow(smoothstep(1.0, mix(0.0, 0.14, tailT), dMin), mix(1.58, 0.96, tailT));
    float tailRise = pow(smoothstep(0.0, 1.0, tailT), 1.32);
    float coreMix = smoothstep(0.78, 0.0, dMin) * tailRise * (0.42 + 0.58 * smoothU) * 0.64;
    vec3 smearRgb = mix(u_color.rgb, u_capColor, coreMix);
    if (u_blueprintMix > 0.001) { smearRgb = mix(smearRgb, vec3(0.82, 0.72, 0.58), u_blueprintMix * 0.88); }
    float alpha = u_color.a * crossProfile * tailRise * leadMask * mix(1.0, 0.52, u_blueprintMix);
    if (alpha < 0.003) { outColor = vec4(0.0); return; }
    outColor = vec4(smearRgb, alpha);
    return;
  }

  if (u_materialStyle == 9) {
    // SHRED-STYLE-01: Single-quad volumetric plasma bolt tree (u_traceCount >= 1) & gate-jaw corona flash (u_traceCount <= 0)
    if (u_traceCount <= 0) {
      float halfLen = u_clipPlane.x;
      float rad = max(u_clipPlane.y, 0.02);
      vec2 q = (v_uv - 0.5) * vec2(halfLen * 2.0 + rad * 2.0, rad * 2.0);
      float dx = q.x - clamp(q.x, -halfLen, halfLen);
      float d = length(vec2(dx, q.y)) / rad;
      if (d >= 1.0) { outColor = vec4(0.0); return; }
      float bloom = pow(1.0 - d, 2.2);
      float sheath = exp(-d * d * 7.5) * (1.0 - d);
      float core = exp(-d * d * 32.0) * (1.0 - d) * u_clipPlane.z;
      vec3 glowCol = mix(u_color.rgb, u_capColor, 0.42);
      vec3 col = mix(glowCol, vec3(0.98, 0.995, 1.0), clamp(core * 1.15, 0.0, 1.0));
      float alpha = clamp(u_color.a * (bloom * 0.54 + sheath * 0.42 + core * 0.65), 0.0, 1.0) * mix(1.0, 0.45, u_blueprintMix);
      outColor = vec4(clamp(col, 0.0, 1.0), alpha);
      return;
    }
    vec2 p = v_worldPos.xy;
    int segCount = min(u_traceCount, 8);
    float tArc = u_boardInfo.z >= 0.0 ? (u_boardInfo.z * 28.0 + u_clipPlane.w) : u_clipPlane.w;
    float dMin = 99.0;
    float bestArc = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= segCount) break;
      vec4 a = u_tracePts[i * 2];
      vec4 b = u_tracePts[i * 2 + 1];
      vec2 ab = b.xy - a.xy;
      float segLen = sqrt(max(dot(ab, ab), 1e-5));
      vec2 dir = ab / segLen;
      vec2 perp = vec2(-dir.y, dir.x);
      float h = clamp(dot(p - a.xy, dir) / segLen, 0.0, 1.0);
      float glowR = max(mix(a.w, b.w, h), 0.025);
      float fi = float(i);
      float pin = sin(h * 3.14159265);
      // Crisp angular triangle-wave micro-jags (never sinusoidal curls)
      float triA = abs(fract(h * 2.0 + fi * 0.37) * 2.0 - 1.0) * 2.0 - 1.0;
      float jitterFlip = sin(tArc + fi * 2.3);
      float microJag = pin * triA * jitterFlip * glowR * 0.11;
      float nd = length(p - (a.xy + dir * (h * segLen) + perp * microJag)) / glowR;
      if (nd < dMin) {
        dMin = nd;
        bestArc = mix(a.z, b.z, h);
      }
    }
    if (dMin >= 1.0) { outColor = vec4(0.0); return; }
    float pulseDist = (bestArc - u_clipPlane.x) * 4.4;
    float surgeWave = exp(-pulseDist * pulseDist) * u_clipPlane.y;
    float rootMask = u_clipPlane.z > 0.001 ? smoothstep(u_clipPlane.z - 0.14, u_clipPlane.z + 0.24, bestArc) : 1.0;
    float tipTaper = smoothstep(1.04, 0.68, bestArc) * 0.38 + 0.62;
    // Wide saturated electric corona + tight mid-sheath + razor-sharp white spine that flares with surgeWave
    float corona = pow(1.0 - dMin, 2.05);
    float sheath = exp(-dMin * dMin * mix(20.0, 10.0, surgeWave)) * (1.0 - dMin);
    float core = exp(-dMin * dMin * mix(155.0, 32.0, surgeWave)) * (1.0 - dMin);
    vec3 outerHue = mix(u_color.rgb, u_capColor, 0.38);
    vec3 midHue = mix(u_color.rgb, mix(vec3(0.32, 0.92, 1.0), vec3(1.0, 0.94, 0.58), step(0.65, u_color.r)), 0.58);
    vec3 col = mix(outerHue, midHue, clamp(sheath * 1.3, 0.0, 1.0));
    float hotness = clamp(u_color.a * (0.82 + 0.45 * surgeWave), 0.0, 1.0);
    col = mix(col, vec3(0.99, 0.998, 1.0), clamp(core * (1.1 + 0.5 * surgeWave) * hotness * hotness, 0.0, 1.0));
    float intensity = (corona * 0.54 + sheath * 0.56 + core * (0.88 + 0.45 * surgeWave)) * (0.78 + 0.56 * surgeWave) * rootMask * tipTaper;
    float alpha = clamp(u_color.a * intensity, 0.0, 1.0) * mix(1.0, 0.45, u_blueprintMix);
    if (alpha < 0.003) { outColor = vec4(0.0); return; }
    outColor = vec4(clamp(col, 0.0, 1.0), alpha);
    return;
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

  if (u_materialStyle == 10) {
    vec2 q = (v_uv - 0.5) * 2.0;
    float d = length(q), hasGold = step(0.01, u_clipPlane.w), innerD = mix(0.50, 0.64, hasGold);
    if (d <= innerD || d >= 1.0) { outColor = vec4(0.0); return; }
    float wake = pow(sin(((d - innerD) / (1.0 - innerD)) * 3.14159265), 1.6), ang = atan(q.y, q.x);
    float fan = mix(1.0, u_clipPlane.z + (1.0 - u_clipPlane.z) * smoothstep(-0.55, 0.45, dot(q / d, u_clipPlane.xy)), step(0.05, dot(u_clipPlane.xy, u_clipPlane.xy)));
    float shimmer = 0.5 + 0.31 * sin(ang * 5.0 + u_clipPlane.w) + 0.19 * sin(ang * 11.0 - u_clipPlane.w * 1.35);
    vec3 baseRgb = mix(u_color.rgb, min(vec3(1.0), u_color.rgb * 0.76 + 0.34), wake * 0.38);
    float glint = shimmer * shimmer * wake;
    vec3 goldRgb = mix(u_capColor, vec3(1.0, 0.96, 0.82), shimmer * 0.48);
    vec3 waveRgb = mix(baseRgb, goldRgb, hasGold * 0.56 * glint);
    outColor = vec4(waveRgb, min(1.0, u_color.a * (1.0 + hasGold * 0.28 * glint)) * wake * fan * mix(1.0, 0.52, u_blueprintMix));
    return;
  }

${GLSL_RELIC_PLATE_STYLE}

  vec3 N = normalize(v_normal);
  vec3 L1 = normalize(vec3(-0.35, -0.55, 0.76));
  vec3 L2 = normalize(vec3(0.45, 0.35, 0.82));
  vec3 V = normalize(vec3(0.0, 0.21, 0.97));
  vec3 H = normalize(L1 + V);

  float diff1 = max(dot(N, L1), 0.0);
  float diff2 = max(dot(N, L2), 0.0) * 0.28;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);
  float localPxW = fwidth(v_localPos.x);

${GLSL_RELIC_CRUST_PRECHECK}

  vec3 lit = vec3(0.0);
  if (needGameplayLit) {
  vec3 base = u_color.rgb;
  float specPower = 28.0;
  float specStrength = 0.26;
  vec3 emissive = vec3(0.0);

  if (u_materialStyle == 1) {
    // gummy_jelly (GUMMY-01): rich translucent candy. Saturated syrup rim around each cell & bevel melts into a
    // glowing subsurface core at the cell center, topped with a glossy wet candy highlight and tiny air bubbles.
    vec2 gCell = fract(v_localPos.xy);
    float cellEdgeD = min(min(gCell.x, 1.0 - gCell.x), min(gCell.y, 1.0 - gCell.y));
    float coreT = smoothstep(0.04, 0.42, cellEdgeD) * smoothstep(0.35, 0.95, N.z);
    float hcG = u_highContrast == 1 ? 0.45 : 1.0;
    vec3 syrupEdge = base * mix(1.0, 0.72, hcG);
    vec3 jellyCore = min(vec3(1.0), base * 1.16 + vec3(0.11) * hcG);
    base = mix(syrupEdge, jellyCore, coreT);
    // Glossy candy dome catch-light near top-left of each cell + tiny trapped bubbles
    float glossSpot = (1.0 - smoothstep(0.04, 0.22, length(gCell - vec2(0.3, 0.3)))) * smoothstep(0.85, 0.96, N.z);
    vec2 bq = v_localPos.xy * 5.2 + v_localPos.z * 2.5;
    vec2 bh = hashRelic22(floor(bq) + 21.0);
    vec2 bRel = fract(bq) - 0.5 - (bh - 0.5) * 0.4;
    float bd = length(bRel);
    float bubbleOn = step(0.8, bh.x) * hcG;
    float bubRim = bubbleOn * (1.0 - smoothstep(0.0, 0.028, abs(bd - 0.1)));
    float bubGlint = bubbleOn * (1.0 - smoothstep(0.0, 0.032, length(bRel + vec2(0.04, 0.04))));
    base = clamp(base + vec3(glossSpot * 0.26 * hcG + bubRim * 0.24 + bubGlint * 0.42 + rim * 0.18), 0.0, 1.0);
    emissive = base * 0.06 * coreT;
    specPower = 88.0;
    specStrength = u_highContrast == 1 ? 0.48 : 0.75;
  } else if (u_materialStyle == 2) {
    // carved_wood (WOOD-GRAIN-01): per-block seeded plank cut/angle/offset + deeply stained hand-rubbed hardwood
    vec2 seedH = hashRelic22(vec2(u_blockSeed * 1.37 + 3.1, u_blockSeed * 2.91 + 11.7));
    vec2 wp0 = fract(u_blockSeed * 0.618034) >= 0.5 ? v_localPos.yx : v_localPos.xy;
    float wAng = (seedH.x - 0.5) * 0.30, cA = cos(wAng), sA = sin(wAng);
    vec2 wq = mat2(cA, -sA, sA, cA) * wp0 + vec2(19.7, 13.3) * u_blockSeed + seedH * 17.0;
    float figureWarp = relicNoise(vec2(wq.x * 0.55, wq.y * 1.8) + 3.7) * 1.1 + relicNoise(vec2(wq.x * 1.6, wq.y * 4.0)) * 0.3;
    vec2 knotCell = floor(wq * vec2(0.46, 0.68));
    vec2 knotPos = (knotCell + 0.25 + 0.5 * hashRelic22(knotCell + 17.0)) / vec2(0.46, 0.68);
    vec2 knotRel = (wq - knotPos) * vec2(0.8, 1.7);
    float knotDist = length(knotRel), hasKnot = step(0.66, hashRelic22(knotCell + 5.0).x);
    float knotBend = hasKnot * 0.55 * exp(-knotDist * knotDist * 9.0) * sign(knotRel.y + 1e-4);
    float ringCoord = wq.y * (8.6 + seedH.y * 3.8) + figureWarp * 2.2 + (v_localPos.z - 0.3) * 3.0 + knotBend * 6.0, ringPhase = fract(ringCoord);
    float latewood = smoothstep(0.78, 0.9, ringPhase) * (1.0 - smoothstep(0.95, 1.0, ringPhase)), earlywood = 1.0 - latewood;
    float fibers = relicNoise(vec2(wq.x * 3.0, wq.y * 140.0 + figureWarp * 30.0)) - 0.5;
    float pores = smoothstep(0.7, 0.93, relicNoise(vec2(wq.x * 10.0, wq.y * 210.0 + figureWarp * 40.0)));
    float streak = relicNoise(vec2(wq.x * 0.5, wq.y * 9.0 + figureWarp)) - 0.5;
    float knotRings = hasKnot * exp(-knotDist * knotDist * 22.0) * (0.5 + 0.5 * sin(knotDist * 70.0));
    float knotCore = hasKnot * (1.0 - smoothstep(0.07, 0.14, knotDist)), knotHalo = hasKnot * exp(-knotDist * knotDist * 14.0) * 0.6;
    float hcW = float(u_highContrast), woodAmp = mix(1.0, 0.45, hcW), lumaW = dot(base, vec3(0.299, 0.587, 0.114));
    vec3 dyeW = mix(vec3(lumaW), base, mix(0.78, 0.90, hcW));
    vec3 stained = clamp(dyeW * mix(0.74, 0.84, hcW) + vec3(0.34, 0.23, 0.14) * mix(0.13, 0.08, hcW) * (0.55 + 0.45 * lumaW), 0.0, 1.0);
    float darkPool = clamp((latewood * 0.22 + pores * 0.09 + knotHalo * 0.18 + knotRings * 0.14 + knotCore * 0.48) * woodAmp, 0.0, 0.72);
    vec3 deepGrain = stained * stained * vec3(0.64, 0.52, 0.40) + vec3(0.026, 0.015, 0.006);
    float edgeRub = clamp(v_uv.x, 0.0, 1.0) * 0.06 * (1.0 - hcW * 0.5);
    base = clamp(mix(stained, deepGrain, darkPool) * (1.0 + (fibers * 0.07 + streak * 0.10) * woodAmp - edgeRub), 0.0, 1.0);
    specPower = 18.0;
    specStrength = 0.065 + earlywood * 0.035;
  } else if (u_materialStyle == 6) {
    // relic_stone (BLOCK-STONE-01, default skin): smoothly worn-down, aged colored stone (terracotta sandstone,
    // lapis bluestone, celadon jadeite, ochre travertine) with fine mineral speckle, tiny sparse pores, a faint
    // mineral vein, softly bleached chalky edges/corners in the stone's own hue, and shallow worn-down markings.
    vec2 bp = v_localPos.xy + vec2(13.0, 7.0) * u_blockSeed;
    float sAmp6 = u_highContrast == 1 ? 0.42 : 1.0;
    float faceNz = N.z;
    float isTopFace = smoothstep(0.86, 0.96, faceNz) * step(0.45, v_localPos.z);
    float edgeProx = clamp(max(v_uv.x, (1.0 - isTopFace) * 0.86), 0.0, 1.0);
    float cornerProx = clamp(v_uv.y, 0.0, 1.0);
    float wornBand = clamp((v_localPos.z - (0.58 - 0.16)) / 0.16, 0.0, 1.0);
    // Gentle hand-worn stone undulation + rounded worn chamfers (extra-rounded at outer polyomino corners)
    float undX = relicNoise(bp * 2.1 + 5.3) - 0.5;
    float undY = relicNoise(bp * 2.1 + 19.7) - 0.5;
    if (faceNz < 0.95 && wornBand > 0.0) {
      vec3 sideN = normalize(vec3(N.xy, 0.0001));
      float roundT = wornBand * wornBand * (3.0 - 2.0 * wornBand);
      N = normalize(mix(N, normalize(mix(sideN, vec3(0.0, 0.0, 1.0), roundT)), 0.55 + cornerProx * 0.20));
    }
    N = normalize(N + vec3(undX, undY, 0.0) * 0.11 * sAmp6);
    diff1 = max(dot(N, L1), 0.0);
    diff2 = max(dot(N, L2), 0.0) * 0.28;
    rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);

    float pxw = localPxW;
    float pxFade = clamp(1.25 - pxw * 18.0, 0.25, 1.0);
    // Fine salt-and-pepper mineral grit + sparse tiny needle-pores (subtle & smooth, zero crunchy gravel!)
    float grainLow = undX * 0.65 + undY * 0.35;
    float grainMed = relicNoise(bp * 21.0 + v_localPos.z * 7.0 + 3.1) - 0.5;
    float grainFine = relicNoise(bp * 50.0 + v_localPos.z * 16.0 + 7.4) - 0.5;
    float pinPore = smoothstep(0.83, 0.94, relicNoise(bp * 31.0 + v_localPos.z * 10.0 + 53.0)) * pxFade;
    // Faint mineral vein / hairline age crack meandering subtly across part of the block
    float crackField = relicNoise(bp * 1.75 + grainMed * 0.20 + 11.0) - 0.5;
    float hairline =
      (1.0 - smoothstep(0.0, 0.008 + pxw * 0.85, abs(crackField))) * smoothstep(0.06, 0.38, grainLow + 0.16);

    vec3 carve = stoneRelief(
      bp,
      v_localPos.z,
      isTopFace,
      edgeProx,
      cornerProx,
      normalize(-L1.xy),
      grainLow,
      grainMed,
      pxw
    );
    float edgeNick = carve.x;
    float runeGroove = carve.y;
    float raking = carve.z * sAmp6;

    // Matte mineral reflectance (~0.83 albedo prevents 1.16x top lighting from clipping bright yellow/red/green to 1.0,
    // preserving fine sandstone/limestone grain & aged patina across every block color)
    float baseLum = dot(base, vec3(0.299, 0.587, 0.114));
    vec3 stoneTint6 = dot(u_stoneTint, vec3(1.0)) > 0.1 ? clamp(u_stoneTint, vec3(0.92), vec3(1.08)) : vec3(1.0);
    vec3 warmNeutral = vec3(baseLum) * vec3(1.04, 1.00, 0.92) * stoneTint6;
    float matteReflectance = u_highContrast == 1 ? 0.94 : 0.83;
    vec3 stoneBody = mix(base, warmNeutral, 0.26 * sAmp6) * matteReflectance;
    vec3 wornChalk = mix(
      stoneBody * 1.12 + vec3(0.11, 0.10, 0.085),
      mix(vec3(0.50, 0.48, 0.44), vec3(0.76, 0.73, 0.68), clamp(baseLum * 0.72 + 0.22, 0.0, 1.0)) * stoneTint6,
      0.56
    );
    float wearPatch = clamp(0.5 + grainLow * 0.85 + grainMed * 0.52, 0.05, 1.0);
    float bevelWear = smoothstep(0.44, 0.86, edgeProx + (wearPatch - 0.5) * 0.32 + cornerProx * 0.28);
    float chalkMix = clamp(
      bevelWear * 0.48 + cornerProx * 0.24 + edgeNick * 0.42 + runeGroove * 0.14,
      0.0,
      0.76
    ) * mix(1.0, 0.35, float(u_highContrast));
    vec3 pigment = mix(stoneBody, wornChalk, chalkMix);

    float patinaCloud = smoothstep(-0.10, 0.34, undY * 0.75 - undX * 0.55);
    float mineralTex =
      1.0 +
      (grainLow * 0.06 + grainMed * 0.085 + grainFine * 0.075 * pxFade - pinPore * 0.16 - patinaCloud * 0.07) *
        sAmp6;
    float basalPatina = smoothstep(0.30, 0.0, v_localPos.z) * (1.0 - isTopFace) * 0.25;
    float recessShade = clamp(
      runeGroove * 0.125 + edgeNick * 0.26 + hairline * 0.18 + pinPore * 0.09 + patinaCloud * 0.04 + basalPatina,
      0.0,
      0.50
    ) * mix(1.0, 0.55, float(u_highContrast));
    vec3 agedCrevice = mix(stoneBody * 0.38, vec3(0.14, 0.13, 0.12) * stoneTint6, 0.35);
    base = mix(pigment * mineralTex, agedCrevice, recessShade);
    base = clamp(base * (1.0 + raking), 0.0, 1.0);
    specPower = 9.0;
    specStrength = 0.015;
  } else if (u_materialStyle == 3) {
    // neon_cyber (NEON-CYBER-01): dark hue-tinted obsidian glass, pure-wavelength neon bevels/rims, and PCB traces
    vec3 lpN = v_localPos;
    float isTop3 = smoothstep(0.86, 0.96, N.z) * step(0.45, lpN.z);
    float hc3 = float(u_highContrast);
    float peakC = max(base.r, max(base.g, base.b));
    vec3 unitHue = base / max(peakC, 1e-4);
    float isWarm = step(0.85, unitHue.r) * (1.0 - step(0.22, unitHue.b));
    float canaryLift = smoothstep(0.70, 0.82, unitHue.g) * isWarm;
    float orangeDeep = smoothstep(0.35, 0.45, unitHue.g) * (1.0 - smoothstep(0.56, 0.69, unitHue.g)) * isWarm;
    vec3 sharpHue = clamp(pow(unitHue, vec3(1.26, 1.12, 1.30)) + vec3(-canaryLift * 0.02, canaryLift * 0.20 - orangeDeep * 0.03, canaryLift * 0.02 - orangeDeep * 0.03), 0.0, 1.0);
    vec3 neonCol = sharpHue * clamp(peakC * 1.10, 0.68, 1.0);
    vec3 R = reflect(-V, N);
    float sky = smoothstep(-0.2, 0.95, R.y * 0.55 + R.z * 0.45);
    float coreMul = mix(0.165, 0.215, hc3);
    base = vec3(0.011, 0.012, 0.020) + neonCol * (coreMul + sky * 0.042);
    float bevelEdge = (1.0 - smoothstep(0.8, 0.95, N.z)) * smoothstep(0.08, 0.38, N.z);
    float sideGlow = (1.0 - smoothstep(0.05, 0.30, abs(N.z))) * smoothstep(0.06, 0.52, lpN.z) * 0.28;
    float outerRim = pow(clamp(v_uv.x, 0.0, 1.0), 2.85) * isTop3 * mix(0.52, 0.40, hc3);
    vec2 gq = lpN.xy * 4.0;
    vec2 gf = fract(gq) - 0.5, gh = hashRelic22(floor(gq) + 9.0);
    float lineD = mix(abs(gf.x), abs(gf.y), step(0.5, gh.x)), padD = length(gf), traceAA = localPxW * 6.0;
    float trace = (1.0 - smoothstep(0.048, 0.048 + traceAA, lineD)) * step(0.35, gh.y);
    float pad = (1.0 - smoothstep(0.115, 0.115 + traceAA, padD)) * step(0.82, gh.y);
    float halo = (exp(-lineD * 13.0) * step(0.35, gh.y) * 0.24 + exp(-padD * 10.0) * step(0.82, gh.y) * 0.22) * isTop3;
    float tN = max(u_boardInfo.z, 0.0) * step(0.0, u_boardInfo.z);
    float pulse = 0.64 + 0.36 * smoothstep(0.70, 1.0, fract(lpN.x * 0.35 + lpN.y * 0.2 - tN * 0.45));
    float circuit = clamp(trace + pad, 0.0, 1.0) * isTop3;
    float sheenBand = 1.0 - smoothstep(0.0, 0.15, abs(fract((v_worldPos.x + v_worldPos.y) * 0.16 + 0.1) - 0.5));
    base += mix(neonCol, vec3(0.94, 0.97, 1.0), 0.35) * (sheenBand * isTop3 * mix(0.075, 0.045, hc3) + rim * 0.12);
    emissive = neonCol * (bevelEdge * 1.08 + outerRim + sideGlow + halo * pulse * mix(1.0, 0.72, hc3)) + mix(neonCol, min(vec3(1.0), neonCol * 1.08 + 0.14), 0.25) * (circuit * 1.02 * pulse * mix(1.0, 0.76, hc3));
    specPower = 104.0;
    specStrength = 0.48;
  } else if (u_materialStyle == 5 || u_materialStyle == 7) {
    // Board Tray surfaces (TRAY-IDENTITY-01): 5 = floor tiles, 7 = walls / plinth / pillars
    if (u_trayMaterial == 0) {
      // Industrial Slate (STONE-FLOOR-01): fast cleft slate flagstones & dressed ashlar (zero Voronoi loops)
      vec2 sp = v_worldPos.xy + v_worldPos.z * vec2(0.7, 1.3);
      float sMottle = relicNoise(sp * 1.2) * 0.6 + relicNoise(sp * 4.2 + 4.7) * 0.4 - 0.5;
      vec2 cellF0 = fract(v_worldPos.xy);
      float joint0 = (u_materialStyle == 5)
        ? (1.0 - smoothstep(0.0, 0.036, min(min(cellF0.x, 1.0 - cellF0.x), min(cellF0.y, 1.0 - cellF0.y))))
        : 0.0;
      float sAmp = u_highContrast == 1 ? 0.45 : 1.0;
      float sLum = 1.0 + (sMottle * 0.24 - joint0 * 0.16) * sAmp;
      base = clamp(base * sLum * mix(vec3(1.0), u_stoneTint, 0.35), 0.0, 1.0);
      specPower = 16.0;
      specStrength = 0.09;
    } else {
      applyTrayMaterial(base, emissive, specPower, specStrength, v_worldPos, N, u_materialStyle == 7,
        float(u_highContrast), u_boardInfo.z);
    }
  }

  float spec = pow(max(dot(N, H), 0.0), specPower) * specStrength;
  float ambient = u_highContrast == 1 ? 0.54 : 0.50;
  float heightShade = clamp((v_localPos.z - 0.54) * 1.45, -0.08, 0.14);
  float studRim =
    (u_materialStyle != 6 && v_localPos.z > 0.565 && N.z < 0.96 && N.z > 0.05) ? (0.16 * max(dot(N, L1), -0.35)) : 0.0;
  lit = base * (ambient + diff1 * 0.49 + diff2 + heightShade) + vec3(spec + studRim) + emissive;

  if (u_highContrast == 1 && u_materialStyle != 3) {
    // Crisp high-contrast 3D bevel edge contour (dark bevel on bright pieces, luminous rim on deep jewel pieces)
    float edgeBevel = smoothstep(0.58, 0.16, abs(N.z));
    float pieceLinLum = dot(lit * lit, vec3(0.2126, 0.7152, 0.0722));
    bool isDarkPiece = u_materialStyle != 5 && u_materialStyle != 7 && pieceLinLum < 0.09;
    vec3 bevelTarget = isDarkPiece ? min(vec3(1.0), base * 0.75 + vec3(0.62)) : lit * 0.34;
    lit = mix(min(vec3(1.0), lit * 1.08), bevelTarget, edgeBevel * (isDarkPiece ? 0.78 : 0.58));
  }
  } else if (u_materialStyle == 6) {
    // Preserve exact relic_stone worn-chamfer normal & Fresnel rim under solid Title stone (0% visual drift)
    vec2 bp6 = v_localPos.xy + vec2(13.0, 7.0) * u_blockSeed;
    float sAmp6 = u_highContrast == 1 ? 0.42 : 1.0;
    float faceNz6 = N.z;
    float cornerProx6 = clamp(v_uv.y, 0.0, 1.0);
    float wornBand6 = clamp((v_localPos.z - (0.58 - 0.16)) / 0.16, 0.0, 1.0);
    float undX6 = relicNoise(bp6 * 2.1 + 5.3) - 0.5;
    float undY6 = relicNoise(bp6 * 2.1 + 19.7) - 0.5;
    if (faceNz6 < 0.95 && wornBand6 > 0.0) {
      vec3 sideN6 = normalize(vec3(N.xy, 0.0001));
      float roundT6 = wornBand6 * wornBand6 * (3.0 - 2.0 * wornBand6);
      N = normalize(mix(N, normalize(mix(sideN6, vec3(0.0, 0.0, 1.0), roundT6)), 0.55 + cornerProx6 * 0.20));
    }
    N = normalize(N + vec3(undX6, undY6, 0.0) * 0.11 * sAmp6);
    rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);
  }

  float blueprintAlpha = 1.0;

${GLSL_RELIC_CRUST_SHADE}

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
