import type { MeshData } from './mesh-generator';
import type { GLMeshHandle } from './render-types';

export { MAIN_VERTEX_SHADER } from './shaders-main-vertex';

import { GLSL_STONE_LIB } from './shaders-glsl-lib';
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
uniform int u_materialStyle; // 0=standard, 1=gummy, 2=wood, 3=neon, 4=unlit_overlay, 5=tray_floor, 6=relic_stone, 7=tray_wall
uniform sampler2D u_atlas;
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
    // carved_wood (WOOD-GRAIN-01): stained hardwood with noise-warped latewood rings, pores, and bent knots
    vec3 wq = v_localPos;
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

    float pxw = fwidth(bp.x);
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
      grainMed
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
  vec3 lit = base * (ambient + diff1 * 0.49 + diff2 + heightShade) + vec3(spec + studRim) + emissive;

  if (u_highContrast == 1) {
    // Crisp high-contrast 3D bevel edge contour (dark bevel on bright pieces, luminous rim on deep jewel pieces)
    float edgeBevel = smoothstep(0.58, 0.16, abs(N.z));
    float pieceLinLum = dot(lit * lit, vec3(0.2126, 0.7152, 0.0722));
    bool isDarkPiece = u_materialStyle != 5 && u_materialStyle != 7 && pieceLinLum < 0.09;
    vec3 bevelTarget = isDarkPiece ? min(vec3(1.0), base * 0.75 + vec3(0.62)) : lit * 0.34;
    lit = mix(min(vec3(1.0), lit * 1.08), bevelTarget, edgeBevel * (isDarkPiece ? 0.78 : 0.58));
  }

  float blueprintAlpha = 1.0;

  if (u_blueprintMix > 0.001) {
    // Satin Astrolabe Slate / Anodized Gunmetal Title Mode (STONE-TABLET-01 / MYSTIC-RELIC-01):
    // Encases the 3D board & tactile studs in a 100% solid (alpha = 1.0) monochromatic satin twilight-slate
    // & anodized gunmetal stasis shell (subtle theme tint via u_stoneTint, zero dirt or pitting) with brushed
    // anisotropic sheen, burnished champagne-gold & ivory-pearl rim catch-lights matching the logo/astrolabe,
    // and living Voronoi energy fractures that shatter open into full gameplay color as u_blueprintMix -> 0.
    float isSunkenRoom = smoothstep(-0.02, -0.10, v_worldPos.z);
    vec3 restoredRgb = clamp(u_color.rgb / mix(1.0, 0.58, isSunkenRoom), 0.0, 1.0);
    float maxC = max(restoredRgb.r, max(restoredRgb.g, restoredRgb.b));
    float minC = min(restoredRgb.r, min(restoredRgb.g, restoredRgb.b));
    float chroma = maxC - minC;
    // Separates all 9 block/gate colors (chroma >= 0.50) from all 5 tray floors/walls (chroma <= 0.28)
    float isPiece = smoothstep(0.30, 0.44, chroma);
    float localWorldZ = v_worldPos.z + isSunkenRoom * 0.18;
    float isElevatedFrame = smoothstep(0.035, 0.18, localWorldZ);

    vec2 relCenter = v_worldPos.xy - u_boardInfo.xy;
    float distCenter = length(relCenter);
    float maxHalfSpan = max(u_boardInfo.x, u_boardInfo.y);
    float normDist = clamp(distCenter / max(maxHalfSpan * 1.22, 2.5), 0.0, 1.35);
    float radialWarmth = clamp(1.0 - normDist * 0.38, 0.0, 1.0);
    float caveVignette = clamp(1.0 - smoothstep(0.56, 1.30, normDist) * 0.18, 0.82, 1.0);

    // Directional top-left sanctuary light + anisotropic brushed-satin specular sweep
    vec3 L_rake = normalize(vec3(-0.52, -0.62, 0.58));
    float rakeDot = dot(N, L_rake);
    float rakeShade = clamp(0.84 + rakeDot * 0.30, 0.58, 1.16);
    vec3 H_astro = normalize(L_rake + V);
    vec3 T_brush = normalize(vec3(0.7071, -0.7071, 0.0));
    float ndoth = max(dot(N, H_astro), 0.0);
    float tdoth = dot(T_brush, H_astro);
    float satinSheen = pow(clamp(ndoth * (1.0 - tdoth * tdoth * 0.52), 0.0, 1.0), 16.0);

    vec2 wp = v_worldPos.xy;
    float warpA =
      sin(wp.x * 2.1 + wp.y * 1.6) * 0.52 +
      cos(wp.x * 4.3 - wp.y * 3.1) * 0.28 +
      sin(wp.x * 8.7 + wp.y * 7.3) * 0.12;
    float warpB =
      cos(wp.y * 2.4 - wp.x * 1.8) * 0.52 +
      sin(wp.y * 4.9 + wp.x * 2.7) * 0.28 +
      cos(wp.y * 9.1 - wp.x * 6.5) * 0.12;
    // Ultra-fine diagonal brushed anodized micro-finish (clean & silky — zero mud, soot, or pitting)
    float brushedMicro =
      (relicNoise(vec2((wp.x + wp.y) * 26.0, (wp.x - wp.y) * 3.4)) - 0.5) * 0.022 +
      (relicNoise(wp * 42.0 + 9.0) - 0.5) * 0.010;

    // Angular Voronoi energy fractures (sharp jagged fissures & 3-way junctions)
    vec2 rockJag =
      vec2(sin(wp.y * 8.5 + wp.x * 5.2), cos(wp.x * 8.1 - wp.y * 5.8)) * 0.030 +
      vec2(sin(wp.y * 22.0 - wp.x * 14.0), cos(wp.x * 20.0 + wp.y * 16.0)) * 0.010;
    vec2 vorMajor = voronoiRockCrack(wp * 0.88 + rockJag);
    vec2 vorMinor = u_blueprintMix > 0.22
      ? voronoiRockCrack(wp * 2.05 - rockJag * 1.35 + vec2(5.7, 3.1))
      : vec2(1.0, 0.5);

    float pxScale = clamp(fwidth(wp.x) * 0.85, 0.004, 0.028);
    float majorRegionMask = smoothstep(-0.08, 0.56, sin(wp.x * 0.95 - wp.y * 0.82 + 0.8) * cos(wp.y * 0.88 + wp.x * 0.64) + 0.24);
    float minorRegionMask = clamp(majorRegionMask * 0.85 + smoothstep(0.14, 0.0, vorMajor.x) * 0.65, 0.0, 1.0);

    float crackBloom = (1.0 - smoothstep(0.006, 0.148 + pxScale, vorMajor.x)) * majorRegionMask;
    float majorCrackValley = (1.0 - smoothstep(0.008, 0.072 + pxScale, vorMajor.x)) * majorRegionMask;
    float deepRelicCrack = (1.0 - smoothstep(0.0, 0.030 + pxScale, vorMajor.x)) * majorRegionMask;
    float mysticCrackCore =
      (1.0 - smoothstep(0.0, 0.018 + pxScale * 0.9, vorMajor.x)) * smoothstep(0.14, 0.64, majorRegionMask);
    float branchCrack =
      (1.0 - smoothstep(0.0, 0.022 + pxScale * 0.8, vorMinor.x)) * minorRegionMask * 0.68;
    float stoneCrack = clamp(majorCrackValley * 0.42 + deepRelicCrack * 0.64 + branchCrack, 0.0, 0.90);
    float shardTiltTone = (vorMajor.y - 0.5) * 0.036 + (vorMinor.y - 0.5) * 0.016;

    // Theme-matched desaturated tint (cool twilight slate, warm amber-bronze, deep obsidian, icy platinum, sage)
    vec3 stoneTint = dot(u_stoneTint, vec3(1.0)) > 0.1
      ? clamp(u_stoneTint, vec3(0.84), vec3(1.16))
      : vec3(1.0);

    // A. Recessed Anodized Twilight-Slate Courtyard Floor vs. Satin Gunmetal Perimeter Frame
    vec3 recessedBed = mix(vec3(0.118, 0.112, 0.184), vec3(0.166, 0.156, 0.248), radialWarmth) * stoneTint;
    vec3 chiseledFrame = mix(vec3(0.208, 0.198, 0.296), vec3(0.276, 0.262, 0.378), radialWarmth) * stoneTint;
    vec3 neutralAlloy = mix(recessedBed, chiseledFrame, isElevatedFrame);
    neutralAlloy += vec3(shardTiltTone * 0.55);
    neutralAlloy *= mix(1.0, 0.82, isSunkenRoom) * caveVignette;

    // B. Satin Astrolabe Alloy 3D Blocks & Studs (monochromatic tonal hierarchy + subtle 2.5% hue whisper)
    float pieceLum = dot(restoredRgb, vec3(0.299, 0.587, 0.114));
    float valueIndex = clamp(pieceLum * 0.62 + (restoredRgb.r * 0.21 + restoredRgb.g * 0.11 + restoredRgb.b * 0.06), 0.0, 1.0);
    vec3 darkAlloy = vec3(0.246, 0.234, 0.344) * stoneTint;
    vec3 paleAlloy = vec3(0.416, 0.402, 0.522) * stoneTint;
    vec3 astrolabeAlloy = mix(darkAlloy, paleAlloy, valueIndex);
    vec3 alloyPiece = mix(astrolabeAlloy, restoredRgb, 0.025) + vec3(shardTiltTone * 0.75);
    alloyPiece *= mix(1.0, 0.82, isSunkenRoom) * caveVignette;

    vec3 tabletSurface = mix(neutralAlloy, alloyPiece, isPiece) * rakeShade + vec3(brushedMicro);

    // 1. Clean Precision-Milled Tile Seams, Velvety Bevel/Stud Ambient Occlusion & Fracture Valleys
    vec2 cellUv = fract(v_worldPos.xy);
    float borderDist = min(min(cellUv.x, 1.0 - cellUv.x), min(cellUv.y, 1.0 - cellUv.y));
    float cellMortarGroove =
      (1.0 - smoothstep(0.012, 0.042, borderDist)) * mix(mix(0.44, 0.12, isElevatedFrame), 0.06, isPiece);
    float baseContactAO =
      isPiece * smoothstep(0.16, 0.0, localWorldZ) * smoothstep(0.95, 0.25, abs(N.z)) * 0.36;
    float shadowBevelGroove =
      smoothstep(0.96, 0.48, abs(N.z)) * smoothstep(0.16, -0.48, rakeDot) * mix(0.40, 0.50, isPiece);
    float studCarveGroove =
      (v_localPos.z > 0.55 && N.z < 0.97) ? (0.36 * smoothstep(0.22, -0.45, rakeDot) + 0.12) : 0.0;

    float grooveDarkness = clamp(
      cellMortarGroove + baseContactAO + shadowBevelGroove + studCarveGroove + stoneCrack,
      0.0,
      0.82
    );
    tabletSurface *= (1.0 - grooveDarkness);

    // 2. Burnished Astrolabe Champagne-Gold & Ivory-Pearl Rim Catch-Lights + Brushed Satin Sheen
    float cleanHighlightMask = clamp(1.0 - stoneCrack * 0.85, 0.14, 1.0);
    float litBevelCatch =
      smoothstep(0.96, 0.48, abs(N.z)) * smoothstep(-0.06, 0.56, rakeDot) * mix(0.32, 0.52, isPiece);
    float litStudCatch =
      (v_localPos.z > 0.55 && N.z < 0.97) ? (0.48 * smoothstep(-0.08, 0.56, rakeDot)) : 0.0;
    float crackLipCatch =
      clamp(majorCrackValley - deepRelicCrack, 0.0, 1.0) * smoothstep(-0.05, 0.45, rakeDot) * 0.34;

    float cornerCross =
      (1.0 - smoothstep(0.008, 0.024, min(cellUv.x, 1.0 - cellUv.x))) *
      (1.0 - smoothstep(0.050, 0.130, min(cellUv.y, 1.0 - cellUv.y))) +
      (1.0 - smoothstep(0.008, 0.024, min(cellUv.y, 1.0 - cellUv.y))) *
      (1.0 - smoothstep(0.050, 0.130, min(cellUv.x, 1.0 - cellUv.x)));
    float astrolabeTicks = clamp(cornerCross, 0.0, 1.0) * (1.0 - isPiece) * (1.0 - isElevatedFrame) * 0.18;

    float goldRimStrength = clamp(
      (max(litBevelCatch, litStudCatch) + astrolabeTicks) * cleanHighlightMask + crackLipCatch,
      0.0,
      0.78
    );
    float pearlSatinStrength = satinSheen * mix(0.11, 0.22, isPiece) * cleanHighlightMask;

    // Logo-matched palette: Ivory-Pearl ("Shred") satin sweep + Burnished Champagne-Gold ("Blocks" & Astrolabe) rims
    vec3 ivoryPearl = vec3(0.96, 0.92, 0.87) * mix(vec3(1.0), stoneTint, 0.55);
    vec3 champagneRim = vec3(0.95, 0.78, 0.48) * mix(vec3(1.0), stoneTint, 0.48);
    vec3 stoneArtifact = tabletSurface + ivoryPearl * pearlSatinStrength;
    stoneArtifact = mix(stoneArtifact, champagneRim, goldRimStrength * 0.72);
    // Cool twilight-lavender Fresnel back-rim so dark gunmetal silhouette separates cleanly from the sky
    stoneArtifact += vec3(0.56, 0.46, 0.86) * rim * 0.13 * cleanHighlightMask;

    if (u_highContrast == 1) {
      vec3 hcAlloy = mix(neutralAlloy * 0.80, mix(astrolabeAlloy * 1.10, restoredRgb, 0.06) * rakeShade, isPiece);
      hcAlloy *= (1.0 - grooveDarkness * 1.12);
      vec3 hcHighlight = clamp(vec3(0.96, 0.88, 0.70) * mix(vec3(1.0), stoneTint, 0.50), 0.0, 1.0);
      stoneArtifact = mix(hcAlloy, hcHighlight, clamp(goldRimStrength * 1.12, 0.0, 0.90));
    }

    // 3. Pulsating Mystic Fissure Glow (warm amethyst-orchid purple & astrolabe amber-gold + crepuscular rays)
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
    vec3 arcaneGold = vec3(1.00, 0.76, 0.40);
    vec3 mysticColor = mix(
      mix(arcanePurple, warmOrchid, smoothstep(0.14, 0.72, leyToneMix)),
      arcaneGold,
      smoothstep(0.54, 1.0, leyToneMix) * 0.52
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
