import { ENVIRONMENT_MESHES } from './mesh-generator';
import { INSTANCE_STRIDE } from './render-types';

/**
 * GPU-instanced particle shaders (`R3D-04`, `SHRED-STYLE-01`, `RELIC-AWAKEN-01`):
 * 5 distinct shredder styles, tumbling stone shards, rising relic embers, and billboard smoke puffs.
 * Zero fragment `discard` so mobile tile-GPU LRZ Early-Z stays active.
 */
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
flat out float v_archetype; // 0=style particle, 1=stone shard, 2=smoke puff, 3=relic ember (RELIC-AWAKEN-01)
flat out float v_life;
flat out float v_lifeRatio;
out float v_fade;

void main() {
  float angle = a_instColorRot.w;
  float c = cos(angle);
  float s = sin(angle);

  vec3 p = a_position;
  vec3 n = a_normal;
  float w = a_instPosScale.w;
  v_archetype = w <= -10.0 ? 2.0 : (w <= -5.0 ? 3.0 : (w < 0.0 ? 1.0 : 0.0));
  v_life = a_instColorRot.w;
  v_lifeRatio = 1.0;
  v_fade = 1.0;
  v_color = a_instColorRot.rgb;
  v_localPos = a_position;

  if (v_archetype > 2.5) {
    // Relic-awakening ember: exact tumbling micro-ember trajectory (RELIC-AWAKEN-01)
    p = a_position * (-w - 5.0);
    vec3 rotatedEmber = vec3(
      p.x * c - p.y * s,
      p.x * s + p.y * c,
      p.z * c - p.x * s * 0.3
    );
    v_normal = n;
    gl_Position = u_viewProj * vec4(rotatedEmber + a_instPosScale.xyz, 1.0);
    return;
  }
  if (v_archetype > 1.5) {
    // Camera-facing billboard smoke puff (camera pitch ~78deg: up = (0, -0.978, 0.208))
    float sz = -w - 10.0;
    vec3 worldPos = a_instPosScale.xyz + vec3(p.x, -0.978 * p.y, 0.208 * p.y) * sz * 2.0;
    v_normal = vec3(0.0, 0.21, 0.97);
    gl_Position = u_viewProj * vec4(worldPos, 1.0);
    return;
  }
  if (v_archetype > 0.5) {
    // Irregular fractured stone slab with full 3-axis tumble
    p = vec3(p.x * 1.32, p.y * 0.92, p.z * 0.72) * (-w);
    float ax = angle * 1.3;
    float ca = cos(ax);
    float sa = sin(ax);
    p = vec3(p.x, p.y * ca - p.z * sa, p.y * sa + p.z * ca);
    n = vec3(n.x, n.y * ca - n.z * sa, n.y * sa + n.z * ca);
    p = vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
    v_normal = vec3(n.x * c - n.y * s, n.x * s + n.y * c, n.z);
    gl_Position = u_viewProj * vec4(p + a_instPosScale.xyz, 1.0);
    return;
  }

  // Gameplay shred & ambient particles pack 10-bit lifeRatio in floor(w) and physical scale in fract(w)
  float lifeRatio = clamp(floor(w) / 1023.0, 0.0, 1.0);
  v_lifeRatio = lifeRatio;
  w = fract(w);
  vec3 worldOffset;

  if (u_particleStyle == 1) {
    // star_confetti: fluttering 5-point foil star wafer with bounded front-facing 3D tilt
    p = vec3(p.x * 1.62, p.y * 1.62, p.z * 0.12) * w;
    float tilt = sin(angle * 1.4) * 0.65;
    float ct = cos(tilt);
    float st = sin(tilt);
    p = vec3(p.x, p.y * ct - p.z * st, p.y * st + p.z * ct);
    n = vec3(n.x, n.y * ct - n.z * st, n.y * st + n.z * ct);
    worldOffset = vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
    v_normal = vec3(n.x * c - n.y * s, n.x * s + n.y * c, n.z);
  } else if (u_particleStyle == 2) {
    // pixel_sparks: velocity-aligned incandescent laser streak (angle = atan2(vy, vx))
    p = vec3(p.x * 2.35, p.y * 0.34, p.z * 0.34) * w;
    worldOffset = vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
    v_normal = vec3(n.x * c - n.y * s, n.x * s + n.y * c, n.z);
  } else if (u_particleStyle == 3) {
    // soap_bubbles: camera-facing right-handed billboard housing an analytic ray-traced 3D thin-film sphere
    float wob = 0.068 * sin(angle * 2.4 + lifeRatio * 6.283);
    float rx = (1.0 + wob) * w * 2.24;
    float ry = (1.0 - wob) * w * 2.24;
    worldOffset =
      vec3(1.0, 0.0, 0.0) * (a_position.x * rx) +
      vec3(0.0, 0.978, -0.208) * (a_position.y * ry) +
      vec3(0.0, 0.208, 0.978) * (a_position.z * 0.02 * w);
    v_normal = vec3(0.0, 0.208, 0.978);
  } else if (u_particleStyle == 4) {
    // lightning_bolts: compact velocity-aligned electric plasma spark streak
    float boltTaper = mix(0.45, 1.0, smoothstep(0.0, 0.38, lifeRatio));
    p = vec3(p.x * 1.95, p.y * 0.72 * boltTaper, p.z * 0.02) * w;
    worldOffset = vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
    v_normal = vec3(0.0, 0.208, 0.978);
  } else {
    // micro_cubes (0): full 3-axis tumbling beveled voxel cube
    p = p * w;
    float ax0 = angle * 0.82;
    float ca0 = cos(ax0);
    float sa0 = sin(ax0);
    p = vec3(p.x, p.y * ca0 - p.z * sa0, p.y * sa0 + p.z * ca0);
    n = vec3(n.x, n.y * ca0 - n.z * sa0, n.y * sa0 + n.z * ca0);
    worldOffset = vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
    v_normal = vec3(n.x * c - n.y * s, n.x * s + n.y * c, n.z);
  }

  vec4 clipPos = u_viewProj * vec4(worldOffset + a_instPosScale.xyz, 1.0);
  vec2 ndc = clipPos.xy / max(0.0001, abs(clipPos.w));
  float edgeFade = u_particleStyle == 3
    ? smoothstep(0.996, 0.86, max(abs(ndc.x), abs(ndc.y)))
    : smoothstep(0.992, 0.80, max(abs(ndc.x), abs(ndc.y)));
  float lifeFade = u_particleStyle == 3
    ? smoothstep(0.0, 0.16, lifeRatio)
    : u_particleStyle == 4
      ? smoothstep(0.0, 0.28, lifeRatio)
      : smoothstep(0.0, 0.42, lifeRatio);
  v_fade = lifeFade * edgeFade;
  gl_Position = clipPos;
}
`;

export const PARTICLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

in vec3 v_normal;
in vec3 v_color;
in vec3 v_localPos;
flat in float v_archetype;
flat in float v_life;
flat in float v_lifeRatio;
in float v_fade;

uniform int u_particleStyle; // 0=micro_cubes, 1=star_confetti, 2=pixel_sparks, 3=soap_bubbles, 4=lightning_bolts

out vec4 outColor;

void main() {
  vec3 N = normalize(v_normal);
  vec3 L = normalize(vec3(-0.3, -0.5, 0.8));
  vec3 V = normalize(vec3(0.0, 0.21, 0.97));
  float light = 0.62 + max(dot(N, L), 0.0) * 0.45;

  if (v_archetype > 2.5) {
    outColor = vec4(clamp(v_color * light, 0.0, 1.0), 0.95);
    return;
  }
  if (v_archetype > 1.5) {
    // Soft volumetric smoke/dust puff: single-sided 2-triangle quad using exact composite alpha
    // a1 * (2.0 - a1), with zero fragment discard so mobile tile-GPU LRZ Early-Z stays active.
    float r = min(1.0, length(v_localPos.xy) * 2.0);
    float puff = smoothstep(1.0, 0.1, r);
    float fade = smoothstep(1.0, 0.86, v_life) * smoothstep(0.0, 0.55, v_life);
    vec3 col = v_color * (0.86 + 0.28 * (1.0 - r)) + vec3(0.98, 0.82, 0.5) * 0.2 * fade * (1.0 - r);
    float a1 = puff * fade * 0.58;
    float a = a1 * (2.0 - a1);
    outColor = vec4(clamp(col, 0.0, 1.0), a);
    return;
  }
  if (v_archetype > 0.5) {
    // Chiseled weathered stone shard with glowing amethyst-orchid-gold fracture edges
    vec3 lp = abs(v_localPos);
    float edgeCount = smoothstep(0.34, 0.47, lp.x) + smoothstep(0.34, 0.47, lp.y) + smoothstep(0.34, 0.47, lp.z);
    float edge = smoothstep(1.25, 1.9, edgeCount);
    float grit = sin(v_localPos.x * 37.0) * cos(v_localPos.y * 41.0) * 0.05;
    vec3 stone = v_color * (light + grit);
    float hueSel = fract(v_color.r * 13.0 + v_color.b * 7.0);
    vec3 glow = hueSel < 0.45 ? vec3(0.82, 0.4, 1.0) : (hueSel < 0.8 ? vec3(0.98, 0.5, 0.86) : vec3(1.0, 0.78, 0.42));
    outColor = vec4(clamp(mix(stone, glow, edge * 0.78), 0.0, 1.0), 1.0);
    return;
  }

  if (u_particleStyle == 1) {
    // star_confetti: 5-point polar star SDF with metallic foil specular flash (zero discard)
    float r = length(v_localPos.xy);
    float ang = atan(v_localPos.y, v_localPos.x) + 1.5708;
    float starR = mix(0.2, 0.49, pow(0.5 + 0.5 * cos(ang * 5.0), 1.35));
    float starMask = smoothstep(starR + 0.048, starR - 0.032, r);
    float foil = 0.76 + 0.54 * pow(abs(dot(N, L)), 1.6);
    float centerGlint = smoothstep(0.24, 0.0, r) * 0.28;
    vec3 col = mix(v_color * foil, vec3(1.0, 0.96, 0.82), 0.24 + centerGlint);
    outColor = vec4(clamp(col, 0.0, 1.0), starMask * 0.96 * v_fade);
    return;
  } else if (u_particleStyle == 2) {
    // pixel_sparks: incandescent white-hot spine tapering along velocity streak
    float spine = clamp(1.0 - abs(v_localPos.y) * 1.85, 0.0, 1.0);
    float tipFade = smoothstep(0.52, 0.18, abs(v_localPos.x));
    float core = spine * (0.55 + 0.45 * tipFade);
    vec3 col = mix(v_color * 1.28, vec3(1.0, 0.98, 0.86), core * 0.78);
    outColor = vec4(clamp(col, 0.0, 1.0), clamp(0.68 + core * 0.32, 0.0, 0.99) * v_fade);
    return;
  } else if (u_particleStyle == 3) {
    // soap_bubbles: analytic ray-sphere 3D curvature + rainbow thin-film Fresnel rim + window glints (zero discard)
    vec2 uv = v_localPos.xy * 2.0;
    float r2 = dot(uv, uv);
    float r = sqrt(r2);
    float circleMask = smoothstep(1.0, 0.89, r);
    float sz = sqrt(max(0.0, 1.0 - min(1.0, r2)));
    vec3 sN = vec3(uv.x, uv.y, sz);
    float fresnel = pow(1.0 - sz, 2.25);
    float filmPhase = fresnel * 1.85 + uv.x * 0.54 - uv.y * 0.38 + fract(v_life * 0.17);
    vec3 rainbow = 0.56 + 0.44 * cos(6.28318 * (filmPhase + vec3(0.0, 0.33, 0.67)));
    vec3 tintRim = mix(v_color * 1.08 + vec3(0.14), rainbow, 0.58);
    float keySpec = smoothstep(0.83, 0.975, max(dot(sN, normalize(vec3(-0.42, -0.48, 0.77))), 0.0));
    float bounceSpec = smoothstep(0.88, 0.985, max(dot(sN, normalize(vec3(0.46, 0.44, 0.77))), 0.0)) * 0.58;
    float rimRing = smoothstep(0.54, 0.93, r) * circleMask;
    vec3 col = mix(tintRim, vec3(0.98, 0.995, 1.0), clamp(keySpec + bounceSpec + rimRing * 0.34, 0.0, 1.0));
    float bubbleAlpha = clamp(0.18 + rimRing * 0.72 + (keySpec + bounceSpec) * 0.84, 0.0, 0.96);
    outColor = vec4(clamp(col, 0.0, 1.0), bubbleAlpha * circleMask * v_fade);
    return;
  } else if (u_particleStyle == 4) {
    // lightning_bolts: sleek glowing electric plasma spark with strobing ionized head & comet tail (zero discard)
    float lx = v_localPos.x;
    float ly = v_localPos.y;
    float phase = (1.0 - v_lifeRatio) * 42.0 + v_life * 5.1;
    float edgeMask = smoothstep(0.50, 0.32, max(abs(lx), abs(ly)));
    float tailT = smoothstep(-0.42, 0.34, lx);
    float clampedX = clamp(lx, -0.38, 0.34);
    float d = length(vec2((lx - clampedX) * 1.4, ly));
    vec2 headDelta = vec2((lx - 0.24) * 1.15, ly);
    float headOrb = exp(-dot(headDelta, headDelta) * 34.0);
    float corona = (exp(-d * d * 24.0) * (0.35 + 0.65 * tailT) + headOrb * 0.55) * edgeMask;
    float core = (exp(-d * d * 180.0) * tailT + exp(-dot(headDelta, headDelta) * 110.0) * 0.95) * edgeMask;
    float strobe = 0.56 + 0.44 * sin(phase * 2.1);
    vec3 sparkHue = mix(v_color, vec3(0.10, 0.84, 1.0), 0.60);
    vec3 col = mix(sparkHue, vec3(0.99, 0.998, 1.0), clamp(core * v_fade, 0.0, 1.0));
    float alpha = clamp((corona * 0.66 + core * 0.86) * strobe, 0.0, 0.98) * v_fade;
    outColor = vec4(clamp(col, 0.0, 1.0), alpha);
    return;
  }

  // micro_cubes (0): sculpted 3D chamfered voxel with crisp edge bevel catch-light
  vec3 lp0 = abs(v_localPos);
  float bevel = smoothstep(0.34, 0.48, max(lp0.x, max(lp0.y, lp0.z)));
  vec3 cubeCol = v_color * light + vec3(1.0, 0.97, 0.9) * (bevel * 0.16 * max(dot(N, L), 0.15));
  outColor = vec4(clamp(cubeCol, 0.0, 1.0), 0.97 * v_fade);
}
`;

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

const SMOKE_QUAD_POSITIONS = new Float32Array([
  -0.5, -0.5, 0.0, 0.5, -0.5, 0.0, 0.5, 0.5, 0.0, -0.5, 0.5, 0.0,
]);
const SMOKE_QUAD_NORMALS = new Float32Array([
  0.0, 0.21, 0.97, 0.0, 0.21, 0.97, 0.0, 0.21, 0.97, 0.0, 0.21, 0.97,
]);
const SMOKE_QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);

/**
 * Dedicated 4-vertex (2-triangle) billboard quad VAO + separate instance buffer for translucent smoke puffs
 * (`PERF-TRANSITION-01`), avoiding 24-vertex cube double-face overdraw and mid-pass VBO write hazards on tile GPUs.
 */
export function createSmokeBillboardInstancedVao(
  gl: WebGL2RenderingContext,
  instanceByteLength: number
): ParticleInstancedVaoHandle | null {
  const vao = gl.createVertexArray();
  const posBuf = gl.createBuffer();
  const normBuf = gl.createBuffer();
  const idxBuf = gl.createBuffer();
  const instBuf = gl.createBuffer();
  if (!vao || !posBuf || !normBuf || !idxBuf || !instBuf) return null;

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, SMOKE_QUAD_POSITIONS, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
  gl.bufferData(gl.ARRAY_BUFFER, SMOKE_QUAD_NORMALS, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, SMOKE_QUAD_INDICES, gl.STATIC_DRAW);

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

  return { vao, posBuf, normBuf, idxBuf, instBuf, indexCount: SMOKE_QUAD_INDICES.length };
}
