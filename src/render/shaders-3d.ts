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

  // In Sacred-Geometry Wall-Scroll Preview Mode (u_blueprintMix = 1.0), compress Z relief
  // so the board lies flat like an etched celestial astrolabe parchment diagram, then extrudes
  // smoothly into full 3D relief (0.22 -> 1.0) when the player starts the level.
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
        vec3 goldBadge = mix(vec3(0.76, 0.58, 0.32), vec3(1.0, 0.90, 0.68), bLum);
        badgeRgb = mix(badgeRgb, goldBadge, u_blueprintMix);
      }
      outColor = vec4(badgeRgb, texel.a * u_color.a * mix(1.0, 0.86, u_blueprintMix));
      return;
    }
  }

  if (u_materialStyle == 4) {
    vec3 flatRgb = u_color.rgb;
    if (u_blueprintMix > 0.001) {
      flatRgb = mix(flatRgb, vec3(0.95, 0.77, 0.44), u_blueprintMix * 0.85);
    }
    outColor = vec4(flatRgb, u_color.a * mix(1.0, 0.62, u_blueprintMix));
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

  if (u_blueprintMix > 0.001) {
    // Sacred-Geometry Astrolabe Wall-Scroll Diagram Mode:
    // Transforms the 3D board into an illuminated nocturnal parchment & gilded brass architectural
    // blueprint matching the counter-rotating sacred-geometry astrolabe rings behind the board.
    float maxC = max(u_color.r, max(u_color.g, u_color.b));
    float minC = min(u_color.r, min(u_color.g, u_color.b));
    float sat = (maxC - minC) / max(maxC, 0.12);
    float isPiece = smoothstep(0.14, 0.30, sat);
    float isSunkenRoom = smoothstep(-0.02, -0.10, v_worldPos.z);

    vec2 relCenter = v_worldPos.xy - u_boardInfo.xy;
    float distCenter = length(relCenter);
    float radialGlow = clamp(1.0 - distCenter * 0.14, 0.0, 1.0);

    vec3 scrollPaper = mix(
      vec3(0.11, 0.085, 0.195),
      vec3(0.165, 0.125, 0.265),
      radialGlow
    );
    scrollPaper *= mix(1.0, 0.78, isSunkenRoom);
    float paperGrain =
      sin(v_worldPos.x * 38.0 + sin(v_worldPos.y * 29.0)) *
      cos(v_worldPos.y * 41.0 + sin(v_worldPos.x * 23.0)) * 0.015;
    scrollPaper += vec3(paperGrain);

    // Delicate architectural ink-wash for colored blocks & exit gates (28% hue + warm vellum)
    vec3 normPieceRgb = u_color.rgb / max(1.0 - isSunkenRoom * 0.40, 0.58);
    vec3 warmPieceHue = mix(clamp(normPieceRgb, 0.0, 1.0), vec3(0.96, 0.78, 0.48), 0.26);
    vec3 pieceWash = mix(scrollPaper + vec3(0.035, 0.025, 0.055), warmPieceHue, mix(0.29, 0.21, isSunkenRoom));
    vec3 scrollFill = mix(scrollPaper, pieceWash, isPiece);

    // 1. 3D Bevel, Chamfer & Circular Stud Rim Drafting Contours
    float bevelInk = smoothstep(0.95, 0.56, abs(N.z)) * mix(0.46, 0.92, isPiece);
    float studOutline = (v_localPos.z > 0.56 && N.z < 0.965) ? 0.95 : 0.0;

    // 2. Crisp World-Grid Blueprint Sub-Divisions & Inner Block Framing Rules
    vec2 cellUv = fract(v_worldPos.xy);
    float borderDist = min(min(cellUv.x, 1.0 - cellUv.x), min(cellUv.y, 1.0 - cellUv.y));
    float gridDraftLine = (1.0 - smoothstep(0.014, 0.042, borderDist)) * mix(0.30, 0.64, isPiece);
    float innerFrameRule =
      (1.0 - smoothstep(0.007, 0.022, abs(borderDist - 0.115))) * isPiece * 0.50;
    float cornerCross =
      (1.0 - smoothstep(0.01, 0.028, min(cellUv.x, 1.0 - cellUv.x))) *
      (1.0 - smoothstep(0.06, 0.14, min(cellUv.y, 1.0 - cellUv.y))) +
      (1.0 - smoothstep(0.01, 0.028, min(cellUv.y, 1.0 - cellUv.y))) *
      (1.0 - smoothstep(0.06, 0.14, min(cellUv.x, 1.0 - cellUv.x)));
    float floorTicks = clamp(cornerCross, 0.0, 1.0) * (1.0 - isPiece) * 0.36;

    // 3. Fine 45-Degree Architectural Pen Cross-Hatching
    float hatchA = sin((v_worldPos.x + v_worldPos.y) * 52.0);
    float hatchB = sin((v_worldPos.x - v_worldPos.y) * 52.0);
    float penHatch =
      smoothstep(0.76, 0.96, hatchA) * mix(0.07, 0.32, isPiece) +
      smoothstep(0.84, 0.98, hatchB) * 0.15 * isPiece;

    // 4. Sacred-Geometry Astrolabe Concentric Rings & 12-Spoke Compass Rays Across the Board
    float angle = atan(relCenter.y, relCenter.x);
    float ringWave = sin(distCenter * 8.37758 - u_boardInfo.z * 0.45);
    float astrolabeRing = smoothstep(0.92, 0.992, ringWave) * 0.28;
    float compassSpoke =
      smoothstep(0.965, 0.997, cos(angle * 12.0 + u_boardInfo.z * 0.14)) *
      smoothstep(0.25, 1.4, distCenter) * 0.18;

    float inkStrength = clamp(
      max(bevelInk, studOutline) +
      gridDraftLine +
      innerFrameRule +
      floorTicks +
      penHatch +
      astrolabeRing +
      compassSpoke,
      0.0,
      1.0
    );

    vec3 baseGold = mix(vec3(0.96, 0.74, 0.38), warmPieceHue, isPiece * 0.28);
    vec3 brightGold = vec3(1.0, 0.94, 0.78);
    vec3 goldInk = mix(baseGold, brightGold, clamp(inkStrength * 0.7, 0.0, 1.0));

    if (u_highContrast == 1) {
      scrollFill *= 0.65;
      inkStrength = clamp(inkStrength * 1.25 + bevelInk * 0.22, 0.0, 1.0);
      goldInk = mix(vec3(1.0, 0.88, 0.40), vec3(1.0, 0.99, 0.92), clamp(inkStrength, 0.0, 1.0));
    }

    vec3 scrollDiagram = mix(scrollFill, goldInk, inkStrength);
    lit = mix(lit, scrollDiagram, u_blueprintMix);
  }

  outColor = vec4(clamp(lit, 0.0, 1.0), u_color.a);
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
