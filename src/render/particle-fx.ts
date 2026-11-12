import { getGateActiveColor, getGateOutwardNormal } from '../core/gate-clearance';
import { getBlockRoomId } from '../core/physics';
import { getActiveColor, getShape } from '../core/polyomino';
import type { BlockState, BoardState, ColorId, GateState, ParticleStyleId } from '../core/types';
import { stepPathTracesImpl } from './pass2-drag-fx';
import {
  INSTANCE_STRIDE,
  MAX_SMOKE_PUFFS,
  PARTICLE_STRIDE,
  RELIC_EMBER_SCALE_OFFSET,
  type RenderPassContext,
  type RenderSceneOptions,
  SMOKE_SCALE_OFFSET,
} from './render-types';
import {
  computeGateShredContactPoint,
  spawnStyledParticlesImpl,
  spawnStyledShredShockwavesAndGateFx,
  stepGateBurstsImpl,
  stepStyledParticleSlot,
} from './shred-style-fx';

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
  spawnStyledParticlesImpl(rctx, worldX, worldY, worldZ, colorId, count, dirX, dirY, particleStyle);
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
  const { emitX, emitY, nx, ny } = computeGateShredContactPoint(
    block.x,
    block.y,
    shape.cols,
    shape.rows,
    gate
  );
  const colorId: ColorId = colorOverride ?? getActiveColor(block.colorStack, block.colorCursor);
  const pStyle = rctx.lastOptions.equippedParticle ?? 'micro_cubes';
  spawnStyledShredShockwavesAndGateFx(rctx, emitX, emitY, colorId, gate, pStyle);
  rctx.spawnParticlesAt(
    emitX,
    emitY,
    0.42,
    colorId,
    rctx.qualityGovernor.getBurstParticleCount(Boolean(rctx.lastOptions.reducedMotion)) + 18,
    nx,
    ny,
    pStyle
  );
}

export function stepParticlesImpl(rctx: RenderPassContext, dtSec: number): void {
  const dt = Math.min(0.05, Math.max(0.001, dtSec));
  if (rctx.lastOptions.reducedMotion) {
    // WCAG 2.3.3: immediately clear any in-flight projectiles, shockwaves, traces & shakes if Reduced Motion is enabled
    stepGateBurstsImpl(rctx, dt);
    rctx.particlePoolCount = 0;
    rctx.particleWriteCursor = 0;
    rctx.activeParticleCount = 0;
    rctx.activeSmokeCount = 0;
    rctx.hasGameplayParticles = false;
    rctx.activeShockwaves.length = 0;
    rctx.activePathTraces.length = 0;
    rctx.boardShakeTimer = 0;
    rctx.qualityGovernor.setActiveParticles(0);
    return;
  }
  const maxActive = rctx.qualityGovernor.getMaxActiveParticles();
  let active = 0;

  // Step micro-recoil board shake timer
  if (rctx.boardShakeTimer > 0) {
    rctx.boardShakeTimer = Math.max(0, rctx.boardShakeTimer - dt);
  }

  // Step expanding 3D shockwave rings, gate bursts & post-move mystic fissure traces
  stepPathTracesImpl(rctx, dt);
  stepGateBurstsImpl(rctx, dt);
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
  let hasGameplay = false;
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
    const isRelicEmber = !isSmoke && baseScale <= -RELIC_EMBER_SCALE_OFFSET;
    const isShard = !isSmoke && !isRelicEmber && baseScale < 0;
    pool[idx + 10] = nextAge;
    let styledScaleMul = 1.0;
    if (isSmoke || isRelicEmber || isShard) {
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
    } else {
      hasGameplay = true;
      styledScaleMul = stepStyledParticleSlot(pool, idx, dt, nextAge, maxAge);
    }

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
    const scale = isRelicEmber
      ? -(RELIC_EMBER_SCALE_OFFSET + (-baseScale - RELIC_EMBER_SCALE_OFFSET) * (0.35 + 0.65 * lifeRatio))
      : isShard
        ? baseScale * (0.3 + 0.7 * Math.sqrt(lifeRatio))
        : Math.floor(Math.max(0, Math.min(1, lifeRatio)) * 1023) +
          Math.min(0.95, Math.max(0.002, baseScale * styledScaleMul));

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
  rctx.hasGameplayParticles = hasGameplay;
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
 * Stationary and dragged blocks never emit unsolicited particles prior to shredder collision (`FX-STATE-01`).
 * Idle courtyard life is expressed through gentle block breathing (`IDLE-01/02`) and Pass 1 gate threshold glow.
 */
export function spawnAmbientCourtyardMotesImpl(
  rctx: RenderPassContext,
  _board: BoardState,
  _options: RenderSceneOptions,
  _dtSec: number,
  _timeSec: number
): void {
  rctx.ambientMoteAccumSec = 0;
}

export function syncSnapshotsImpl(rctx: RenderPassContext, board: BoardState): void {
  rctx.lastSyncedBoardRef = board;
  rctx.lastBoardLevelId = board.levelId;
  rctx.lastSessionShredded = board.sessionBlocksShredded;
  rctx.lastMovesCommitted = board.movesCommitted;
  for (let i = 0; i < board.blocks.length; i++) {
    const b = board.blocks[i];
    const color = getActiveColor(b.colorStack, b.colorCursor);
    const snap = rctx.blockLayerSnapshots.get(b.id);
    if (snap) {
      snap.cursor = b.colorCursor;
      snap.status = b.status;
      snap.x = b.x;
      snap.y = b.y;
      snap.row = b.row;
      snap.col = b.col;
      snap.color = color;
      snap.iceCount = b.iceCount;
      snap.chained = b.chained;
      snap.ropeColor = b.ropeColor;
    } else {
      rctx.blockLayerSnapshots.set(b.id, {
        cursor: b.colorCursor,
        status: b.status,
        x: b.x,
        y: b.y,
        row: b.row,
        col: b.col,
        color,
        iceCount: b.iceCount,
        chained: b.chained,
        ropeColor: b.ropeColor,
      });
    }
  }
  if (rctx.blockLayerSnapshots.size !== board.blocks.length) {
    rctx.blockLayerSnapshots.clear();
    for (let i = 0; i < board.blocks.length; i++) {
      const b = board.blocks[i];
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
  }
  if (rctx.crateSnapshots.size !== board.crates.length) rctx.crateSnapshots.clear();
  for (let i = 0; i < board.crates.length; i++) {
    const c = board.crates[i];
    const snap = rctx.crateSnapshots.get(c.id);
    if (snap) {
      snap.hp = c.hp;
      snap.destroyed = c.destroyed;
    } else {
      rctx.crateSnapshots.set(c.id, { hp: c.hp, destroyed: c.destroyed });
    }
  }
  if (rctx.gateSnapshots.size !== board.gates.length) rctx.gateSnapshots.clear();
  for (let idx = 0; idx < board.gates.length; idx++) {
    const g = board.gates[idx];
    const snap = rctx.gateSnapshots.get(idx);
    if (snap) {
      snap.colorCursor = g.colorCursor;
      snap.iceCount = g.iceCount;
      snap.shutterOpen = g.shutterOpen;
      snap.shutterLockColor = g.shutterLockColor;
      snap.spanStart = g.spanStart;
      snap.spanLength = g.spanLength;
    } else {
      rctx.gateSnapshots.set(idx, {
        colorCursor: g.colorCursor,
        iceCount: g.iceCount,
        shutterOpen: g.shutterOpen,
        shutterLockColor: g.shutterLockColor,
        spanStart: g.spanStart,
        spanLength: g.spanLength,
      });
    }
  }
  if (rctx.elevatorSnapshots.size !== board.elevators.length) rctx.elevatorSnapshots.clear();
  for (let i = 0; i < board.elevators.length; i++) {
    const el = board.elevators[i];
    const snap = rctx.elevatorSnapshots.get(el.id);
    if (snap) {
      snap.atAlternatePos = el.atAlternatePos;
    } else {
      rctx.elevatorSnapshots.set(el.id, { atAlternatePos: el.atAlternatePos });
    }
  }
  if (rctx.barrierSnapshots.size !== board.barriers.length) rctx.barrierSnapshots.clear();
  for (let i = 0; i < board.barriers.length; i++) {
    const bar = board.barriers[i];
    const snap = rctx.barrierSnapshots.get(bar.id);
    if (snap) {
      snap.open = bar.open;
      snap.shredsRemaining = bar.shredsRemaining;
    } else {
      rctx.barrierSnapshots.set(bar.id, {
        open: bar.open,
        shredsRemaining: bar.shredsRemaining,
      });
    }
  }
}

export function detectAutomaticShredEventsImpl(
  rctx: RenderPassContext,
  board: BoardState,
  options: RenderSceneOptions
): void {
  const isBoardReplaced = rctx.lastSyncedBoardRef !== undefined && board !== rctx.lastSyncedBoardRef;
  const isLevelChange = board.levelId !== rctx.lastBoardLevelId;
  const isUndoOrRestart =
    board.movesCommitted < rctx.lastMovesCommitted ||
    (board.movesCommitted === 0 && rctx.lastMovesCommitted > 0) ||
    board.sessionBlocksShredded < rctx.lastSessionShredded;

  if (isBoardReplaced || isLevelChange || isUndoOrRestart) {
    syncSnapshotsImpl(rctx, board);
    rctx.roomAwakenMap.clear();
    rctx.activePathTraces.length = 0;
    rctx.activeGateBursts.length = 0;
    rctx.activeVisualShreds.length = 0;
    rctx.blockBounceMap.clear();
    rctx.boardShakeTimer = 0;
    // Preserve Relic Awakening shards/smoke/embers during Title -> Game transition (blueprintMix > 0.01)
    if ((options.blueprintMix ?? 0) <= 0.01) {
      rctx.activeShockwaves.length = 0;
      rctx.particlePoolCount = 0;
      rctx.particleWriteCursor = 0;
      rctx.activeParticleCount = 0;
      rctx.activeSmokeCount = 0;
      rctx.hasGameplayParticles = false;
      rctx.qualityGovernor.setActiveParticles(0);
    }
    return;
  }

  const hc = Boolean(options.highContrast);
  const cbMode = Boolean(options.colorblindSymbols);
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
      const [cr, cg, cb] = rctx.getColorRgb(curColor, hc, cbMode);
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
        const { emitX, emitY, nx, ny } = computeGateShredContactPoint(b.x, b.y, shape.cols, shape.rows, gate);
        if (gate) {
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
        spawnStyledShredShockwavesAndGateFx(rctx, emitX, emitY, prev.color, gate, pStyle);
        rctx.spawnParticlesAt(
          emitX,
          emitY,
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
          const [rr, rg, rb] = rctx.getColorRgb(prev.ropeColor, hc, cbMode);
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
  for (let gi = 0; gi < board.gates.length; gi++) {
    const gate = board.gates[gi];
    const prevG = rctx.gateSnapshots.get(gi);
    if (!prevG) continue;
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
      const [gr, gg, gb] = iceShattered ? [0.45, 0.92, 1.0] : rctx.getColorRgb(cId, hc, cbMode);
      rctx.spawnShockwave(gx, gy, 0.52, gr, gg, gb, 0.2, 0.85, 0.32);
      rctx.spawnParticlesAt(gx, gy, 0.5, iceShattered ? 7 : cId, 8, 0, 0, pStyle);
    }
  }

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
