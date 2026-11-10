import { ENVIRONMENT_MESHES, type MeshData } from './mesh-generator';
import { type GLMeshHandle, INSTANCE_STRIDE } from './render-types';

export const MAIN_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_viewProj;
uniform vec3 u_translate;
uniform vec3 u_scale;
uniform float u_rotX;
uniform float u_rotZ;
uniform vec4 u_uvRect;
uniform float u_blueprintMix;

out vec3 v_worldPos;
out vec3 v_localPos;
out vec3 v_normal;
out vec2 v_uv;

void main() {
  vec3 p = a_position * u_scale;
  vec3 n = a_normal;

  if (abs(u_rotX) > 0.0001) {
    float cx = cos(u_rotX);
    float sx = sin(u_rotX);
    p = vec3(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
    n = vec3(n.x, n.y * cx - n.z * sx, n.y * sx + n.z * cx);
  }

  if (abs(u_rotZ) > 0.0001) {
    float cz = cos(u_rotZ);
    float sz = sin(u_rotZ);
    p = vec3(p.x * cz - p.y * sz, p.x * sz + p.y * cz, p.z);
    n = vec3(n.x * cz - n.y * sz, n.x * sz + n.y * cz, n.z);
  }

  vec3 rawWorldPos = p + u_translate;
  v_worldPos = rawWorldPos;
  v_localPos = p;
  v_normal = normalize(n);
  v_uv = mix(u_uvRect.xy, u_uvRect.zw, a_uv);

  // In Discovered Stone Tablet Artifact Mode (u_blueprintMix = 1.0), compress Z relief
  // into a solid bas-relief stone frieze (0.22) that clearly preserves bevel normals and depth
  // ordering without z-fighting, then swells 4.5x taller into bold 3D blocks when play begins.
  float zRelief = mix(1.0, 0.22, u_blueprintMix);
  vec3 stagePos = vec3(rawWorldPos.x, rawWorldPos.y, rawWorldPos.z * zRelief);

  gl_Position = u_viewProj * vec4(stagePos, 1.0);
}
`;

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
uniform int u_materialStyle; // 0=standard, 1=gummy, 2=wood, 3=neon, 4=unlit_overlay
uniform sampler2D u_atlas;
uniform float u_blueprintMix;
uniform vec3 u_boardInfo; // x = cols * 0.5, y = rows * 0.5, z = timeSec
uniform int u_highContrast;

out vec4 outColor;

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

  if (u_materialStyle == 1) {
    // gummy_jelly: subsurface glow + glossy highlight
    specPower = 48.0;
    specStrength = u_highContrast == 1 ? 0.34 : 0.45;
    base = mix(base, vec3(1.0), 0.12 * rim);
  } else if (u_materialStyle == 2) {
    // carved_wood: warm procedural woodgrain bands locked to block-local coordinates
    float grainAmp = u_highContrast == 1 ? 0.048 : 0.105;
    float grain = sin(v_localPos.x * 16.0 + v_localPos.y * 6.0 + sin(v_localPos.x * 5.0 - v_localPos.y * 4.0) * 1.6) * grainAmp;
    base = clamp(base + vec3(grain * 1.1, grain * 0.85, grain * 0.55), 0.0, 1.0);
    specStrength = 0.16;
  } else if (u_materialStyle == 3) {
    // neon_cyber: dark core with bright edge rim (kept brighter in High Contrast mode)
    float coreMul = u_highContrast == 1 ? 0.92 : 0.72;
    base = mix(base * coreMul, min(vec3(1.0), base * 1.35 + 0.15), clamp(rim * 1.6, 0.0, 1.0));
    specPower = 64.0;
    specStrength = 0.4;
  }

  float spec = pow(max(dot(N, H), 0.0), specPower) * specStrength;
  float ambient = u_highContrast == 1 ? 0.54 : 0.50;
  float heightShade = clamp((v_localPos.z - 0.54) * 1.45, -0.08, 0.14);
  float studRim = (v_localPos.z > 0.565 && N.z < 0.96 && N.z > 0.05) ? (0.16 * max(dot(N, L1), -0.35)) : 0.0;
  vec3 lit = base * (ambient + diff1 * 0.49 + diff2 + heightShade) + vec3(spec + studRim);

  if (u_highContrast == 1) {
    // Crisp high-contrast 3D bevel edge contour so every block and wall edge has razor-sharp definition
    float edgeBevel = smoothstep(0.58, 0.16, abs(N.z));
    lit = mix(min(vec3(1.0), lit * 1.08), lit * 0.34, edgeBevel * 0.58);
  }

  float blueprintAlpha = 1.0;

  if (u_blueprintMix > 0.001) {
    // Discovered Monochrome Ancient Stone Tablet Artifact Mode (STONE-TABLET-01 / CAVE-ETCH-01):
    // Renders the board as a 100% solid (alpha = 1.0) monochrome weathered stone bas-relief
    // (aged limestone, sandstone, and travertine with organic patina mottling, hairline fissures,
    // pitted grain, and chiseled bevels) that pops into vibrant 3D color when play begins.
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

    // Ancient stone weathering: organic patina mottling + pitted pores + sparse hairline fissures
    vec2 wp = v_worldPos.xy;
    float warpA = sin(wp.x * 2.3 + wp.y * 1.7) * 0.55 + cos(wp.x * 4.1 - wp.y * 3.3) * 0.28;
    float warpB = cos(wp.y * 2.6 - wp.x * 1.9) * 0.55 + sin(wp.y * 4.7 + wp.x * 2.9) * 0.28;
    float ageMottle = sin(wp.x * 1.85 + warpA) * cos(wp.y * 2.05 + warpB);
    float grainCoarse =
      sin(wp.x * 19.0 + cos(wp.y * 17.0) * 1.4) *
      cos(wp.y * 21.0 - sin(wp.x * 15.0) * 1.3) * 0.016;
    float grainFine =
      sin(wp.x * 49.0 + sin(wp.y * 37.0)) *
      cos(wp.y * 53.0 + sin(wp.x * 31.0)) * 0.013;
    float stonePitting = smoothstep(0.76, 0.98, sin(wp.x * 67.0 + warpA * 4.0) * cos(wp.y * 71.0 + warpB * 4.0)) * -0.032;
    float stoneGrain = grainCoarse + grainFine + stonePitting;

    // Sparse weathered hairline stone fissures
    float crackCoord = (wp.x * 1.35 + wp.y * 0.92) * 3.4 + warpA * 1.85 + sin(wp.y * 9.5) * 0.18;
    float crackMask = smoothstep(0.32, 0.78, sin(wp.x * 1.9 - wp.y * 2.3 + 1.1) * cos(wp.x * 1.3 + wp.y * 1.7));
    float stoneCrack = (1.0 - smoothstep(0.0, 0.055, abs(sin(crackCoord)))) * crackMask * 0.34;

    // A. Recessed Carved Slate-Limestone Bed vs. Chiseled Warm Travertine Tablet Rim/Pillars
    vec3 recessedBed = mix(
      vec3(0.215, 0.198, 0.214),
      vec3(0.268, 0.246, 0.254),
      radialWarmth
    );
    vec3 chiseledFrame = mix(
      vec3(0.358, 0.324, 0.292),
      vec3(0.428, 0.388, 0.346),
      radialWarmth
    );
    vec3 neutralStone = mix(recessedBed, chiseledFrame, isElevatedStone);
    neutralStone += vec3(0.024, 0.018, 0.008) * ageMottle;
    neutralStone *= mix(1.0, 0.80, isSunkenRoom) * caveVignette;

    // B. Monochrome Ancient Limestone & Sandstone Pieces (~98.5% pure weathered stone)
    // Pieces vary only in natural monochrome quarry-stone value (aged dark sandstone -> pale carved limestone)
    // so every block and gate reads as pure ancient stone before popping into vibrant 3D color on play.
    float pieceLum = dot(restoredRgb, vec3(0.299, 0.587, 0.114));
    float valueIndex = clamp(
      pieceLum * 0.62 + (restoredRgb.r * 0.21 + restoredRgb.g * 0.11 + restoredRgb.b * 0.06),
      0.0,
      1.0
    );
    vec3 darkSandstone = vec3(0.395, 0.362, 0.328);
    vec3 paleLimestone = vec3(0.535, 0.494, 0.448);
    vec3 quarryStone = mix(darkSandstone, paleLimestone, valueIndex);
    vec3 mineralPigment = mix(quarryStone, restoredRgb, 0.018);
    mineralPigment += vec3(0.026, 0.020, 0.012) * ageMottle;
    mineralPigment *= mix(1.0, 0.80, isSunkenRoom) * caveVignette;

    vec3 tabletSurface = mix(neutralStone, mineralPigment, isPiece) * rakeShade + vec3(stoneGrain);

    // 1. Dark Carved Mortar Joints (strong on recessed floor, subtle mason scribe on elevated slabs/pieces)
    vec2 cellUv = fract(v_worldPos.xy);
    float borderDist = min(min(cellUv.x, 1.0 - cellUv.x), min(cellUv.y, 1.0 - cellUv.y));
    float cellMortarGroove =
      (1.0 - smoothstep(0.014, 0.044, borderDist)) * mix(mix(0.38, 0.07, isElevatedStone), 0.05, isPiece);
    float innerInscribedGroove =
      (1.0 - smoothstep(0.006, 0.020, abs(borderDist - 0.108))) * isPiece * 0.07;
    float shadowBevelGroove =
      smoothstep(0.96, 0.52, abs(N.z)) * smoothstep(0.14, -0.48, rakeDot) * mix(0.40, 0.50, isPiece);
    float studCarveGroove =
      (v_localPos.z > 0.555 && N.z < 0.965) ? (0.34 * smoothstep(0.25, -0.45, rakeDot) + 0.14) : 0.0;

    float grooveDarkness = clamp(
      cellMortarGroove + innerInscribedGroove + shadowBevelGroove + studCarveGroove + stoneCrack,
      0.0,
      0.68
    );
    tabletSurface *= (1.0 - grooveDarkness);

    // 2. Sunlit Limestone Chisel Catch-Lights, Mason Corner Ticks & Diagonal Chisel Tool-Marks
    float litBevelCatch =
      smoothstep(0.96, 0.50, abs(N.z)) * smoothstep(-0.04, 0.55, rakeDot) * mix(0.34, 0.50, isPiece);
    float litStudCatch =
      (v_localPos.z > 0.56 && N.z < 0.965) ? (0.42 * smoothstep(-0.04, 0.55, rakeDot)) : 0.0;
    float innerRimCatch =
      (1.0 - smoothstep(0.006, 0.018, abs(borderDist - 0.090))) * isPiece * 0.06;

    float cornerCross =
      (1.0 - smoothstep(0.010, 0.028, min(cellUv.x, 1.0 - cellUv.x))) *
      (1.0 - smoothstep(0.055, 0.135, min(cellUv.y, 1.0 - cellUv.y))) +
      (1.0 - smoothstep(0.010, 0.028, min(cellUv.y, 1.0 - cellUv.y))) *
      (1.0 - smoothstep(0.055, 0.135, min(cellUv.x, 1.0 - cellUv.x)));
    float masonTicks = clamp(cornerCross, 0.0, 1.0) * (1.0 - isPiece) * (1.0 - isElevatedStone) * 0.20;

    float hatchA = sin((v_worldPos.x + v_worldPos.y) * 46.0);
    float hatchB = sin((v_worldPos.x - v_worldPos.y) * 46.0);
    float chiselHatch =
      smoothstep(0.80, 0.97, hatchA) * mix(0.04, 0.12, isPiece) +
      smoothstep(0.88, 0.985, hatchB) * 0.06 * isPiece;

    float highlightStrength = clamp(
      max(litBevelCatch, litStudCatch) + innerRimCatch + masonTicks + chiselHatch,
      0.0,
      0.82
    );

    vec3 warmLimestoneHighlight = vec3(0.75, 0.68, 0.58);
    vec3 stoneArtifact = mix(tabletSurface, warmLimestoneHighlight, highlightStrength);

    if (u_highContrast == 1) {
      vec3 hcStone = mix(neutralStone * 0.84, mix(quarryStone * 1.08, restoredRgb, 0.08) * rakeShade, isPiece);
      hcStone *= (1.0 - grooveDarkness * 1.15);
      stoneArtifact = mix(hcStone, vec3(0.94, 0.88, 0.76), clamp(highlightStrength * 1.15, 0.0, 0.90));
    }

    lit = mix(lit, stoneArtifact, u_blueprintMix);
    // Keep opaque 3D stone geometry 100% solid (blueprintAlpha = 1.0) so plinth, floor, walls,
    // and blocks never alpha-bleed through one another like a ghosted rendering error.
    blueprintAlpha = 1.0;
  }

  outColor = vec4(clamp(lit, 0.0, 1.0), u_color.a * blueprintAlpha);
}
`;

export const PARTICLE_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 3) in vec4 a_instPosScale;
layout(location = 4) in vec4 a_instColorRot;

uniform mat4 u_viewProj;
uniform int u_particleStyle; // 0=micro_cubes, 1=star_confetti, 2=pixel_sparks, 3=soap_bubbles, 4=lightning_bolts

out vec3 v_normal;
out vec3 v_color;
out vec3 v_localPos;

void main() {
  float angle = a_instColorRot.w;
  float c = cos(angle);
  float s = sin(angle);

  vec3 p = a_position;
  vec3 n = a_normal;

  if (u_particleStyle == 1) {
    // star_confetti: flat fluttering ribbon wafers
    p = vec3(p.x * 1.38, p.y * 1.15, p.z * 0.16);
  } else if (u_particleStyle == 2) {
    // pixel_sparks: crisp axis-aligned voxel sparks
    p = p * 0.78;
    c = 1.0;
    s = 0.0;
  } else if (u_particleStyle == 3) {
    // soap_bubbles: inflated spherical droplets
    vec3 sphereDir = normalize(a_position);
    p = sphereDir * 0.62;
    n = sphereDir;
  } else if (u_particleStyle == 4) {
    // lightning_bolts: elongated jagged electric streaks
    p = vec3(p.x * 2.45, p.y * 0.28 + sin(p.x * 6.0) * 0.14, p.z * 0.28);
  }

  p = p * a_instPosScale.w;
  vec3 rotated = vec3(
    p.x * c - p.y * s,
    p.x * s + p.y * c,
    p.z * c - p.x * s * 0.3
  );

  vec3 worldPos = rotated + a_instPosScale.xyz;
  v_normal = n;
  v_color = a_instColorRot.rgb;
  v_localPos = a_position;

  gl_Position = u_viewProj * vec4(worldPos, 1.0);
}
`;

export const PARTICLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

in vec3 v_normal;
in vec3 v_color;
in vec3 v_localPos;

uniform int u_particleStyle; // 0=micro_cubes, 1=star_confetti, 2=pixel_sparks, 3=soap_bubbles, 4=lightning_bolts

out vec4 outColor;

void main() {
  vec3 N = normalize(v_normal);
  vec3 L = normalize(vec3(-0.3, -0.5, 0.8));
  vec3 V = normalize(vec3(0.0, 0.21, 0.97));
  float light = 0.62 + max(dot(N, L), 0.0) * 0.45;

  if (u_particleStyle == 1) {
    // star_confetti: glossy metallic foil sheen
    float foil = 0.75 + 0.45 * abs(dot(N, L));
    vec3 col = mix(v_color * foil, vec3(1.0, 0.96, 0.8), 0.22);
    outColor = vec4(clamp(col, 0.0, 1.0), 0.96);
    return;
  } else if (u_particleStyle == 2) {
    // pixel_sparks: white-hot incandescent core with glowing edge
    float core = clamp(1.0 - length(v_localPos) * 1.15, 0.0, 1.0);
    vec3 col = mix(v_color * 1.25, vec3(1.0, 0.98, 0.82), core * 0.7);
    outColor = vec4(clamp(col, 0.0, 1.0), 0.98);
    return;
  } else if (u_particleStyle == 3) {
    // soap_bubbles: translucent sphere with iridescent Fresnel rim glow
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    vec3 irid = mix(v_color, vec3(0.78, 0.96, 1.0), 0.55 * fresnel);
    float alpha = clamp(0.28 + fresnel * 0.64, 0.25, 0.92);
    outColor = vec4(clamp(irid + vec3(fresnel * 0.35), 0.0, 1.0), alpha);
    return;
  } else if (u_particleStyle == 4) {
    // lightning_bolts: high-voltage electric cyan/white arc flash
    float arc = clamp(1.0 - abs(v_localPos.y) * 1.6, 0.0, 1.0);
    vec3 col = mix(mix(v_color, vec3(0.35, 0.92, 1.0), 0.55), vec3(1.0), arc * 0.75);
    outColor = vec4(clamp(col, 0.0, 1.0), 0.98);
    return;
  }

  outColor = vec4(clamp(v_color * light, 0.0, 1.0), 0.95);
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
