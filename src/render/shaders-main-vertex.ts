/**
 * Main vertex shader (`R3D-02`): block/board transforms, stone-relic levitation twist (`rotateRelicVec`) and
 * `zRelief` bas-relief compression. Re-exported from `shaders-3d.ts`.
 */
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
uniform vec3 u_boardInfo; // x = cols * 0.5, y = rows * 0.5, z = timeSec (-1.0 when reducedMotion)

out vec3 v_worldPos;
out vec3 v_localPos;
out vec3 v_normal;
out vec2 v_uv;

vec3 rotateRelicVec(vec3 v, float rx, float ry, float rz) {
  float cz = cos(rz);
  float sz = sin(rz);
  vec3 r1 = vec3(v.x * cz - v.y * sz, v.x * sz + v.y * cz, v.z);
  float cx = cos(rx);
  float sx = sin(rx);
  vec3 r2 = vec3(r1.x, r1.y * cx - r1.z * sx, r1.y * sx + r1.z * cx);
  float cy = cos(ry);
  float sy = sin(ry);
  return vec3(r2.x * cy + r2.z * sy, r2.y, -r2.x * sy + r2.z * cy);
}

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
  v_uv = mix(u_uvRect.xy, u_uvRect.zw, a_uv);

  // In Satin Astrolabe Slate Title Mode (u_blueprintMix = 1.0), preserve tactile 3D block & stud depth
  // (zRelief = 0.76) while levitating the dormant precision-sealed board with a gentle floating twist
  // that settles seamlessly into grounded 3D gameplay as u_blueprintMix fades to 0.0.
  float zRelief = mix(1.0, 0.76, u_blueprintMix);
  vec3 stagePos = vec3(rawWorldPos.x, rawWorldPos.y, rawWorldPos.z * zRelief);
  vec3 worldNorm = normalize(n);

  if (u_blueprintMix > 0.001) {
    float relicEnv = smoothstep(0.0, 1.0, u_blueprintMix);
    if (u_boardInfo.z >= 0.0) {
      float t = u_boardInfo.z;
      float hoverZ = (0.14 + 0.11 * sin(t * 1.18) + 0.032 * sin(t * 2.36 + 0.7)) * relicEnv;
      vec2 driftXY = vec2(sin(t * 0.76) * 0.072, cos(t * 0.62 + 0.5) * 0.056) * relicEnv;
      float tiltX = sin(t * 0.94 + 0.3) * 0.054 * relicEnv;
      float tiltY = cos(t * 0.78 + 1.1) * 0.060 * relicEnv;
      float twistZ = (sin(t * 0.58) * 0.045 + sin(t * 1.22 + 1.7) * 0.014) * relicEnv;

      vec3 pivot = vec3(u_boardInfo.x, u_boardInfo.y, 0.08);
      stagePos = pivot + rotateRelicVec(stagePos - pivot, tiltX, tiltY, twistZ) + vec3(driftXY, hoverZ);
      worldNorm = normalize(rotateRelicVec(worldNorm, tiltX, tiltY, twistZ));
    } else {
      stagePos.z += 0.12 * relicEnv;
    }
  }

  v_normal = worldNorm;
  gl_Position = u_viewProj * vec4(stagePos, 1.0);
}
`;
