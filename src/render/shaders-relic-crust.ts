/**
 * Satin Astrolabe Title Relic Crust, Voronoi Crack-Expansion & Unwrapping (`MYSTIC-RELIC-01`, `RELIC-AWAKEN-01`),
 * and Detached 3D Voronoi Stone Plate Material (`u_materialStyle = 11`), extracted from `shaders-3d.ts` (`ARCH-ERGONOMICS-01`).
 */

export const GLSL_RELIC_PLATE_STYLE = `
  if (u_materialStyle == 11) {
    // Detached 3D Voronoi stone-crust plate: matches the Satin Astrolabe stone surface on top while
    // exposing incandescent amethyst-orchid-gold molten fracture light on torn walls & underside.
    vec3 Np = normalize(v_normal);
    vec3 Vp = normalize(vec3(0.0, 0.21, 0.97));
    vec3 L_rake = normalize(vec3(-0.52, -0.62, 0.58));
    float rakeDot = dot(Np, L_rake);
    float rakeShade = clamp(0.84 + rakeDot * 0.30, 0.54, 1.18);
    vec3 H_astro = normalize(L_rake + Vp);
    vec3 T_brush = normalize(vec3(0.7071, -0.7071, 0.0));
    float ndoth = max(dot(Np, H_astro), 0.0);
    float tdoth = dot(T_brush, H_astro);
    float satinSheen = pow(clamp(ndoth * (1.0 - tdoth * tdoth * 0.52), 0.0, 1.0), 16.0);
    float fresnel = pow(1.0 - max(dot(Np, Vp), 0.0), 2.3);

    vec3 stoneTint = dot(u_stoneTint, vec3(1.0)) > 0.1
      ? clamp(u_stoneTint, vec3(0.84), vec3(1.16))
      : vec3(1.0);
    vec2 wp = v_worldPos.xy;
    float brushed =
      (relicNoise(vec2((wp.x + wp.y) * 24.0, (wp.x - wp.y) * 3.4)) - 0.5) * 0.032 +
      (relicNoise(wp * 38.0 + 9.0) - 0.5) * 0.014;
    float edgeProx = clamp(v_uv.x, 0.0, 1.0);
    float life = clamp(v_uv.y, 0.0, 1.0);
    float heat = pow(life, 1.25);

    vec3 slabAlloy = vec3(0.205, 0.196, 0.304) * stoneTint * rakeShade + vec3(brushed);
    vec3 champagneRim = vec3(0.95, 0.78, 0.48) * mix(vec3(1.0), stoneTint, 0.48);
    vec3 ivoryPearl = vec3(0.96, 0.92, 0.87) * mix(vec3(1.0), stoneTint, 0.55);
    slabAlloy += ivoryPearl * (satinSheen * 0.22);

    float isSideWall = step(0.97, edgeProx);
    float isUnderside = smoothstep(-0.15, -0.70, Np.z) * (1.0 - isSideWall);
    float isOuterBevel = pow(smoothstep(0.62, 0.90, edgeProx), 2.2);
    float rimScorch = pow(smoothstep(0.76, 0.94, edgeProx), 1.8);
    float bevelCatch = (1.0 - isUnderside) * isOuterBevel * smoothstep(-0.08, 0.56, rakeDot);
    slabAlloy = mix(slabAlloy, champagneRim, bevelCatch * 0.55);

    if (u_highContrast == 1) {
      vec3 hcHi = clamp(vec3(0.98, 0.90, 0.72) * mix(vec3(1.0), stoneTint, 0.5), 0.0, 1.0);
      slabAlloy = mix(slabAlloy * 0.92, hcHi, bevelCatch * 0.82);
    }

    vec3 moltenOrchid = mix(vec3(0.84, 0.38, 1.0), vec3(1.0, 0.78, 0.44), smoothstep(0.45, 1.0, heat));
    float seamGlow = (isSideWall * 0.92 + isUnderside * (0.14 + 0.34 * rimScorch) + rimScorch * 0.42) * heat;
    float whiteHot = smoothstep(0.76, 1.0, life) * (isSideWall * 0.72 + rimScorch * 0.28);
    vec3 col = slabAlloy + moltenOrchid * seamGlow + vec3(0.56, 0.46, 0.86) * fresnel * 0.16;
    col = mix(col, vec3(1.0, 0.96, 0.92), clamp(whiteHot, 0.0, 0.82));

    float alpha = smoothstep(0.0, 0.30, life);
    outColor = vec4(clamp(col, 0.0, 1.0), alpha);
    return;
  }
`;

/**
 * Early Voronoi peel/crust pre-check (`RELIC-AWAKEN-01` / `PERF-TRANSITION-01`):
 * Evaluates exact cell detachment and `crustMask` before the gameplay skin/tray branch so:
 * - Dormant Title (`u_blueprintMix >= 0.998`) and un-cracked stone cells skip dead gameplay skin/tray ALU,
 * - Already-unwrapped cells (`crustMask == 0 && unwrapFlash <= 0.002`) skip `vorMinor` + `stoneArtifact` ALU.
 */
export const GLSL_RELIC_CRUST_PRECHECK = `
  bool needGameplayLit = true;
  bool needRelicCrust = false;
  float rc_awaken = 0.0;
  float rc_isAwakening = 0.0;
  float rc_pxScale = 0.008;
  float rc_majorRegionMask = 0.0;
  vec2 rc_vorMajor = vec2(8.0, 0.5);
  float rc_detachT = 1.0;
  float rc_isSubSplit = 0.0;
  float rc_activeCrackDist = 8.0;
  float rc_vorMinorDist = 1.0;
  float rc_vorMinorHash = 0.5;
  float rc_earlyIgnite = 0.0;
  float rc_preBreak = 0.0;
  float rc_widen = 0.0;
  float rc_activeRegionMask = 0.0;
  float rc_minorRegionMask = 0.0;
  float rc_crustMask = 0.0;
  float rc_unwrapFlash = 0.0;

  if (u_blueprintMix > 0.001) {
    vec2 rcWp = v_worldPos.xy;
    float rcMaxHalfSpan = max(u_boardInfo.x, u_boardInfo.y);
    vec2 rcRockJag =
      vec2(sin(rcWp.y * 8.5 + rcWp.x * 5.2), cos(rcWp.x * 8.1 - rcWp.y * 5.8)) * 0.030 +
      vec2(sin(rcWp.y * 22.0 - rcWp.x * 14.0), cos(rcWp.x * 20.0 + rcWp.y * 16.0)) * 0.010;
    rc_awaken = (1.0 - u_blueprintMix) * step(u_blueprintMix, 0.998);
    rc_isAwakening = step(0.001, rc_awaken);
    rc_pxScale = clamp(fwidth(rcWp.x) * 0.85, 0.004, 0.028);
    rc_majorRegionMask = smoothstep(
      -0.08,
      0.56,
      sin(rcWp.x * 0.95 - rcWp.y * 0.82 + 0.8) * cos(rcWp.y * 0.88 + rcWp.x * 0.64) + 0.24
    );
    rc_activeRegionMask = rc_majorRegionMask;
    rc_minorRegionMask = rc_majorRegionMask;

    if (rc_isAwakening < 0.5) {
      vec4 vorMajorPlate = voronoiRockPlate(rcWp * 0.88 + rcRockJag);
      rc_vorMajor = vec2(vorMajorPlate.x, vorMajorPlate.w);
      vec2 plateCenter = vorMajorPlate.yz / 0.88;
      vec2 vorMinor = voronoiRockCrack(rcWp * 2.05 - rcRockJag * 1.35 + vec2(5.7, 3.1));
      rc_vorMinorDist = vorMinor.x;
      rc_vorMinorHash = vorMinor.y;
      rc_activeCrackDist = rc_vorMajor.x;
      float plateDist = length(plateCenter - u_boardInfo.xy) / max(rcMaxHalfSpan * 1.22, 2.5);
      rc_detachT = 0.14 + clamp(plateDist, 0.0, 1.15) * 0.42 + rc_vorMajor.y * 0.14;
      rc_minorRegionMask = clamp(rc_majorRegionMask * 0.85 + smoothstep(0.14, 0.0, rc_vorMajor.x) * 0.65, 0.0, 1.0);
      rc_crustMask = 1.0;
      rc_unwrapFlash = 0.0;
      needRelicCrust = true;
      needGameplayLit = false;
    } else {
      vec4 clusterData = vec4(0.0);
      vec4 vorCluster = voronoiRockPlateCluster(rcWp * 0.88 + rcRockJag, clusterData);
      float mdAll = vorCluster.x;
      float mdCluster = vorCluster.y;
      rc_vorMajor = vec2(mdCluster, vorCluster.z);
      float clusterDetachT = clusterData.g;
      rc_isSubSplit = step(0.5, clusterData.b);

      if (rc_isSubSplit > 0.5 || (u_blueprintMix > 0.22 && (rc_awaken - clusterDetachT) <= 0.055)) {
        vec4 vorMinorPlate = voronoiRockPlate(rcWp * 2.05 - rcRockJag * 1.35 + vec2(5.7, 3.1));
        rc_vorMinorDist = vorMinorPlate.x;
        rc_vorMinorHash = vorMinorPlate.w;
        if (rc_isSubSplit > 0.5) {
          mdCluster = min(mdCluster, rc_vorMinorDist * (0.88 / 2.05));
          rc_vorMajor.y = vorMinorPlate.w;
          rc_detachT = clamp(clusterDetachT + (vorMinorPlate.w - 0.5) * 0.09, 0.06, 0.64);
        } else {
          rc_detachT = clusterDetachT;
        }
      } else {
        rc_detachT = clusterDetachT;
      }

      float peelEdge = (rc_awaken - rc_detachT) / 0.055;
      rc_crustMask = (1.0 - smoothstep(0.0, 1.0, peelEdge)) * smoothstep(0.0, 0.06, u_blueprintMix);
      rc_unwrapFlash = exp(-max(peelEdge, 0.0) * 3.0) * smoothstep(-0.22, 0.14, peelEdge);
      needRelicCrust = rc_crustMask > 0.0001 || rc_unwrapFlash > 0.002;
      if (needRelicCrust) {
        rc_activeCrackDist = mix(mdAll, mdCluster, smoothstep(0.0, 0.06, rc_awaken));
        rc_earlyIgnite = smoothstep(0.0, 0.12, rc_awaken);
        rc_preBreak = clamp((rc_awaken - (rc_detachT - 0.22)) / 0.22, 0.0, 1.0);
        rc_widen = rc_earlyIgnite * rc_majorRegionMask * 0.036 + rc_preBreak * rc_preBreak * 0.155;
        rc_activeRegionMask = clamp(rc_majorRegionMask * (1.0 + rc_earlyIgnite * 0.55) + rc_preBreak * 0.96, 0.0, 1.0);
        rc_minorRegionMask = clamp(rc_majorRegionMask * 0.92 + rc_isSubSplit * rc_preBreak * 0.95, 0.0, 1.0);
        needGameplayLit = rc_crustMask < 0.999 || rc_preBreak > 0.001;
      }
    }
  }
`;

export const GLSL_RELIC_CRUST_SHADE = `
  if (needRelicCrust) {
    // Satin Astrolabe Title Mode (STONE-TABLET-01 / MYSTIC-RELIC-01): 100% opaque (alpha = 1.0) anodized gunmetal
    // stasis shell (u_stoneTint) with brushed satin sheen, champagne-gold/ivory-pearl rims, and Voronoi fractures.
    // During RELIC-AWAKEN-01 (u_blueprintMix < 0.998), fissures widen & flood with inner light before each matching
    // Voronoi stone plate cleaves off to unwrap the vivid gameplay board underneath.
    vec2 wp = v_worldPos.xy;
    float animTime = max(u_boardInfo.z, 0.0);
    float isAnimated = step(0.0, u_boardInfo.z);
    float warpB =
      cos(wp.y * 2.4 - wp.x * 1.8) * 0.52 +
      sin(wp.y * 4.9 + wp.x * 2.7) * 0.28 +
      cos(wp.y * 9.1 - wp.x * 6.5) * 0.12;
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
    float crackBloom = (1.0 - smoothstep(0.006, 0.148 + rc_widen * 1.25 + rc_pxScale, rc_activeCrackDist)) * rc_activeRegionMask;

    if (rc_crustMask > 0.0001) {
      float isSunkenRoom = smoothstep(-0.02, -0.10, v_worldPos.z);
      vec3 restoredRgb = clamp(u_color.rgb / mix(1.0, 0.58, isSunkenRoom), 0.0, 1.0);
      float maxC = max(restoredRgb.r, max(restoredRgb.g, restoredRgb.b));
      float minC = min(restoredRgb.r, min(restoredRgb.g, restoredRgb.b));
      float chroma = maxC - minC;
      // Separates all 9 block/gate colors (chroma >= 0.50) from all 5 tray floors/walls (chroma <= 0.28)
      float isPiece = smoothstep(0.30, 0.44, chroma);
      float localWorldZ = v_worldPos.z + isSunkenRoom * 0.18;
      float isElevatedFrame = smoothstep(0.035, 0.18, localWorldZ);

      vec2 relCenter = wp - u_boardInfo.xy;
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

      float warpA =
        sin(wp.x * 2.1 + wp.y * 1.6) * 0.52 +
        cos(wp.x * 4.3 - wp.y * 3.1) * 0.28 +
        sin(wp.x * 8.7 + wp.y * 7.3) * 0.12;
      // Ultra-fine diagonal brushed anodized micro-finish (clean & silky — zero mud, soot, or pitting)
      float brushedMicro =
        (relicNoise(vec2((wp.x + wp.y) * 26.0, (wp.x - wp.y) * 3.4)) - 0.5) * 0.022 +
        (relicNoise(wp * 42.0 + 9.0) - 0.5) * 0.010;

      float majorCrackValley = (1.0 - smoothstep(0.008, 0.072 + rc_widen * 1.08 + rc_pxScale, rc_activeCrackDist)) * rc_activeRegionMask;
      float deepRelicCrack = (1.0 - smoothstep(0.0, 0.030 + rc_widen + rc_pxScale, rc_activeCrackDist)) * rc_activeRegionMask;
      float mysticCrackCore =
        (1.0 - smoothstep(0.0, 0.018 + rc_widen * 0.92 + rc_pxScale * 0.9, rc_activeCrackDist)) *
        mix(smoothstep(0.14, 0.64, rc_majorRegionMask), rc_activeRegionMask, rc_isAwakening);
      float branchCrack =
        (1.0 - smoothstep(0.0, 0.022 + rc_widen * 0.52 + rc_pxScale * 0.8, rc_vorMinorDist)) * rc_minorRegionMask * (0.68 + 0.32 * rc_isAwakening);
      float stoneCrack = clamp(majorCrackValley * 0.42 + deepRelicCrack * 0.64 + branchCrack, 0.0, 0.90);
      float shardTiltTone = (rc_vorMajor.y - 0.5) * 0.036 + (rc_vorMinorHash - 0.5) * 0.016;

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
      vec2 cellUv = fract(wp);
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
      float breathPrimary = mix(0.74, 0.5 + 0.5 * sin(animTime * 1.85), isAnimated);
      float breathWave = mix(0.70, 0.5 + 0.5 * sin(animTime * 2.30 - normDist * 2.8 + warpA * 0.8), isAnimated);
      float mysticPulse = mix(0.50, 1.0, breathPrimary * 0.64 + breathWave * 0.36);

      // Incandescent energy inside Voronoi fractures + wide subsurface bloom + subtle radial crepuscular light shafts.
      float tA = animTime * isAnimated;
      float pulseField =
        relicNoise(wp * 0.58 + vec2(tA * 0.19, -tA * 0.14)) * 0.6 +
        relicNoise(wp * 1.42 - vec2(tA * 0.33, tA * 0.27) + 7.3) * 0.4;
      float heartbeat = mix(0.7, 0.5 + 0.5 * sin(tA * 1.9 + pulseField * 11.0), isAnimated);
      float crackPulse = 0.1 + 0.9 * smoothstep(0.22, 0.86, pulseField) * (0.5 + 0.5 * heartbeat);
      float crackLines = mysticCrackCore + branchCrack * 0.58;
      float crackGlow = crackLines * (0.18 + 1.12 * crackPulse);
      float crackHalo =
        (majorCrackValley * 0.44 + crackBloom * 0.32) *
        smoothstep(0.12, 0.64, mix(rc_majorRegionMask, rc_activeRegionMask, rc_isAwakening)) *
        crackPulse;
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

      if (rc_isAwakening > 0.5) {
        // Widening cracks expose an intense glowing interior + hints of real gameplay colors before the plate breaks off
        float surge = clamp(rc_earlyIgnite * 0.55 + rc_preBreak * 0.95, 0.0, 1.0);
        float exposedRift = (1.0 - smoothstep(0.0, 0.018 + rc_widen * 0.82 + rc_pxScale, rc_activeCrackDist)) * rc_activeRegionMask;
        float lipHeat = clamp(majorCrackValley - exposedRift * 0.75, 0.0, 1.0) * surge;
        vec3 innerCoreLight = mix(mysticColor * 1.22, vec3(1.0, 0.96, 0.98), 0.70);
        vec3 emergingCore = mix(innerCoreLight, clamp(lit * 1.32 + mysticColor * 0.42, 0.0, 1.0), rc_preBreak * 0.55);
        stoneArtifact += mysticColor * (lipHeat * 0.92 + branchCrack * surge * 0.88);
        stoneArtifact = mix(stoneArtifact, emergingCore, clamp(exposedRift * (0.48 + 0.52 * surge), 0.0, 1.0));
      }

      // 4. Crisp per-Voronoi-plate crust unwrapping: each plate holds solid stone until detachT,
      //    then cleaves away cleanly to reveal the crisp real board with only a brief seam flash.
      lit = mix(lit, stoneArtifact, rc_crustMask);
    }

    if (rc_unwrapFlash > 0.002) {
      lit += mysticColor * (rc_unwrapFlash * 0.28 * (0.35 + 0.65 * crackBloom));
      float seamSpark = 1.0 - smoothstep(0.0, 0.045 + rc_widen * 0.6 + rc_pxScale, rc_activeCrackDist);
      lit = mix(lit, vec3(1.0, 0.94, 0.98), clamp(rc_unwrapFlash * seamSpark, 0.0, 0.45));
    }
    // Keep opaque 3D stone geometry 100% solid (blueprintAlpha = 1.0) so plinth, floor, walls,
    // and blocks never alpha-bleed through one another like a ghosted rendering error.
    blueprintAlpha = 1.0;
  }
`;
