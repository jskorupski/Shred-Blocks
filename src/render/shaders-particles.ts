/**
 * GPU-instanced particle shaders (`R3D-04`, `RELIC-AWAKEN-01`): style particles, tumbling stone shards,
 * and billboard smoke puffs. Re-exported from `shaders-3d.ts` for zero-friction imports.
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
flat out float v_archetype; // 0=style particle, 1=stone shard, 2=smoke puff (RELIC-AWAKEN-01)
flat out float v_life;

void main() {
  float angle = a_instColorRot.w;
  float c = cos(angle);
  float s = sin(angle);

  vec3 p = a_position;
  vec3 n = a_normal;
  float w = a_instPosScale.w;
  v_archetype = w <= -10.0 ? 2.0 : (w < 0.0 ? 1.0 : 0.0);
  v_life = a_instColorRot.w;
  v_color = a_instColorRot.rgb;
  v_localPos = a_position;

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

  gl_Position = u_viewProj * vec4(worldPos, 1.0);
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

uniform int u_particleStyle; // 0=micro_cubes, 1=star_confetti, 2=pixel_sparks, 3=soap_bubbles, 4=lightning_bolts

out vec4 outColor;

void main() {
  vec3 N = normalize(v_normal);
  vec3 L = normalize(vec3(-0.3, -0.5, 0.8));
  vec3 V = normalize(vec3(0.0, 0.21, 0.97));
  float light = 0.62 + max(dot(N, L), 0.0) * 0.45;

  if (v_archetype > 1.5) {
    // Soft volumetric smoke/dust puff: radial falloff, smooth fade-in + fade-out, warm inner glow
    float r = length(v_localPos.xy) * 2.0;
    float puff = smoothstep(1.0, 0.1, r);
    float fade = smoothstep(1.0, 0.86, v_life) * smoothstep(0.0, 0.55, v_life);
    vec3 col = v_color * (0.86 + 0.28 * (1.0 - r)) + vec3(0.98, 0.82, 0.5) * 0.2 * fade * (1.0 - r);
    float a = puff * fade * 0.58;
    if (a < 0.004) discard;
    outColor = vec4(clamp(col, 0.0, 1.0), a);
    return;
  }
  if (v_archetype > 0.5) {
    // Chiseled weathered stone shard with glowing amethyst-orchid-gold fracture edges (matches relic crack glow)
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
