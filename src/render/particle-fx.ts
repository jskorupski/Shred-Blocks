import { getGateActiveColor, getGateOutwardNormal } from '../core/gate-clearance';
import { getBlockRoomId, isBlockInLockedRoom, isGateInLockedRoom } from '../core/physics';
import { getActiveColor, getShape } from '../core/polyomino';
import {
  type BlockState,
  type BoardState,
  COLOR_PALETTE,
  type ColorId,
  type GateState,
  type ParticleStyleId,
} from '../core/types';
import {
  allocParticleSlot,
  INSTANCE_STRIDE,
  MAX_SMOKE_PUFFS,
  PARTICLE_STRIDE,
  type RenderPassContext,
  type RenderSceneOptions,
  SMOKE_SCALE_OFFSET,
} from './render-types';

/**
 * Spawns a burst of 3D shredder particles into the pre-allocated 2,048-particle ring buffer.
 */
export function spawnParticlesAtImpl(
  rctx: RenderPassContext,
  worldX: number,
  worldY: number,
  worldZ: number,
  colorId: ColorId,
  count?: number,
  dirX = 0,
  dirY = 0,
  particleStyle: ParticleStyleId = 'micro_cubes'
): void {
  const entry = COLOR_PALETTE[colorId] ?? COLOR_PALETTE[1];
  const [r, g, b] = rctx.lastOptions.colorblindSymbols
    ? rctx.getColorRgb(colorId, Boolean(rctx.lastOptions.highContrast), true)
    : entry.rgb;
  const burstCount =
    count ?? rctx.qualityGovernor.getBurstParticleCount(Boolean(rctx.lastOptions.reducedMotion));

  let styleSpeedMul = 1.0;
  let styleScaleMul = 1.0;
  if (particleStyle === 'pixel_sparks' || particleStyle === 'lightning_bolts') {
    styleSpeedMul = 1.35;
    styleScaleMul = 0.82;
  } else if (particleStyle === 'soap_bubbles') {
    styleSpeedMul = 0.72;
    styleScaleMul = 1.25;
  } else if (particleStyle === 'star_confetti') {
    styleSpeedMul = 1.1;
    styleScaleMul = 1.1;
  }

  const hasDir = Math.hypot(dirX, dirY) > 0.1;
  const tanX = hasDir ? -dirY : 1;
  const tanY = hasDir ? dirX : 0;

  for (let i = 0; i < burstCount; i++) {
    const idx = allocParticleSlot(rctx);

    const angle = (i / burstCount) * Math.PI * 2 + i * 1.6180339;
    const radialSpeed = (0.45 + ((i * 7) % 13) * 0.14) * styleSpeedMul;
    const lateralOffset = (((i * 11) % 19) / 9.0 - 1.0) * 0.58;
    const jitterRadius = 0.04 + ((i * 5) % 9) * 0.025;

    const px = worldX + (hasDir ? tanX * lateralOffset + dirX * 0.12 : 0) + Math.cos(angle) * jitterRadius;
    const py = worldY + (hasDir ? tanY * lateralOffset + dirY * 0.12 : 0) + Math.sin(angle) * jitterRadius;
    const pz = worldZ + (((i * 3) % 7) - 3) * 0.04;

    const forwardBoost = (1.35 + ((i * 13) % 11) * 0.22) * styleSpeedMul;
    const vx =
      dirX * forwardBoost + (hasDir ? tanX * lateralOffset * 1.4 : 0) + Math.cos(angle) * radialSpeed;
    const vy =
      dirY * forwardBoost + (hasDir ? tanY * lateralOffset * 1.4 : 0) + Math.sin(angle) * radialSpeed;
    const vz = (1.6 + ((i * 5) % 11) * 0.22) * styleSpeedMul;

    const shade = 0.85 + ((i * 11) % 7) * 0.04;
    rctx.particlePool[idx + 0] = px;
    rctx.particlePool[idx + 1] = py;
    rctx.particlePool[idx + 2] = pz;
    rctx.particlePool[idx + 3] = vx;
    rctx.particlePool[idx + 4] = vy;
    rctx.particlePool[idx + 5] = vz;
    rctx.particlePool[idx + 6] = Math.min(1, r * shade);
    rctx.particlePool[idx + 7] = Math.min(1, g * shade);
    rctx.particlePool[idx + 8] = Math.min(1, b * shade);
    rctx.particlePool[idx + 9] = (0.085 + ((i * 3) % 5) * 0.018) * styleScaleMul;
    rctx.particlePool[idx + 10] = 0.001; // age > 0 marks active
    rctx.particlePool[idx + 11] = 0.48 + ((i * 9) % 7) * 0.06; // maxAge
    rctx.particlePool[idx + 12] = angle;
    rctx.particlePool[idx + 13] = (i % 2 === 0 ? 1 : -1) * (4.5 + (i % 5));
  }
}

export function spawnShockwaveImpl(
  rctx: RenderPassContext,
  cx: number,
  cy: number,
  z: number,
  r: number,
  g: number,
  b: number,
  minRadius = 0.28,
  maxRadius = 1.65,
  maxAge = 0.42
): void {
  if (rctx.lastOptions.reducedMotion) return;
  if (rctx.activeShockwaves.length >= 16) {
    rctx.activeShockwaves.shift();
  }
  rctx.activeShockwaves.push({
    cx,
    cy,
    z,
    r,
    g,
    b,
    age: 0.001,
    maxAge,
    minRadius,
    maxRadius,
  });
}

/**
 * Triggers a multi-wave celebratory 3D confetti & golden shockwave fountain across the sanctuary
 * courtyard when a level is won.
 */
export function spawnVictoryCelebrationBurstImpl(rctx: RenderPassContext, board: BoardState): void {
  const style = rctx.lastOptions.equippedParticle ?? 'star_confetti';
  const centerCx = board.cols * 0.5;
  const centerCy = board.rows * 0.5;

  // 3 concentric golden & turquoise shockwave rings
  rctx.spawnShockwave(
    centerCx,
    centerCy,
    0.35,
    1.0,
    0.85,
    0.28,
    0.3,
    Math.max(board.cols, board.rows) * 0.72,
    0.65
  );
  rctx.spawnShockwave(
    centerCx,
    centerCy,
    0.42,
    0.18,
    0.88,
    0.78,
    0.15,
    Math.max(board.cols, board.rows) * 0.55,
    0.52
  );

  // Center courtyard multi-color fountain
  const celebrationColors: ColorId[] = [4, 1, 2, 3, 7, 8];
  for (let i = 0; i < celebrationColors.length; i++) {
    const angle = (i / celebrationColors.length) * Math.PI * 2;
    const ox = Math.cos(angle) * 0.85;
    const oy = Math.sin(angle) * 0.85;
    rctx.spawnParticlesAt(
      centerCx + ox,
      centerCy + oy,
      0.52,
      celebrationColors[i],
      28,
      Math.cos(angle) * 0.5,
      Math.sin(angle) * 0.5,
      style
    );
  }

  // Perimeter gate fireworks
  for (const gate of board.gates) {
    const cId = getGateActiveColor(gate);
    const isHoriz = gate.edge === 'TOP' || gate.edge === 'BOTTOM';
    const gx = isHoriz
      ? gate.spanStart + gate.spanLength * 0.5
      : gate.edge === 'LEFT'
        ? gate.edgeLine
        : gate.edgeLine + 1;
    const gy = !isHoriz
      ? gate.spanStart + gate.spanLength * 0.5
      : gate.edge === 'TOP'
        ? gate.edgeLine
        : gate.edgeLine + 1;
    const [nx, ny] = getGateOutwardNormal(gate.edge);
    rctx.spawnParticlesAt(gx, gy, 0.55, cId, 24, -nx * 0.6, -ny * 0.6, style);
  }
}

export function spawnBlockShredBurstImpl(
  rctx: RenderPassContext,
  _board: BoardState,
  block: BlockState,
  gate?: GateState,
  colorOverride?: ColorId
): void {
  const shape = getShape(block.shapeId);
  const cx = block.x + shape.cols * 0.5;
  const cy = block.y + shape.rows * 0.5;
  const colorId: ColorId = colorOverride ?? getActiveColor(block.colorStack, block.colorCursor);
  let nx = 0;
  let ny = 0;
  if (gate) {
    [nx, ny] = getGateOutwardNormal(gate.edge);
  }
  const [cr, cg, cb] = rctx.getColorRgb(colorId, Boolean(rctx.lastOptions.highContrast));
  rctx.spawnShockwave(cx + nx * 0.35, cy + ny * 0.35, 0.45, cr, cg, cb, 0.3, 1.85, 0.44);
  rctx.spawnParticlesAt(
    cx + nx * 0.4,
    cy + ny * 0.4,
    0.42,
    colorId,
    rctx.qualityGovernor.getBurstParticleCount(Boolean(rctx.lastOptions.reducedMotion)) + 18,
    nx,
    ny,
    rctx.lastOptions.equippedParticle ?? 'micro_cubes'
  );
}

export function stepParticlesImpl(rctx: RenderPassContext, dtSec: number): void {
  const dt = Math.min(0.05, Math.max(0.001, dtSec));
  const maxActive = rctx.qualityGovernor.getMaxActiveParticles();
  let active = 0;

  // Step micro-recoil board shake timer
  if (rctx.boardShakeTimer > 0) {
    rctx.boardShakeTimer = Math.max(0, rctx.boardShakeTimer - dt);
  }

  // Step expanding 3D shockwave rings
  for (let i = rctx.activeShockwaves.length - 1; i >= 0; i--) {
    const sw = rctx.activeShockwaves[i];
    sw.age += dt;
    if (sw.age >= sw.maxAge) {
      rctx.activeShockwaves.splice(i, 1);
    }
  }

  // Step knock-on block scale-bounce animations
  for (const [bid, rem] of rctx.blockBounceMap.entries()) {
    const next = rem - dt;
    if (next <= 0) {
      rctx.blockBounceMap.delete(bid);
    } else {
      rctx.blockBounceMap.set(bid, next);
    }
  }

  // Step 3D room awakening upward extrusion timers (`550ms` smooth cubic ease-out)
  for (const [rid, elapsed] of rctx.roomAwakenMap.entries()) {
    const next = elapsed + dt;
    if (next >= 0.55) {
      rctx.roomAwakenMap.delete(rid);
    } else {
      rctx.roomAwakenMap.set(rid, next);
    }
  }

  let activeSmoke = 0;
  let writeSlot = 0;
  const pool = rctx.particlePool;
  const totalSlots = rctx.particlePoolCount;
  for (let i = 0; i < totalSlots; i++) {
    const idx = i * PARTICLE_STRIDE;
    const age = pool[idx + 10];
    const maxAge = pool[idx + 11];
    if (age <= 0 || age >= maxAge) continue;

    const nextAge = age + dt;
    if (nextAge >= maxAge || active + activeSmoke >= maxActive) {
      pool[idx + 10] = 0;
      continue;
    }

    const baseScale = pool[idx + 9];
    const isSmoke = baseScale <= -SMOKE_SCALE_OFFSET;
    const isShard = !isSmoke && baseScale < 0;
    pool[idx + 10] = nextAge;
    pool[idx + 0] += pool[idx + 3] * dt;
    pool[idx + 1] += pool[idx + 4] * dt;
    pool[idx + 2] += pool[idx + 5] * dt;
    if (isSmoke) {
      // Buoyant billowing smoke: horizontal drag + gentle upward drift (`RELIC-AWAKEN-01`)
      const drag = Math.max(0, 1 - 2.2 * dt);
      pool[idx + 3] *= drag;
      pool[idx + 4] *= drag;
      pool[idx + 5] = pool[idx + 5] * Math.max(0, 1 - 1.6 * dt) + 0.35 * dt;
    } else {
      // Gravity (stone shards fall a little heavier for a crisp tumbling arc)
      pool[idx + 5] -= (isShard ? 8.4 : 6.8) * dt;
    }
    pool[idx + 12] += pool[idx + 13] * dt;

    const px = pool[idx + 0];
    const py = pool[idx + 1];
    const pz = pool[idx + 2];
    const pr = pool[idx + 6];
    const pg = pool[idx + 7];
    const pb = pool[idx + 8];
    const prot = pool[idx + 12];

    if (writeSlot !== i) {
      pool.copyWithin(writeSlot * PARTICLE_STRIDE, idx, idx + PARTICLE_STRIDE);
    }
    writeSlot++;

    const lifeRatio = 1.0 - nextAge / maxAge;
    if (isSmoke) {
      if (activeSmoke >= MAX_SMOKE_PUFFS) continue;
      const puffRadius = -baseScale - SMOKE_SCALE_OFFSET;
      const sIdx = activeSmoke * INSTANCE_STRIDE;
      rctx.smokeInstanceData[sIdx + 0] = px;
      rctx.smokeInstanceData[sIdx + 1] = py;
      rctx.smokeInstanceData[sIdx + 2] = pz;
      rctx.smokeInstanceData[sIdx + 3] = -(SMOKE_SCALE_OFFSET + puffRadius * (0.55 + 1.4 * (1 - lifeRatio)));
      rctx.smokeInstanceData[sIdx + 4] = pr;
      rctx.smokeInstanceData[sIdx + 5] = pg;
      rctx.smokeInstanceData[sIdx + 6] = pb;
      rctx.smokeInstanceData[sIdx + 7] = lifeRatio;
      activeSmoke++;
      continue;
    }
    const scale = isShard
      ? baseScale * (0.3 + 0.7 * Math.sqrt(lifeRatio))
      : baseScale * (0.35 + 0.65 * lifeRatio);

    const outIdx = active * INSTANCE_STRIDE;
    rctx.particleInstanceData[outIdx + 0] = px;
    rctx.particleInstanceData[outIdx + 1] = py;
    rctx.particleInstanceData[outIdx + 2] = isShard ? pz : Math.max(-0.1, pz);
    rctx.particleInstanceData[outIdx + 3] = scale;
    rctx.particleInstanceData[outIdx + 4] = pr;
    rctx.particleInstanceData[outIdx + 5] = pg;
    rctx.particleInstanceData[outIdx + 6] = pb;
    rctx.particleInstanceData[outIdx + 7] = prot;
    active++;
  }

  rctx.particlePoolCount = writeSlot;
  rctx.activeParticleCount = active;
  rctx.activeSmokeCount = activeSmoke;
  rctx.qualityGovernor.setActiveParticles(active + activeSmoke);
}

export function getRoomVisualStateImpl(
  rctx: RenderPassContext,
  board: BoardState,
  roomId: number
): { zOffset: number; luminanceMul: number; isLocked: boolean } {
  if (roomId <= 0) {
    return { zOffset: 0, luminanceMul: 1.0, isLocked: false };
  }
  const lockedByNonVault =
    board.barriers?.some((b) => b.unlocksRoomId === roomId && !b.open && !b.isVault) ?? false;
  if (lockedByNonVault) {
    return { zOffset: -0.14, luminanceMul: 0.58, isLocked: true };
  }
  const isVaultRoom = board.barriers?.some((b) => b.unlocksRoomId === roomId && b.isVault) ?? false;
  const elapsed = rctx.roomAwakenMap.get(roomId);
  if (!isVaultRoom && elapsed !== undefined && elapsed < 0.55 && !rctx.lastOptions.reducedMotion) {
    const t = Math.min(1, Math.max(0, elapsed / 0.55));
    const eased = 1 - (1 - t) ** 3;
    return {
      zOffset: -0.14 * (1 - eased),
      luminanceMul: 0.58 + 0.42 * eased,
      isLocked: false,
    };
  }
  return { zOffset: 0, luminanceMul: 1.0, isLocked: false };
}

/**
 * Spawns continuous GPU-instanced ambient sanctuary motes and ready-gate roller sparks (`IDLE-04`)
 * when `reducedMotion === false` so the idle 3D courtyard feels alive and tactile.
 */
export function spawnAmbientCourtyardMotesImpl(
  rctx: RenderPassContext,
  board: BoardState,
  options: RenderSceneOptions,
  dtSec: number,
  timeSec: number
): void {
  if (options.reducedMotion || (options.blueprintMix ?? 0) > 0.5) return;
  const isUltra = rctx.qualityGovernor.getActiveTier() === 'ULTRA_120';
  const spawnIntervalSec = isUltra ? 0.24 : 0.42;
  const maxAmbientCap = isUltra ? 18 : 10;

  rctx.ambientMoteAccumSec = Math.min(0.5, rctx.ambientMoteAccumSec + dtSec);
  if (rctx.ambientMoteAccumSec < spawnIntervalSec) return;

  const pStyle = options.equippedParticle ?? 'micro_cubes';
  let stepIndex = Math.floor(timeSec * 6.0);

  while (rctx.ambientMoteAccumSec >= spawnIntervalSec) {
    rctx.ambientMoteAccumSec -= spawnIntervalSec;
    stepIndex++;
    if (rctx.activeParticleCount >= maxAmbientCap) break;

    const readyGates = board.gates.filter(
      (g) => g.shutterOpen && g.shutterLockColor === 0 && g.iceCount <= 0 && !isGateInLockedRoom(board, g)
    );

    // Alternate between Gate Roller Intake Sparks and Floating Block/Courtyard Shimmer Motes
    if (readyGates.length > 0 && stepIndex % 2 === 0) {
      const gate = readyGates[stepIndex % readyGates.length];
      const cId = getGateActiveColor(gate);
      const [r, g, b] = rctx.getColorRgb(cId, Boolean(options.highContrast));
      const isHoriz = gate.edge === 'TOP' || gate.edge === 'BOTTOM';
      const spanFrac = 0.15 + ((stepIndex * 0.381966) % 0.7);
      const along = gate.spanStart + gate.spanLength * spanFrac;
      const gx = isHoriz ? along : gate.edge === 'LEFT' ? gate.edgeLine - 0.14 : gate.edgeLine + 1 + 0.14;
      const gy = !isHoriz ? along : gate.edge === 'TOP' ? gate.edgeLine - 0.14 : gate.edgeLine + 1 + 0.14;
      const [nx, ny] = getGateOutwardNormal(gate.edge);

      const idx = allocParticleSlot(rctx);
      rctx.particlePool[idx + 0] = gx;
      rctx.particlePool[idx + 1] = gy;
      rctx.particlePool[idx + 2] = 0.42;
      rctx.particlePool[idx + 3] = -nx * 0.38 + Math.sin(timeSec * 2.5 + stepIndex) * 0.22;
      rctx.particlePool[idx + 4] = -ny * 0.38 + Math.cos(timeSec * 2.1 + stepIndex) * 0.22;
      rctx.particlePool[idx + 5] = 1.45 + (stepIndex % 3) * 0.16;
      rctx.particlePool[idx + 6] = Math.min(1, r * 0.85 + 0.2);
      rctx.particlePool[idx + 7] = Math.min(1, g * 0.85 + 0.2);
      rctx.particlePool[idx + 8] = Math.min(1, b * 0.85 + 0.18);
      rctx.particlePool[idx + 9] = pStyle === 'soap_bubbles' ? 0.082 : 0.062;
      rctx.particlePool[idx + 10] = 0.001;
      rctx.particlePool[idx + 11] = 0.62;
      rctx.particlePool[idx + 12] = stepIndex * 0.9;
      rctx.particlePool[idx + 13] = (stepIndex % 2 === 0 ? 1 : -1) * 3.4;
    } else {
      const activeBlocks = board.blocks.filter(
        (blk) => blk.status === 'ACTIVE' && !isBlockInLockedRoom(board, blk)
      );
      let mx = ((stepIndex * 1.6180339) % 1) * board.cols;
      let my = ((stepIndex * 2.4142135) % 1) * board.rows;
      let mr = 1.0;
      let mg = 0.88;
      let mb = 0.52;

      if (activeBlocks.length > 0) {
        const blk = activeBlocks[stepIndex % activeBlocks.length];
        const shape = getShape(blk.shapeId);
        const cell = shape.cells[stepIndex % shape.cells.length] ?? shape.cells[0];
        const jitterX = 0.2 + ((stepIndex * 0.618) % 0.6);
        const jitterY = 0.2 + ((stepIndex * 0.754) % 0.6);
        mx = blk.x + cell[1] + jitterX;
        my = blk.y + cell[0] + jitterY;
        const cId = getActiveColor(blk.colorStack, blk.colorCursor);
        const [br, bg, bb] = rctx.getColorRgb(cId, Boolean(options.highContrast));
        mr = Math.min(1, br * 0.68 + 0.35);
        mg = Math.min(1, bg * 0.68 + 0.32);
        mb = Math.min(1, bb * 0.68 + 0.24);
      } else {
        const fallbackR = Math.floor(my);
        const fallbackC = Math.floor(mx);
        if (
          fallbackR < 0 ||
          fallbackR >= board.rows ||
          fallbackC < 0 ||
          fallbackC >= board.cols ||
          board.occupancy[fallbackR * board.cols + fallbackC] === -1
        ) {
          continue;
        }
      }

      const idx = allocParticleSlot(rctx);
      rctx.particlePool[idx + 0] = mx;
      rctx.particlePool[idx + 1] = my;
      rctx.particlePool[idx + 2] = 0.62;
      rctx.particlePool[idx + 3] = Math.cos(timeSec * 1.8 + stepIndex) * 0.22;
      rctx.particlePool[idx + 4] = Math.sin(timeSec * 2.1 + stepIndex) * 0.22;
      rctx.particlePool[idx + 5] = 1.65 + (stepIndex % 4) * 0.14;
      rctx.particlePool[idx + 6] = mr;
      rctx.particlePool[idx + 7] = mg;
      rctx.particlePool[idx + 8] = mb;
      rctx.particlePool[idx + 9] = pStyle === 'soap_bubbles' ? 0.086 : 0.066;
      rctx.particlePool[idx + 10] = 0.001;
      rctx.particlePool[idx + 11] = 0.68;
      rctx.particlePool[idx + 12] = stepIndex * 1.2;
      rctx.particlePool[idx + 13] = (stepIndex % 2 === 0 ? 1 : -1) * 2.8;
    }
  }
}

export function syncSnapshotsImpl(rctx: RenderPassContext, board: BoardState): void {
  rctx.lastBoardLevelId = board.levelId;
  rctx.lastSessionShredded = board.sessionBlocksShredded;
  rctx.lastMovesCommitted = board.movesCommitted;
  rctx.blockLayerSnapshots.clear();
  for (const b of board.blocks) {
    rctx.blockLayerSnapshots.set(b.id, {
      cursor: b.colorCursor,
      status: b.status,
      x: b.x,
      y: b.y,
      row: b.row,
      col: b.col,
      color: getActiveColor(b.colorStack, b.colorCursor),
      iceCount: b.iceCount,
      chained: b.chained,
      ropeColor: b.ropeColor,
    });
  }
  rctx.crateSnapshots.clear();
  for (const c of board.crates) {
    rctx.crateSnapshots.set(c.id, { hp: c.hp, destroyed: c.destroyed });
  }
  rctx.gateSnapshots.clear();
  board.gates.forEach((g, idx) => {
    rctx.gateSnapshots.set(idx, {
      colorCursor: g.colorCursor,
      iceCount: g.iceCount,
      shutterOpen: g.shutterOpen,
      shutterLockColor: g.shutterLockColor,
      spanStart: g.spanStart,
      spanLength: g.spanLength,
    });
  });
  rctx.elevatorSnapshots.clear();
  for (const el of board.elevators) {
    rctx.elevatorSnapshots.set(el.id, { atAlternatePos: el.atAlternatePos });
  }
  rctx.barrierSnapshots.clear();
  for (const bar of board.barriers) {
    rctx.barrierSnapshots.set(bar.id, {
      open: bar.open,
      shredsRemaining: bar.shredsRemaining,
    });
  }
}

export function detectAutomaticShredEventsImpl(
  rctx: RenderPassContext,
  board: BoardState,
  options: RenderSceneOptions
): void {
  const isLevelChange = board.levelId !== rctx.lastBoardLevelId;
  const isUndoOrRestart =
    board.movesCommitted < rctx.lastMovesCommitted ||
    (board.movesCommitted === 0 && rctx.lastMovesCommitted > 0) ||
    board.sessionBlocksShredded < rctx.lastSessionShredded;

  if (isLevelChange || isUndoOrRestart) {
    syncSnapshotsImpl(rctx, board);
    rctx.roomAwakenMap.clear();
    if (isLevelChange) {
      rctx.activeVisualShreds.length = 0;
      rctx.activeShockwaves.length = 0;
      rctx.blockBounceMap.clear();
      rctx.boardShakeTimer = 0;
      rctx.particlePoolCount = 0;
      rctx.particleWriteCursor = 0;
      rctx.activeParticleCount = 0;
      rctx.activeSmokeCount = 0;
    }
    return;
  }

  const hc = Boolean(options.highContrast);
  const pStyle = options.equippedParticle ?? 'micro_cubes';

  // Check if any moving elevator toggled position this frame
  let anyElevatorMoved = false;
  for (const el of board.elevators) {
    const prevEl = rctx.elevatorSnapshots.get(el.id);
    if (prevEl && prevEl.atAlternatePos !== el.atAlternatePos) {
      anyElevatorMoved = true;
    }
  }

  // 1. Diff Block Shreds, Layer Peels, Generator Spawns, Ice Thaws, Key Unlocks, Rope Cuts & Elevator Shifts
  for (const b of board.blocks) {
    const prev = rctx.blockLayerSnapshots.get(b.id);
    const curColor: ColorId = getActiveColor(b.colorStack, b.colorCursor);
    const shape = getShape(b.shapeId);
    const cx = b.x + shape.cols * 0.5;
    const cy = b.y + shape.rows * 0.5;

    if (!prev && b.status === 'ACTIVE') {
      // Generator spawned a new block!
      const [cr, cg, cb] = rctx.getColorRgb(curColor, hc);
      rctx.spawnShockwave(cx, cy, 0.55, cr, cg, cb, 0.25, 1.55, 0.42);
      rctx.spawnParticlesAt(cx, cy, 0.48, curColor, 26, 0, 0, pStyle);
      rctx.blockBounceMap.set(b.id, 0.34);
      continue;
    }

    if (prev) {
      const peeled = b.colorCursor > prev.cursor;
      const cleared = prev.status === 'ACTIVE' && b.status !== 'ACTIVE';
      if (peeled || cleared) {
        const gate = b.shredGateIndex >= 0 ? board.gates[b.shredGateIndex] : undefined;
        let nx = 0;
        let ny = 0;
        if (gate) {
          [nx, ny] = getGateOutwardNormal(gate.edge);
          gate.rollerPhase += 2.2;
        }
        if (b.shredGateIndex >= 0 && gate) {
          rctx.activeVisualShreds.push({
            shapeId: b.shapeId,
            x: b.x,
            y: b.y,
            colorId: prev.color,
            gateIndex: b.shredGateIndex,
            progress: 0,
            isOuterPeelOnly: peeled && !cleared,
          });
        }
        const [pr, pg, pb] = rctx.getColorRgb(prev.color, hc);
        rctx.spawnShockwave(cx + nx * 0.35, cy + ny * 0.35, 0.45, pr, pg, pb, 0.3, 1.85, 0.44);
        rctx.spawnParticlesAt(
          cx + nx * 0.35,
          cy + ny * 0.35,
          0.42,
          prev.color,
          rctx.qualityGovernor.getBurstParticleCount(Boolean(options.reducedMotion)) + 16,
          nx,
          ny,
          pStyle
        );
        if (!options.reducedMotion) {
          rctx.boardShakeTimer = 0.16;
          rctx.boardShakeDirX = nx !== 0 ? nx : 0.7;
          rctx.boardShakeDirY = ny !== 0 ? ny : 0.7;
        }
        if (peeled && !cleared) {
          rctx.blockBounceMap.set(b.id, 0.32);
        }
      }

      if (b.status === 'ACTIVE') {
        // Knock-on 1A: Ice thawed or shattered on block
        if (prev.iceCount > 0 && b.iceCount < prev.iceCount) {
          rctx.spawnShockwave(cx, cy, 0.58, 0.42, 0.92, 1.0, 0.25, 1.48, 0.38);
          rctx.spawnParticlesAt(cx, cy, 0.52, 7, 24, 0, 0, pStyle);
          rctx.blockBounceMap.set(b.id, 0.32);
        }
        // Knock-on 1B: Chain unlocked by Key
        if (prev.chained && !b.chained) {
          rctx.spawnShockwave(cx, cy, 0.6, 1.0, 0.85, 0.24, 0.28, 1.65, 0.42);
          rctx.spawnParticlesAt(cx, cy, 0.54, 4, 28, 0, 0, pStyle);
          rctx.blockBounceMap.set(b.id, 0.34);
        }
        // Knock-on 1C: Colored Rope untied by Scissors
        if (prev.ropeColor > 0 && b.ropeColor === 0) {
          const [rr, rg, rb] = rctx.getColorRgb(prev.ropeColor, hc);
          rctx.spawnShockwave(cx, cy, 0.6, rr, rg, rb, 0.28, 1.65, 0.42);
          rctx.spawnParticlesAt(cx, cy, 0.54, prev.ropeColor, 28, 0, 0, pStyle);
          rctx.blockBounceMap.set(b.id, 0.34);
        }
        // Knock-on 1D: Elevator shifted block
        if (anyElevatorMoved && prev.status === 'ACTIVE' && (b.row !== prev.row || b.col !== prev.col)) {
          rctx.spawnShockwave(cx, cy, 0.35, 0.38, 0.78, 1.0, 0.25, 1.35, 0.36);
          rctx.blockBounceMap.set(b.id, 0.3);
        }
      }
    }
  }

  // 2. Diff Wooden Crate Crack / Shatter Knock-Ons
  for (const c of board.crates) {
    const prevC = rctx.crateSnapshots.get(c.id);
    if (prevC && (c.hp < prevC.hp || (!prevC.destroyed && c.destroyed))) {
      const cx = c.col + 0.5;
      const cy = c.row + 0.5;
      rctx.spawnShockwave(cx, cy, 0.45, 0.96, 0.62, 0.22, 0.22, 1.45, 0.38);
      rctx.spawnParticlesAt(cx, cy, 0.45, 6, c.destroyed ? 32 : 18, 0, 0, pStyle);
    }
  }

  // 3. Diff Gate Knock-Ons: Only fire a localized gate unlock effect when a gate's
  // frozen ice shatters to 0 or its shutter gem lock unlocks — never on routine color queue steps or sliding.
  board.gates.forEach((gate, gi) => {
    const prevG = rctx.gateSnapshots.get(gi);
    if (!prevG) return;
    const iceShattered = prevG.iceCount > 0 && gate.iceCount === 0;
    const gemUnlocked = prevG.shutterLockColor > 0 && gate.shutterLockColor === 0;

    if (iceShattered || gemUnlocked) {
      const isHoriz = gate.edge === 'TOP' || gate.edge === 'BOTTOM';
      const gx = isHoriz
        ? gate.spanStart + gate.spanLength * 0.5
        : gate.edge === 'LEFT'
          ? gate.edgeLine
          : gate.edgeLine + 1;
      const gy = !isHoriz
        ? gate.spanStart + gate.spanLength * 0.5
        : gate.edge === 'TOP'
          ? gate.edgeLine
          : gate.edgeLine + 1;
      const cId = getGateActiveColor(gate);
      const [gr, gg, gb] = iceShattered ? [0.45, 0.92, 1.0] : rctx.getColorRgb(cId, hc);
      rctx.spawnShockwave(gx, gy, 0.52, gr, gg, gb, 0.2, 0.85, 0.32);
      rctx.spawnParticlesAt(gx, gy, 0.5, iceShattered ? 7 : cId, 8, 0, 0, pStyle);
    }
  });

  // 4. Diff Sanctuary Portcullis Barrier Countdown & Room Awakening Knock-Ons (`SANCTUM-01`)
  for (const bar of board.barriers) {
    const prevB = rctx.barrierSnapshots.get(bar.id);
    if (!prevB || bar.cells.length === 0) continue;
    let minR = bar.cells[0][0];
    let maxR = bar.cells[0][0];
    let minC = bar.cells[0][1];
    let maxC = bar.cells[0][1];
    for (const [r, c] of bar.cells) {
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
    const spanW = maxC - minC + 1;
    const spanH = maxR - minR + 1;
    const barLen = Math.max(spanW, spanH);
    const bcx = minC + spanW * 0.5;
    const bcy = minR + spanH * 0.5;
    if (!prevB.open && bar.open) {
      rctx.roomAwakenMap.set(bar.unlocksRoomId, 0.001);
      rctx.spawnShockwave(bcx, bcy, 0.55, 1.0, 0.86, 0.32, 0.35, Math.max(2.2, barLen * 0.95), 0.52);
      rctx.spawnParticlesAt(bcx, bcy, 0.52, 4, 34, 0, 0, pStyle);
      for (const blk of board.blocks) {
        if (blk.status === 'ACTIVE' && getBlockRoomId(board, blk) === bar.unlocksRoomId) {
          rctx.blockBounceMap.set(blk.id, 0.38);
        }
      }
    } else if (!bar.open && bar.shredsRemaining < prevB.shredsRemaining) {
      rctx.spawnShockwave(bcx, bcy, 0.62, 1.0, 0.88, 0.38, 0.18, 0.85, 0.28);
    }
  }

  syncSnapshotsImpl(rctx, board);
}
