import { isBlockInLockedRoom } from '../core/physics';
import { getShape } from '../core/polyomino';
import type { BoardState } from '../core/types';
import {
  INSTANCE_STRIDE,
  MAX_PARTICLES,
  PARTICLE_STRIDE,
  type RenderPassContext,
  SMOKE_SCALE_OFFSET,
} from './render-types';

/**
 * Relic Awakening Transformation (`RELIC-AWAKEN-01`):
 * When the player taps Play on the Title Screen, the levitating stone relic bursts apart —
 * tumbling 3D stone shards fly off, ancient dust/smoke billows upward, golden-jade embers rise,
 * and concentric glow shockwaves sweep the board as vibrant gameplay colors emerge underneath.
 * Never spawns when `reducedMotion === true`.
 */

const SANDSTONE_TONES: ReadonlyArray<[number, number, number]> = [
  [0.56, 0.5, 0.44],
  [0.47, 0.42, 0.37],
  [0.64, 0.58, 0.5],
  [0.4, 0.36, 0.32],
  [0.52, 0.48, 0.43],
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
  const idx = rctx.particleWriteCursor * PARTICLE_STRIDE;
  rctx.particleWriteCursor = (rctx.particleWriteCursor + 1) % MAX_PARTICLES;
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
}

export function spawnRelicAwakeningBurstImpl(rctx: RenderPassContext, board: BoardState): void {
  if (rctx.lastOptions.reducedMotion) return;
  const rand = Math.random;
  const isUltra = rctx.qualityGovernor.getActiveTier() === 'ULTRA_120';
  const density = isUltra ? 1 : 0.6;
  const cx = board.cols * 0.5;
  const cy = board.rows * 0.5;
  const span = Math.max(board.cols, board.rows);

  // 1. Glow shockwaves: white-gold core flash above the blocks + jade wave sweeping the floor beneath
  rctx.spawnShockwave(cx, cy, 0.66, 1.0, 0.9, 0.6, 0.15, span * 0.38, 0.42);
  rctx.spawnShockwave(cx, cy, 0.04, 0.3, 0.95, 0.82, 0.3, span * 0.62, 0.62);

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

  // 3. Tumbling 3D fractured stone shards flying outward & upward
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
    writeParticle(
      rctx,
      jx,
      jy,
      sz + rand() * 0.1,
      vx,
      vy,
      2.6 + rand() * 2.8,
      SANDSTONE_TONES[i % SANDSTONE_TONES.length],
      -(0.14 + rand() * 0.12),
      0.85 + rand() * 0.4,
      rand() * 6.283,
      (rand() < 0.5 ? -1 : 1) * (9 + rand() * 7)
    );
  }

  // 4. Billowing ancient smoke & glowing dust puffs
  const smokeCount = Math.round(48 * density);
  for (let i = 0; i < smokeCount; i++) {
    const [sx, sy] = cells[(i * 7) % cells.length];
    const glowTint = i % 5 === 0 ? [0.62, 0.92, 0.82] : i % 4 === 0 ? [0.98, 0.84, 0.56] : null;
    const dust = 0.66 + rand() * 0.14;
    const rgb: [number, number, number] = glowTint
      ? [glowTint[0], glowTint[1], glowTint[2]]
      : [dust, dust * 0.92, dust * 0.82];
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
      0.8 + rand() * 0.45,
      0,
      0
    );
  }

  // 5. Incandescent golden & jade embers rising through the smoke
  const emberCount = Math.round(34 * density);
  for (let i = 0; i < emberCount; i++) {
    const [sx, sy] = cells[(i * 3) % cells.length];
    const rgb: [number, number, number] = i % 2 === 0 ? [1.0, 0.82, 0.38] : [0.42, 1.0, 0.86];
    writeParticle(
      rctx,
      sx,
      sy,
      0.62,
      (rand() - 0.5) * 1.6,
      (rand() - 0.5) * 1.6,
      3.2 + rand() * 2.2,
      rgb,
      0.045 + rand() * 0.035,
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
  uViewProj: WebGLUniformLocation | null;
  uStyle: WebGLUniformLocation | null;
}

/**
 * Pass 4: GPU-instanced particles. Solid particles & stone shards draw with depth writes;
 * translucent smoke puffs draw in a 2nd instanced call with `depthMask(false)` so they never
 * punch holes through each other or the shards behind them.
 */
export function renderPass4ParticlesImpl(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  h: ParticleDrawHandles,
  styleCode: number
): void {
  const solid = rctx.activeParticleCount;
  const smoke = rctx.activeSmokeCount;
  if (solid + smoke <= 0 || !h.program || !h.vao || !h.instanceBuffer) return;

  gl.useProgram(h.program);
  gl.uniformMatrix4fv(h.uViewProj, false, rctx.camera.getViewProjectionMatrix(false));
  gl.uniform1i(h.uStyle, styleCode);
  gl.bindVertexArray(h.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, h.instanceBuffer);

  if (solid > 0) {
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, rctx.particleInstanceData.subarray(0, solid * INSTANCE_STRIDE));
    gl.drawElementsInstanced(gl.TRIANGLES, h.indexCount, gl.UNSIGNED_SHORT, 0, solid);
  }
  if (smoke > 0) {
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, rctx.smokeInstanceData.subarray(0, smoke * INSTANCE_STRIDE));
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.drawElementsInstanced(gl.TRIANGLES, h.indexCount, gl.UNSIGNED_SHORT, 0, smoke);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
  }
  gl.bindVertexArray(null);
}
