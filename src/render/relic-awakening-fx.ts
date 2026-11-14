import { fxRandom } from '../core/fx-random';
import { isBlockInLockedRoom } from '../core/physics';
import { getShape } from '../core/polyomino';
import type { BoardState, SkinId, TrayId } from '../core/types';
import { ENVIRONMENT_MESHES, type MeshData, POLYOMINO_MESH_CATALOG } from './mesh-generator';
import {
  allocParticleSlot,
  type GLMeshHandle,
  getStoneThemeMineralTint,
  getTrayMaterialCode,
  INSTANCE_STRIDE,
  RELIC_EMBER_SCALE_OFFSET,
  type RenderPassContext,
  SMOKE_SCALE_OFFSET,
} from './render-types';
import type { ParticleInstancedVaoHandle } from './shaders-3d';

/**
 * Relic Awakening Transformation (`RELIC-AWAKEN-01`):
 * When the player taps Play on the Title Screen, the levitating stone relic bursts apart —
 * tumbling 3D theme-tinted stone shards fly off, ancient dust/smoke billows upward, warm amethyst & gold embers rise,
 * and concentric glow shockwaves sweep the board as vibrant gameplay colors emerge underneath.
 * Never spawns when `reducedMotion === true`.
 */

const ASTROLABE_SHARD_TONES: ReadonlyArray<[number, number, number]> = [
  [0.34, 0.32, 0.46],
  [0.25, 0.24, 0.36],
  [0.48, 0.46, 0.58],
  [0.88, 0.73, 0.46],
  [0.3, 0.28, 0.42],
];

function writeParticle(
  rctx: RenderPassContext,
  px: number,
  py: number,
  pz: number,
  vx: number,
  vy: number,
  vz: number,
  rgb: readonly [number, number, number],
  scale: number,
  maxAge: number,
  rot: number,
  rotSpeed: number
): void {
  const idx = allocParticleSlot(rctx);
  const pool = rctx.particlePool;
  pool[idx + 0] = px;
  pool[idx + 1] = py;
  pool[idx + 2] = pz;
  pool[idx + 3] = vx;
  pool[idx + 4] = vy;
  pool[idx + 5] = vz;
  pool[idx + 6] = rgb[0];
  pool[idx + 7] = rgb[1];
  pool[idx + 8] = rgb[2];
  pool[idx + 9] = scale;
  pool[idx + 10] = 0.001;
  pool[idx + 11] = maxAge;
  pool[idx + 12] = rot;
  pool[idx + 13] = rotSpeed;
  pool[idx + 14] = -1;
}

export function spawnRelicAwakeningBurstImpl(rctx: RenderPassContext, board: BoardState): void {
  if (rctx.lastOptions.reducedMotion) return;
  const rand = fxRandom; // seedable for deterministic golden screenshots (VISUAL-GOLDEN-01)
  const isUltra = rctx.qualityGovernor.getActiveTier() === 'ULTRA_120';
  const density = isUltra ? 1 : 0.6;
  const cx = board.cols * 0.5;
  const cy = board.rows * 0.5;
  const span = Math.max(board.cols, board.rows);

  // 1. Glow shockwaves in the relic crack-glow palette: bright orchid flash above the blocks,
  //    amethyst wave sweeping the floor, and a trailing sanctuary-gold ring
  rctx.spawnShockwave(cx, cy, 0.66, 0.98, 0.62, 1.0, 0.16, span * 0.42, 0.52);
  rctx.spawnShockwave(cx, cy, 0.04, 0.8, 0.38, 1.0, 0.34, span * 0.66, 0.78);
  rctx.spawnShockwave(cx, cy, 0.36, 1.0, 0.78, 0.42, 0.24, span * 0.54, 0.4);

  // 2. Tactile board micro-recoil + staggered block awakening bounces
  rctx.boardShakeTimer = 0.16;
  rctx.boardShakeDirX = 0.7;
  rctx.boardShakeDirY = 0.7;

  // Collect stone-relic source cells (active block cells + perimeter rim)
  const cells: Array<[number, number, number]> = [];
  for (const blk of board.blocks) {
    if (blk.status !== 'ACTIVE') continue;
    if (!isBlockInLockedRoom(board, blk)) rctx.blockBounceMap.set(blk.id, 0.3 + rand() * 0.12);
    for (const [r, c] of getShape(blk.shapeId).cells) {
      cells.push([blk.x + c + 0.5, blk.y + r + 0.5, 0.6]);
    }
  }
  const rimCount = Math.round(18 * density);
  const { cols, rows } = board;
  const perim = 2 * (cols + rows);
  for (let i = 0; i < rimCount; i++) {
    const d = (i / rimCount) * perim;
    let px: number;
    let py: number;
    if (d < cols) {
      px = d;
      py = -0.35;
    } else if (d < cols + rows) {
      px = cols + 0.35;
      py = d - cols;
    } else if (d < 2 * cols + rows) {
      px = 2 * cols + rows - d;
      py = rows + 0.35;
    } else {
      px = -0.35;
      py = perim - d;
    }
    cells.push([px, py, 0.5]);
  }
  if (cells.length === 0) cells.push([cx, cy, 0.4]);

  // 3. Tumbling 3D fractured stone shards flying outward & upward (tinted to active theme stone)
  const stoneTint = getStoneThemeMineralTint(rctx.lastOptions.equippedTray, rctx.lastOptions.equippedSkin);
  const shardCount = Math.round(68 * density);
  for (let i = 0; i < shardCount; i++) {
    const [sx, sy, sz] = cells[i % cells.length];
    const jx = sx + (rand() - 0.5) * 0.7;
    const jy = sy + (rand() - 0.5) * 0.7;
    let dx = jx - cx;
    let dy = jy - cy;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const speed = 1.4 + rand() * 2.8;
    const ang = (rand() - 0.5) * 0.9;
    const vx = (dx * Math.cos(ang) - dy * Math.sin(ang)) * speed;
    const vy = (dx * Math.sin(ang) + dy * Math.cos(ang)) * speed;
    const baseTone = ASTROLABE_SHARD_TONES[i % ASTROLABE_SHARD_TONES.length];
    const shardRgb: [number, number, number] = [
      Math.min(1, baseTone[0] * stoneTint[0]),
      Math.min(1, baseTone[1] * stoneTint[1]),
      Math.min(1, baseTone[2] * stoneTint[2]),
    ];
    writeParticle(
      rctx,
      jx,
      jy,
      sz + rand() * 0.1,
      vx,
      vy,
      2.6 + rand() * 2.8,
      shardRgb,
      -(0.14 + rand() * 0.12),
      0.85 + rand() * 0.4,
      rand() * 6.283,
      (rand() < 0.5 ? -1 : 1) * (9 + rand() * 7)
    );
  }

  // 4. Billowing twilight-slate vapor & warm amethyst-champagne glowing mist puffs
  //    Scaled to active source cell count so compact 5x5 boards avoid excessive alpha overdraw.
  const baseSmoke = Math.min(44, Math.max(28, Math.round(cells.length * 0.9)));
  const smokeCount = Math.round(baseSmoke * density);
  for (let i = 0; i < smokeCount; i++) {
    const [sx, sy] = cells[(i * 7) % cells.length];
    const glowTint = i % 5 === 0 ? [0.84, 0.52, 0.98] : i % 4 === 0 ? [0.98, 0.8, 0.54] : null;
    const mist = 0.46 + rand() * 0.14;
    const rgb: [number, number, number] = glowTint
      ? [glowTint[0], glowTint[1], glowTint[2]]
      : [
          Math.min(1, mist * 0.94 * stoneTint[0]),
          Math.min(1, mist * 0.9 * stoneTint[1]),
          Math.min(1, mist * 1.18 * stoneTint[2]),
        ];
    const ang = rand() * 6.283;
    const drift = 0.4 + rand() * 1.1;
    writeParticle(
      rctx,
      sx + (rand() - 0.5) * 0.6,
      sy + (rand() - 0.5) * 0.6,
      0.5 + rand() * 0.3,
      Math.cos(ang) * drift,
      Math.sin(ang) * drift,
      0.6 + rand() * 0.9,
      rgb,
      -(SMOKE_SCALE_OFFSET + 0.5 + rand() * 0.36),
      0.92 + rand() * 0.52,
      0,
      0
    );
  }

  // 5. Incandescent warm amethyst, orchid & golden embers rising through the smoke
  const emberCount = Math.round(38 * density);
  for (let i = 0; i < emberCount; i++) {
    const [sx, sy] = cells[(i * 3) % cells.length];
    const rgb: [number, number, number] =
      i % 3 === 0 ? [0.88, 0.46, 1.0] : i % 3 === 1 ? [0.98, 0.56, 0.86] : [1.0, 0.8, 0.38];
    writeParticle(
      rctx,
      sx,
      sy,
      0.62,
      (rand() - 0.5) * 1.6,
      (rand() - 0.5) * 1.6,
      3.2 + rand() * 2.2,
      rgb,
      -(RELIC_EMBER_SCALE_OFFSET + 0.045 + rand() * 0.035),
      0.6 + rand() * 0.4,
      rand() * 6.283,
      (rand() < 0.5 ? -1 : 1) * 6
    );
  }
}

export interface ParticleDrawHandles {
  program: WebGLProgram | null;
  vao: WebGLVertexArrayObject | null;
  instanceBuffer: WebGLBuffer | null;
  indexCount: number;
  smokeVao: WebGLVertexArrayObject | null;
  smokeInstanceBuffer: WebGLBuffer | null;
  smokeIndexCount: number;
  uViewProj: WebGLUniformLocation | null;
  uStyle: WebGLUniformLocation | null;
}

/**
 * Pass 4: GPU-instanced particles. Solid particles & stone shards draw on `vao` with depth writes;
 * translucent smoke puffs draw on a dedicated 2-triangle `smokeVao` + `smokeInstanceBuffer` with
 * `depthMask(false)` so tile GPUs never experience mid-pass VBO write hazards or double-face cube overdraw.
 */
export function renderPass4ParticlesImpl(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  h: ParticleDrawHandles,
  styleCode: number
): void {
  const solid = rctx.activeParticleCount;
  const smoke = rctx.activeSmokeCount;
  if (solid + smoke <= 0 || !h.program) return;

  gl.useProgram(h.program);
  gl.uniformMatrix4fv(h.uViewProj, false, rctx.camera.getViewProjectionMatrix(false));
  gl.uniform1i(h.uStyle, styleCode);

  if (solid > 0 && h.vao && h.instanceBuffer) {
    const translucentGameplay =
      (rctx.lastOptions.blueprintMix ?? 0) <= 0.01 || Boolean(rctx.hasGameplayParticles);
    const additiveLightning =
      styleCode === 4 && Boolean(rctx.hasGameplayParticles) && (rctx.lastOptions.blueprintMix ?? 0) <= 0.01;
    gl.bindVertexArray(h.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, h.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, rctx.particleInstanceData.subarray(0, solid * INSTANCE_STRIDE));
    if (translucentGameplay) {
      gl.depthMask(false);
    }
    if (additiveLightning) {
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.drawElementsInstanced(gl.TRIANGLES, h.indexCount, gl.UNSIGNED_SHORT, 0, solid);
    if (additiveLightning) {
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    if (translucentGameplay) {
      gl.depthMask(true);
    }
  }
  if (smoke > 0 && h.smokeVao && h.smokeInstanceBuffer) {
    gl.bindVertexArray(h.smokeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, h.smokeInstanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, rctx.smokeInstanceData.subarray(0, smoke * INSTANCE_STRIDE));
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.drawElementsInstanced(gl.TRIANGLES, h.smokeIndexCount, gl.UNSIGNED_SHORT, 0, smoke);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
  }
  gl.bindVertexArray(null);
}

const WARMUP_SOLID_INST = new Float32Array([0, 0, -50, -0.1, 0.3, 0.3, 0.4, 0]);
const WARMUP_SMOKE_INST = new Float32Array([0, 0, -50, -10.5, 0.4, 0.4, 0.5, 0.5]);

/**
 * Pre-warms WebGL2 / ANGLE-Vulkan hardware pipeline state objects (`VkPipeline`) inside a 1x1
 * color-masked scissor box during `initWebGLResources()` (`PERF-TRANSITION-01`) so Frame 1 of
 * clicking Play and Frame 1 of block shredding never suffer lazy mobile driver PSO compilation stalls.
 */
export function warmUpWebGLPipelinesImpl(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  mainProgram: WebGLProgram,
  uViewProj: WebGLUniformLocation | null,
  uBlueprintMix: WebGLUniformLocation | null,
  uAtlas: WebGLUniformLocation | null,
  atlasTexture: WebGLTexture | null,
  h: ParticleDrawHandles
): void {
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(0, 0, 1, 1);
  gl.colorMask(false, false, false, false);
  gl.depthMask(false);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  gl.useProgram(mainProgram);
  gl.uniformMatrix4fv(uViewProj, false, rctx.camera.getViewProjectionMatrix(false));
  gl.uniform1i(rctx.uUseClipPlane, 0);
  gl.uniform4f(rctx.uClipPlane, 0, 0, 1, 0);
  if (atlasTexture) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
    gl.uniform1i(uAtlas, 0);
  }

  for (const mix of [1.0, 0.5, 0.0]) {
    gl.uniform1f(uBlueprintMix, mix);
    rctx.drawMesh(
      gl,
      ENVIRONMENT_MESHES.unitParticleCube,
      0,
      0,
      -50,
      0.01,
      0.01,
      0.01,
      0.5,
      0.5,
      0.5,
      1,
      0,
      0,
      0
    );
  }
  rctx.drawAtlasBadge(gl, 'DIGIT_1', 0, 0, -50, 0.01, 1, 1, 1, 1);
  gl.disable(gl.CULL_FACE);
  gl.uniform1i(rctx.uUseClipPlane, 1);
  rctx.drawMesh(
    gl,
    ENVIRONMENT_MESHES.unitParticleCube,
    0,
    0,
    -50,
    0.01,
    0.01,
    0.01,
    0.5,
    0.5,
    0.5,
    1,
    0,
    0,
    0
  );
  gl.uniform1i(rctx.uUseClipPlane, 0);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform1i(rctx.uTraceCount, 2);
  if (rctx.uTracePts) {
    gl.uniform4fv(rctx.uTracePts, new Float32Array([0, 0, 0.5, 0.1, 1, 0, 0.5, 0.1]));
  }
  rctx.drawMesh(gl, ENVIRONMENT_MESHES.overlayQuad, 0, 0, -50, 0.01, 0.01, 1, 0.3, 0.9, 1.0, 0.5, 0, 0, 8);
  gl.uniform1i(rctx.uTraceCount, 0);
  gl.uniform4f(rctx.uClipPlane, 0.2, 0.2, 1.0, 0.0);
  rctx.drawMesh(gl, ENVIRONMENT_MESHES.overlayQuad, 0, 0, -50, 0.01, 0.01, 1, 0.3, 0.9, 1.0, 0.5, 0, 0, 9);
  gl.uniform4f(rctx.uClipPlane, 0, 0, 1, 0);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  rctx.drawMesh(gl, ENVIRONMENT_MESHES.overlayQuad, 0, 0, -50, 0.01, 0.01, 1, 0.3, 0.9, 1.0, 0.5, 0, 0, 4);
  rctx.drawMesh(gl, ENVIRONMENT_MESHES.overlayQuad, 0, 0, -50, 0.01, 0.01, 1, 0.3, 0.9, 1.0, 0.5, 0, 0, 7);
  gl.enable(gl.CULL_FACE);

  if (h.program && h.vao && h.instanceBuffer && h.smokeVao && h.smokeInstanceBuffer) {
    gl.useProgram(h.program);
    gl.uniformMatrix4fv(h.uViewProj, false, rctx.camera.getViewProjectionMatrix(false));
    gl.uniform1i(h.uStyle, 0);

    gl.depthMask(true);
    gl.bindVertexArray(h.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, h.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, WARMUP_SOLID_INST);
    gl.drawElementsInstanced(gl.TRIANGLES, h.indexCount, gl.UNSIGNED_SHORT, 0, 1);

    gl.depthMask(false);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(h.uStyle, 4);
    gl.drawElementsInstanced(gl.TRIANGLES, h.indexCount, gl.UNSIGNED_SHORT, 0, 1);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(h.smokeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, h.smokeInstanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, WARMUP_SMOKE_INST);
    gl.drawElementsInstanced(gl.TRIANGLES, h.smokeIndexCount, gl.UNSIGNED_SHORT, 0, 1);
    gl.enable(gl.CULL_FACE);
  }

  gl.bindVertexArray(null);
  gl.colorMask(true, true, true, true);
  gl.depthMask(true);
  gl.disable(gl.SCISSOR_TEST);
  gl.flush();
}

export function disposeWebGLResourcesImpl(
  gl: WebGL2RenderingContext | null,
  meshHandles: Map<MeshData, GLMeshHandle>,
  particleHandle: ParticleInstancedVaoHandle | null,
  smokeHandle: ParticleInstancedVaoHandle | null,
  atlasTexture: WebGLTexture | null,
  mainProgram: WebGLProgram | null,
  particleProgram: WebGLProgram | null
): void {
  if (gl && !gl.isContextLost()) {
    for (const handle of meshHandles.values()) {
      gl.deleteVertexArray(handle.vao);
      gl.deleteBuffer(handle.posBuffer);
      gl.deleteBuffer(handle.normBuffer);
      gl.deleteBuffer(handle.uvBuffer);
      gl.deleteBuffer(handle.indexBuffer);
    }
    for (const h of [particleHandle, smokeHandle]) {
      if (!h) continue;
      gl.deleteVertexArray(h.vao);
      gl.deleteBuffer(h.posBuf);
      gl.deleteBuffer(h.normBuf);
      gl.deleteBuffer(h.idxBuf);
      gl.deleteBuffer(h.instBuf);
    }
    if (atlasTexture) gl.deleteTexture(atlasTexture);
    if (mainProgram) gl.deleteProgram(mainProgram);
    if (particleProgram) gl.deleteProgram(particleProgram);
  }
  meshHandles.clear();
}

export function uploadAtlasAndStaticMeshesImpl(
  gl: WebGL2RenderingContext,
  atlasCanvas: HTMLCanvasElement,
  ensureMesh: (gl: WebGL2RenderingContext, mesh: MeshData) => GLMeshHandle
): WebGLTexture | null {
  const tex = gl.createTexture();
  if (tex) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
  }
  for (const entry of Object.values(POLYOMINO_MESH_CATALOG)) {
    for (const m of [
      entry.meshOuter,
      entry.meshInnerCore,
      entry.meshOuterStudded,
      entry.meshInnerCoreStudded,
      entry.meshOuterWorn,
      entry.meshInnerCoreWorn,
    ]) {
      ensureMesh(gl, m);
    }
  }
  for (const envMesh of Object.values(ENVIRONMENT_MESHES) as MeshData[]) {
    ensureMesh(gl, envMesh);
  }
  return tex;
}

export function createEmptyParticleDrawHandles(): ParticleDrawHandles {
  return {
    program: null,
    vao: null,
    instanceBuffer: null,
    indexCount: 0,
    smokeVao: null,
    smokeInstanceBuffer: null,
    smokeIndexCount: 0,
    uViewProj: null,
    uStyle: null,
  };
}

export function resetTransientFxImpl(rctx: RenderPassContext): void {
  rctx.activeParticleCount = 0;
  rctx.activeSmokeCount = 0;
  rctx.hasGameplayParticles = false;
  rctx.particlePoolCount = 0;
  rctx.particleWriteCursor = 0;
  rctx.activeShockwaves.length = 0;
  rctx.activeGateBursts.length = 0;
  rctx.activePathTraces.length = 0;
  rctx.activeVisualShreds.length = 0;
  rctx.blockBounceMap.clear();
  rctx.boardShakeTimer = 0;
  rctx.ambientMoteAccumSec = 0;
}

export function prepareWebGL2FrameStateImpl(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  mainProgram: WebGLProgram | null,
  uViewProj: WebGLUniformLocation | null,
  uBlueprintMix: WebGLUniformLocation | null,
  uBoardInfo: WebGLUniformLocation | null,
  uStoneTint: WebGLUniformLocation | null,
  uTrayMaterial: WebGLUniformLocation | null,
  uHighContrast: WebGLUniformLocation | null,
  uAtlas: WebGLUniformLocation | null,
  atlasTexture: WebGLTexture | null,
  board: BoardState,
  trayId: TrayId,
  skinId: SkinId,
  highContrast: boolean,
  reducedMotion: boolean,
  timeSec: number,
  blueprintMix: number
): void {
  gl.viewport(0, 0, rctx.canvas.width, rctx.canvas.height);
  gl.clearColor(0.0, 0.0, 0.0, 0.0);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const stoneTint = getStoneThemeMineralTint(trayId, skinId);
  gl.useProgram(mainProgram);
  gl.uniformMatrix4fv(uViewProj, false, rctx.camera.getViewProjectionMatrix(false));
  gl.uniform1i(rctx.uUseClipPlane, 0);
  gl.uniform1f(rctx.uBlockSeed, 0);
  gl.uniform4f(rctx.uClipPlane, 0, 0, 1, 0);
  gl.uniform3f(rctx.uCapColor, 0.2, 0.2, 0.2);
  gl.uniform1f(uBlueprintMix, blueprintMix);
  gl.uniform3f(uBoardInfo, board.cols * 0.5, board.rows * 0.5, reducedMotion ? -1.0 : timeSec);
  gl.uniform3f(uStoneTint, stoneTint[0], stoneTint[1], stoneTint[2]);
  gl.uniform1i(uTrayMaterial, getTrayMaterialCode(trayId));
  gl.uniform1i(uHighContrast, highContrast ? 1 : 0);
  if (atlasTexture) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
    gl.uniform1i(uAtlas, 0);
  }
}
