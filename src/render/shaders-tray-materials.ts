/**
 * Lightweight 120Hz Board Tray signature materials (`TRAY-IDENTITY-01`), interpolated into `MAIN_FRAGMENT_SHADER`.
 * Zero Voronoi loops — uses single-pass hashes and 1-2 value-noise taps while preserving `orig` (`u_color.rgb`)
 * so colored floor-path tiles, multi-room `luminanceMul` dimming, and `AX-02` High Contrast all work natively:
 * - `0` Industrial Slate: cleft slate flagstones / ashlar (handled by the stone branch in the main shader)
 * - `1` Warm Birch: birch plank deck (seams, fine grain, nail heads) / stained timber beam rim
 * - `2` Midnight Arcade: polished obsidian with softly pulsing cyan-magenta joint grid / brushed metal neon rim
 * - `3` Frosted Quartz: faceted crystal ice with frost veins & slow sparkle glints / frosted ice rim
 * - `4` Mint Studio: polished jade terrazzo with marble, emerald & gold flecks / jade rim with gold inlay
 */
export const GLSL_TRAY_MATERIALS = `
void applyTrayMaterial(inout vec3 base, inout vec3 emissive, inout float specPower, inout float specStrength,
                       vec3 wpos, vec3 n, bool isWall, float hc, float t) {
  vec3 orig = base;
  float amp = hc > 0.5 ? 0.42 : 1.0;
  float tm = max(t, 0.0) * step(0.0, t);
  float origLum = clamp(max(orig.r, max(orig.g, orig.b)), 0.04, 1.0);
  vec2 cellF = fract(wpos.xy);
  float jointD = min(min(cellF.x, 1.0 - cellF.x), min(cellF.y, 1.0 - cellF.y));
  float along2 = abs(n.x) > abs(n.y) ? wpos.y : wpos.x;

  if (u_trayMaterial == 1) {
    if (!isWall) {
      // Warm Birch plank deck: half-cell planks with staggered butt joints, fine wood grain & pin nails
      float plankW = 0.5;
      float row = floor(wpos.y / plankW);
      float rowHash = hashRelic22(vec2(row, 3.0)).x;
      float plankLen = 2.0 + rowHash * 1.5;
      float along = wpos.x + rowHash * 7.0;
      vec2 ph = hashRelic22(vec2(floor(along / plankLen), row) + 11.0);
      float acrossF = fract(wpos.y / plankW);
      float alongF = fract(along / plankLen);
      float seam = max(1.0 - smoothstep(0.0, 0.036, min(acrossF, 1.0 - acrossF)),
                       1.0 - smoothstep(0.0, 0.013, min(alongF, 1.0 - alongF) * plankLen * 0.1));
      float grain = relicNoise(vec2(along * 1.5, wpos.y * 58.0 + ph.x * 40.0)) - 0.5;
      float plankTone = 0.92 + ph.y * 0.16;
      vec2 nailRel = vec2(min(alongF, 1.0 - alongF) * plankLen - 0.13, (fract(acrossF * 2.0) - 0.5) * plankW * 0.5);
      float nail = (1.0 - smoothstep(0.018, 0.03, length(nailRel))) * amp;
      base = clamp(orig * mix(1.0, plankTone, amp) * (1.0 + grain * 0.16 * amp) * (1.0 - seam * 0.48 * amp), 0.0, 1.0);
      base = mix(base, orig * 0.34, nail * 0.8);
      specPower = 22.0;
      specStrength = 0.13;
    } else {
      // Timber beam rim: warm stained beams with horizontal grain
      float grain = relicNoise(vec2(along2 * 1.3, wpos.z * 42.0 + along2 * 0.4)) - 0.5;
      base = clamp(orig * (1.0 + grain * 0.22 * amp), 0.0, 1.0);
      specPower = 18.0;
      specStrength = 0.11;
    }
  } else if (u_trayMaterial == 2) {
    if (!isWall) {
      // Midnight Arcade: polished dark obsidian with subtle glassy sheen & softly pulsing cyan/magenta joint grid
      float swirl = relicNoise(wpos.xy * 1.4 + 3.0) - 0.5;
      base = clamp(orig * (0.86 + swirl * 0.28 * amp), 0.0, 1.0);
      float parity = mod(floor(wpos.x) + floor(wpos.y), 2.0);
      vec3 gridCol = mix(vec3(0.14, 0.86, 1.0), vec3(0.94, 0.3, 0.88), parity);
      float pulse = 0.68 + 0.32 * sin(tm * 1.35 - (wpos.x + wpos.y) * 0.65);
      float glow = (1.0 - smoothstep(0.0, 0.044, jointD)) + (1.0 - smoothstep(0.0, 0.14, jointD)) * 0.22;
      float roomScale = clamp(origLum * 5.2, 0.28, 1.0);
      emissive += gridCol * glow * 0.44 * pulse * amp * roomScale;
      specPower = 88.0;
      specStrength = 0.55;
    } else {
      // Dark brushed cabinet rim with subtle cyan top-edge catch
      float brushed = relicNoise(vec2(along2 * 2.2, wpos.z * 96.0)) - 0.5;
      base = clamp(orig * (0.9 + brushed * 0.24 * amp), 0.0, 1.0);
      emissive += vec3(0.18, 0.72, 1.0) * smoothstep(0.86, 0.97, n.z) * 0.26 * amp * clamp(origLum * 3.0, 0.25, 1.0);
      specPower = 60.0;
      specStrength = 0.42;
    }
  } else if (u_trayMaterial == 3) {
    if (!isWall) {
      // Frosted Quartz: angular crystalline ice facets per tile + crisp frost joints & slow diamond glints
      vec2 tileH = hashRelic22(floor(wpos.xy) + 19.0);
      vec2 cf = cellF - 0.5;
      vec2 fDir = tileH.y < 0.5 ? vec2(0.8, 0.6) : vec2(0.6, -0.8);
      float planeSplit = dot(cf, fDir) + (tileH.x - 0.5) * 0.22;
      float crystalRidge = 1.0 - smoothstep(0.0, 0.032, abs(planeSplit));
      float frostEdge = 1.0 - smoothstep(0.0, 0.055, jointD);
      float facetShade = 0.94 + tileH.x * 0.1 + step(0.0, planeSplit) * 0.07;
      base = clamp(orig * mix(1.0, facetShade, amp), 0.0, 1.0);
      base = mix(base, min(vec3(1.0), orig * 1.22 + vec3(0.12 * origLum)), clamp(crystalRidge * 0.6 + frostEdge * 0.5, 0.0, 0.8) * amp);
      vec2 g = wpos.xy * 18.0;
      vec2 gh = hashRelic22(floor(g) + 71.0);
      float spark = step(0.984, gh.x) * (1.0 - smoothstep(0.0, 0.22, length(fract(g) - 0.5)));
      emissive += vec3(0.92, 0.97, 1.0) * spark * (0.4 + 0.6 * (0.5 + 0.5 * sin(tm * 2.4 + gh.y * 50.0))) * 0.65 * amp * origLum;
      specPower = 68.0;
      specStrength = 0.44;
    } else {
      // Frosted crystal rim with vertical frost striation
      float streak = relicNoise(vec2(along2 * 5.5, wpos.z * 1.8)) - 0.5;
      base = clamp(orig * (1.0 + streak * 0.18 * amp), 0.0, 1.0);
      specPower = 48.0;
      specStrength = 0.36;
    }
  } else if (u_trayMaterial == 4) {
    if (!isWall) {
      // Mint Studio: polished jade terrazzo with angled alabaster, deep-emerald & gold chips (single-cell hash, zero loops)
      float cloud = relicNoise(wpos.xy * 1.4) - 0.5;
      base = clamp(orig * (0.94 + cloud * 0.18 * amp), 0.0, 1.0);
      vec2 tg = wpos.xy * 5.6;
      vec2 tc = floor(tg);
      vec2 th = hashRelic22(tc + 13.0);
      vec2 th2 = hashRelic22(tc + 53.0);
      vec2 cp = fract(tg) - (0.28 + 0.44 * th);
      cp = (th2.x < 0.5) ? vec2(cp.x * 0.86 - cp.y * 0.5, cp.x * 0.5 + cp.y * 0.86) : vec2(cp.x * 0.8 + cp.y * 0.6, -cp.x * 0.6 + cp.y * 0.8);
      float chipR = 0.11 + th2.y * 0.09;
      float chipMask = step(0.38, th.x) * (1.0 - smoothstep(chipR - 0.025, chipR + 0.025, max(abs(cp.x), abs(cp.y) * 1.3)));
      vec3 chipCol = th.y > 0.62 ? vec3(0.93, 0.96, 0.92) : (th.y > 0.26 ? vec3(0.11, 0.32, 0.25) : vec3(0.88, 0.72, 0.36));
      base = mix(base, chipCol * origLum * 1.18, chipMask * 0.82 * amp);
      base *= 1.0 - (1.0 - smoothstep(0.0, 0.028, jointD)) * 0.22 * amp;
      specPower = 54.0;
      specStrength = 0.36;
    } else {
      // Jade rim with a thin burnished gold inlay band along the parapet face
      float cloud = relicNoise(vec2(along2 * 1.6, wpos.z * 3.0)) - 0.5;
      base = clamp(orig * (1.0 + cloud * 0.16 * amp), 0.0, 1.0);
      float inlay = (1.0 - smoothstep(0.014, 0.028, abs(fract(wpos.z * 1.8 + 0.18) - 0.5))) * (1.0 - smoothstep(0.7, 0.92, abs(n.z)));
      base = mix(base, vec3(0.94, 0.78, 0.38) * clamp(origLum * 2.2, 0.3, 1.0), inlay * 0.78 * amp);
      specPower = 44.0;
      specStrength = 0.32;
    }
  }
  if (hc > 0.5) {
    base = mix(base, orig, 0.68);
  }
}
`;
