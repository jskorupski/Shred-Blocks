import { getGateOutwardNormal } from '../core/gate-clearance';
import { getBlockRoomId, isBlockInLockedRoom, isBlockInSealedVault } from '../core/physics';
import { getShape } from '../core/polyomino';
import type { AxisLock, BlockState, BoardState, ColorId, SkinId } from '../core/types';
import type { RenderPassContext, RenderSceneOptions } from './render-types';

/**
 * Per-block animated transform pose computed once per frame so block shells, inner cores,
 * straps, chains, rails, medallions, colorblind sigils, and glued weld clamps stay in
 * 100% rigid alignment throughout idle breathing, spotlight hops, bounces, rebounds, drags,
 * and shredder feeds (`Z-CLEARANCE-01`).
 */
export interface AnimatedBlockPose {
  blockId: number;
  poseSeed: number;
  groupId: number;
  drawX: number;
  drawY: number;
  meshTx: number;
  meshTy: number;
  zLift: number;
  scaleXY: number;
  scaleZ: number;
  colorMul: number;
  rRoomMul: number;
  blockHopEnv: number;
  bombHeartbeat: number;
  liftAlpha: number;
  roomZOffset: number;
  roomLum: number;
  effectiveRoomLum: number;
  isLockedRoom: boolean;
  isGrabbed: boolean;
  isIdleMovable: boolean;
}

/**
 * Precomputed block-local Z clearances parameterized by `(skinId, layersLeft > 1, activeColor === 0, hasStraps)`
 * so overlays never clip into raised `classic_studs` (`0.623` / `0.677`) or multi-layer inner cores (`0.602` / `0.606`).
 */
export interface BlockSurfaceClearanceLocalZ {
  readonly surfaceTop: number;
  readonly railCenter: number;
  readonly railSizeZ: number;
  readonly strapBottom: number;
  readonly strapHorizCenter: number;
  readonly strapHorizSizeZ: number;
  readonly strapVertTop: number;
  readonly strapVertCenter: number;
  readonly strapVertSizeZ: number;
  readonly ropeKnotTop: number;
  readonly ropeKnotCenter: number;
  readonly ropeKnotSizeZ: number;
  readonly ropeKnotSigil: number;
  readonly underneathMedallionTop: number;
  readonly medallionBase: number;
  readonly capPadBottom: number;
  readonly capPadTop: number;
  readonly capPadCenter: number;
  readonly capPadSizeZ: number;
  readonly cbSymbol: number;
  readonly busyCornerCapPadTop: number;
  readonly busyCornerCapPadCenter: number;
  readonly busyCornerCapPadSizeZ: number;
  readonly busyCornerSigil: number;
}

const CLEARANCE_CACHE: Array<BlockSurfaceClearanceLocalZ | undefined> = new Array(40);

function getSkinIdx(skinId: SkinId): number {
  if (skinId === 'relic_stone') return 1;
  if (skinId === 'gummy_jelly') return 2;
  if (skinId === 'carved_wood') return 3;
  if (skinId === 'neon_cyber') return 4;
  return 0;
}

/** Returns the highest geometry Z (`surfaceTop`) of a block mesh in unit local block coordinates. */
export function getBlockSurfaceTopLocalZ(skinId: SkinId, layersLeft: number, activeColor: ColorId): number {
  if (activeColor === 0) return 0.58;
  if (skinId === 'classic_studs') {
    return layersLeft > 1 ? 0.677 : 0.623;
  }
  if (layersLeft > 1) {
    return skinId === 'relic_stone' ? 0.606 : 0.602;
  }
  return 0.58;
}

/** Returns cached immutable block-local Z clearances for `(skinId, layersLeft, activeColor, hasStraps)`. */
export function computeBlockSurfaceClearanceLocalZ(
  skinId: SkinId,
  layersLeft: number,
  activeColor: ColorId,
  hasStraps: boolean
): BlockSurfaceClearanceLocalZ {
  const isMulti = layersLeft > 1;
  const isNeutral = activeColor === 0;
  const cacheIdx = getSkinIdx(skinId) * 8 + (isMulti ? 4 : 0) + (isNeutral ? 2 : 0) + (hasStraps ? 1 : 0);
  const cached = CLEARANCE_CACHE[cacheIdx];
  if (cached) return cached;

  const surfaceTop = getBlockSurfaceTopLocalZ(skinId, layersLeft, activeColor);
  const strapBottom = 0.564;
  const strapHorizTop = surfaceTop + 0.016;
  const strapVertTop = surfaceTop + 0.02;
  const ropeKnotTop = strapVertTop + 0.012;
  const underneathMedallionTop = hasStraps ? strapVertTop : surfaceTop;
  // Embed 0.010 of medallion skirt so there is zero air-gap while rim (+0.072), face (+0.082),
  // and glyph (+0.086) sit strictly above straps, inner cores, and classic studs.
  const medallionBase = underneathMedallionTop - 0.01;
  const capPadBottom = 0.574;
  const capPadTop = Math.max(0.64, (hasStraps ? strapVertTop : surfaceTop) + 0.012);
  const cbSymbol = Math.max(0.692, capPadTop + 0.012);
  // Busy 1x1 corners clear even a hovered center medallion (0.016 max hover + 0.082 face = 0.098 above medallionBase)
  const busyCornerCapPadTop = medallionBase + 0.108;

  const result: BlockSurfaceClearanceLocalZ = Object.freeze({
    surfaceTop,
    railCenter: 0.592,
    railSizeZ: 0.058,
    strapBottom,
    strapHorizCenter: (strapBottom + strapHorizTop) * 0.5,
    strapHorizSizeZ: strapHorizTop - strapBottom,
    strapVertTop,
    strapVertCenter: (strapBottom + strapVertTop) * 0.5,
    strapVertSizeZ: strapVertTop - strapBottom,
    ropeKnotTop,
    ropeKnotCenter: (0.568 + ropeKnotTop) * 0.5,
    ropeKnotSizeZ: ropeKnotTop - 0.568,
    ropeKnotSigil: ropeKnotTop + 0.006,
    underneathMedallionTop,
    medallionBase,
    capPadBottom,
    capPadTop,
    capPadCenter: (capPadBottom + capPadTop) * 0.5,
    capPadSizeZ: capPadTop - capPadBottom,
    cbSymbol,
    busyCornerCapPadTop,
    busyCornerCapPadCenter: (capPadBottom + busyCornerCapPadTop) * 0.5,
    busyCornerCapPadSizeZ: busyCornerCapPadTop - capPadBottom,
    busyCornerSigil: busyCornerCapPadTop + 0.008,
  });
  CLEARANCE_CACHE[cacheIdx] = result;
  return result;
}

/** Transforms a block-local X coordinate into animated world board space. */
export function blockLocalXToWorld(pose: AnimatedBlockPose, localX: number): number {
  return pose.meshTx + localX * pose.scaleXY;
}

/** Transforms a block-local Y coordinate into animated world board space. */
export function blockLocalYToWorld(pose: AnimatedBlockPose, localY: number): number {
  return pose.meshTy + localY * pose.scaleXY;
}

/** Transforms a block-local Z coordinate into animated world Z space. */
export function blockLocalZToWorld(pose: AnimatedBlockPose, localZ: number): number {
  return pose.zLift + localZ * pose.scaleZ;
}

/**
 * Returns the floor surface top Z at cell `(row, col)`, accounting for lowered locked-room
 * elevation AND raised moving elevator decks (`0.064` above room base so reticles and hints stay visible).
 */
export function getCellFloorTopZ(
  board: BoardState,
  rctx: RenderPassContext,
  row: number,
  col: number
): number {
  const cr = Math.max(0, Math.min(board.rows - 1, Math.floor(row)));
  const cc = Math.max(0, Math.min(board.cols - 1, Math.floor(col)));
  const roomId = board.roomMap[cr * board.cols + cc] ?? 0;
  const roomVis = rctx.getRoomVisualState(board, roomId);
  for (let i = 0; i < board.elevators.length; i++) {
    const elev = board.elevators[i];
    if (cr >= elev.row && cr < elev.row + elev.height && cc >= elev.col && cc < elev.col + elev.width) {
      return roomVis.zOffset + 0.064;
    }
  }
  return roomVis.zOffset;
}

interface GroupPoseAggregate {
  repBlock: BlockState;
  hasBlocker: boolean;
  hasH: boolean;
  hasV: boolean;
  isGrabbed: boolean;
  maxLiftAlpha: number;
  maxBounceRem: number;
  maxBombHeartbeat: number;
  reboundX: number;
  reboundY: number;
  maxReboundMagSq: number;
}

const POSES_SCRATCH = new Map<number, AnimatedBlockPose>();
const GROUP_AGG_SCRATCH = new Map<number, GroupPoseAggregate>();
const GROUP_AGG_POOL: GroupPoseAggregate[] = [];
const IDLE_REP_SCRATCH: number[] = [];

function createEmptyPose(): AnimatedBlockPose {
  return {
    blockId: 0,
    poseSeed: 0,
    groupId: 0,
    drawX: 0,
    drawY: 0,
    meshTx: 0,
    meshTy: 0,
    zLift: 0,
    scaleXY: 1,
    scaleZ: 1,
    colorMul: 1,
    rRoomMul: 1,
    blockHopEnv: 0,
    bombHeartbeat: 0,
    liftAlpha: 0,
    roomZOffset: 0,
    roomLum: 1,
    effectiveRoomLum: 1,
    isLockedRoom: false,
    isGrabbed: false,
    isIdleMovable: false,
  };
}

function stepAndComputeReboundOffset(
  board: BoardState,
  block: BlockState,
  dtMs: number
): { rx: number; ry: number } {
  if (block.reboundTimerMs <= 0) return { rx: 0, ry: 0 };
  block.reboundTimerMs = Math.max(0, block.reboundTimerMs - dtMs);
  const reboundT = block.reboundTimerMs / 200;
  if (block.shredGateIndex >= 0 && board.gates[block.shredGateIndex]) {
    const [nx, ny] = getGateOutwardNormal(board.gates[block.shredGateIndex].edge);
    const bounce = Math.sin(reboundT * Math.PI) * 0.14;
    return { rx: -nx * bounce, ry: -ny * bounce };
  }
  return { rx: Math.sin(block.reboundTimerMs * 0.08) * 0.09 * reboundT, ry: 0 };
}

/**
 * Computes rigid unified per-block poses across all visible blocks (`PASS 3` & Canvas2D parity).
 * Glued blocks sharing `groupId > 0` evaluate movability via `isBlockMovable` and synchronize
 * spotlight hop, idle wave, lift, bomb heartbeat, bounce, and rebound offsets across the assembly.
 */
export function computeBoardAnimatedBlockPoses(
  rctx: RenderPassContext,
  board: BoardState,
  draggedGroupIds: ReadonlySet<number>,
  anyDragActive: boolean,
  options: RenderSceneOptions,
  timeSec: number,
  dtMs: number
): Map<number, AnimatedBlockPose> {
  const poses = POSES_SCRATCH;
  poses.clear();
  GROUP_AGG_SCRATCH.clear();
  IDLE_REP_SCRATCH.length = 0;

  const reducedMotion = Boolean(options.reducedMotion);
  const colorblind = Boolean(options.colorblindSymbols);
  const live3DMix = Math.max(0, 1.0 - (options.blueprintMix ?? 0));
  let poolCursor = 0;

  // Step 1: Aggregate active glued groups (`groupId > 0`) & step individual rebound timers
  for (let i = 0; i < board.blocks.length; i++) {
    const block = board.blocks[i];
    if (block.status === 'CLEARED' || isBlockInSealedVault(board, block)) continue;

    let pose = poses.get(block.id);
    if (!pose) {
      pose = createEmptyPose();
      poses.set(block.id, pose);
    }

    const { rx, ry } = stepAndComputeReboundOffset(board, block, dtMs);
    const blockRoomId = getBlockRoomId(board, block);
    const blockRoomVis = rctx.getRoomVisualState(board, blockRoomId);
    const bounceRem = rctx.blockBounceMap.get(block.id) ?? 0;
    const isBombBlock = !reducedMotion && !blockRoomVis.isLocked && block.bombMax > 0 && block.bombCount > 0;
    const bombHeartbeat = isBombBlock
      ? (0.5 + 0.5 * Math.sin(timeSec * (block.bombCount <= 4 ? 7.6 : 4.2) + block.id)) *
        (block.bombCount <= 4 ? 0.036 : 0.018)
      : 0;

    if (block.status === 'ACTIVE' && block.groupId > 0) {
      let agg = GROUP_AGG_SCRATCH.get(block.groupId);
      if (!agg) {
        const recycled = GROUP_AGG_POOL[poolCursor];
        if (recycled) {
          agg = recycled;
          agg.repBlock = block;
          agg.hasBlocker = false;
          agg.hasH = false;
          agg.hasV = false;
          agg.isGrabbed = false;
          agg.maxLiftAlpha = 0;
          agg.maxBounceRem = 0;
          agg.maxBombHeartbeat = 0;
          agg.reboundX = 0;
          agg.reboundY = 0;
          agg.maxReboundMagSq = 0;
        } else {
          agg = {
            repBlock: block,
            hasBlocker: false,
            hasH: false,
            hasV: false,
            isGrabbed: false,
            maxLiftAlpha: 0,
            maxBounceRem: 0,
            maxBombHeartbeat: 0,
            reboundX: 0,
            reboundY: 0,
            maxReboundMagSq: 0,
          };
          GROUP_AGG_POOL.push(agg);
        }
        poolCursor++;
        GROUP_AGG_SCRATCH.set(block.groupId, agg);
      }
      if (block.id < agg.repBlock.id) agg.repBlock = block;
      if (
        block.iceCount > 0 ||
        block.chained ||
        block.ropeColor > 0 ||
        blockRoomVis.isLocked ||
        isBlockInLockedRoom(board, block)
      ) {
        agg.hasBlocker = true;
      }
      if (block.axisLock === 'H') agg.hasH = true;
      else if (block.axisLock === 'V') agg.hasV = true;
      if (draggedGroupIds.has(block.id) || block.liftAlpha > 0.05) agg.isGrabbed = true;
      if (block.liftAlpha > agg.maxLiftAlpha) agg.maxLiftAlpha = block.liftAlpha;
      if (bounceRem > agg.maxBounceRem) agg.maxBounceRem = bounceRem;
      if (bombHeartbeat > agg.maxBombHeartbeat) agg.maxBombHeartbeat = bombHeartbeat;
      const rMagSq = rx * rx + ry * ry;
      if (rMagSq > agg.maxReboundMagSq) {
        agg.maxReboundMagSq = rMagSq;
        agg.reboundX = rx;
        agg.reboundY = ry;
      }
    }

    pose.blockId = block.id;
    pose.groupId = block.groupId;
    pose.drawX = rx;
    pose.drawY = ry;
    pose.bombHeartbeat = bombHeartbeat;
    pose.roomZOffset = blockRoomVis.zOffset;
    pose.roomLum = blockRoomVis.luminanceMul;
    pose.isLockedRoom = blockRoomVis.isLocked;
    pose.liftAlpha = block.liftAlpha;
    pose.isGrabbed = draggedGroupIds.has(block.id) || block.liftAlpha > 0.05;
  }

  // Step 2: Select canonical idle-movable seeds (`IDLE-02` spotlight hop treats each glued group as one unit)
  for (let i = 0; i < board.blocks.length; i++) {
    const blk = board.blocks[i];
    if (blk.status !== 'ACTIVE' || isBlockInSealedVault(board, blk)) continue;
    if (blk.groupId > 0) {
      const agg = GROUP_AGG_SCRATCH.get(blk.groupId);
      const groupMovable = agg ? !agg.hasBlocker && !(agg.hasH && agg.hasV) : false;
      if (agg && agg.repBlock.id === blk.id && groupMovable && !agg.isGrabbed && agg.maxLiftAlpha <= 0.05) {
        IDLE_REP_SCRATCH.push(blk.id);
      }
    } else if (
      blk.iceCount === 0 &&
      !blk.chained &&
      blk.ropeColor === 0 &&
      !isBlockInLockedRoom(board, blk) &&
      !draggedGroupIds.has(blk.id) &&
      blk.liftAlpha <= 0.05
    ) {
      IDLE_REP_SCRATCH.push(blk.id);
    }
  }

  const spotlightCycleSec = 3.2;
  const spotlightHopWindowSec = 0.72;
  const spotlightCycleIndex = Math.floor(timeSec / spotlightCycleSec);
  const spotlightPhaseSec = timeSec - spotlightCycleIndex * spotlightCycleSec;
  const spotlightBlockId =
    !reducedMotion &&
    !anyDragActive &&
    IDLE_REP_SCRATCH.length > 0 &&
    spotlightPhaseSec < spotlightHopWindowSec
      ? IDLE_REP_SCRATCH[spotlightCycleIndex % IDLE_REP_SCRATCH.length]
      : -1;
  const spotlightHopT = spotlightBlockId >= 0 ? spotlightPhaseSec / spotlightHopWindowSec : 0;
  const spotlightHopEnv =
    spotlightBlockId >= 0
      ? Math.sin(spotlightHopT * Math.PI) * Math.abs(Math.sin(spotlightHopT * Math.PI * 2.0))
      : 0;

  // Step 3: Resolve final world pose `(drawX, drawY, meshTx, meshTy, zLift, scaleXY, scaleZ)` per block
  for (let i = 0; i < board.blocks.length; i++) {
    const block = board.blocks[i];
    if (block.status === 'CLEARED' || isBlockInSealedVault(board, block)) continue;
    const pose = poses.get(block.id);
    if (!pose) continue;

    const shape = getShape(block.shapeId);
    const agg =
      block.status === 'ACTIVE' && block.groupId > 0 ? GROUP_AGG_SCRATCH.get(block.groupId) : undefined;
    const rep = agg ? agg.repBlock : block;
    const poseSeed = rep.id;
    const isGrabbed = agg ? agg.isGrabbed : pose.isGrabbed;
    const liftAlpha = agg ? agg.maxLiftAlpha : block.liftAlpha;
    const bombHeartbeat = agg ? agg.maxBombHeartbeat : pose.bombHeartbeat;
    const bounceRem = agg ? agg.maxBounceRem : (rctx.blockBounceMap.get(block.id) ?? 0);
    const canMove =
      block.status === 'ACTIVE' &&
      (agg
        ? !agg.hasBlocker && !(agg.hasH && agg.hasV)
        : !pose.isLockedRoom && block.iceCount === 0 && !block.chained && block.ropeColor === 0);
    const isIdleMovable = !reducedMotion && !isGrabbed && canMove;
    const isSpotlightHopping = isIdleMovable && poseSeed === spotlightBlockId;
    const blockHopEnv = isSpotlightHopping ? spotlightHopEnv : 0;

    const wavePhase = timeSec * 2.1 - (rep.col * 0.68 + rep.row * 0.54) + poseSeed * 0.55;
    const wave01 = isIdleMovable ? 0.5 + 0.5 * Math.sin(wavePhase) : 0;

    const idleColorBoost = isIdleMovable ? wave01 * 0.048 + blockHopEnv * 0.075 : bombHeartbeat * 1.2;
    const effectiveRoomLum = colorblind
      ? pose.roomLum + (1 - pose.roomLum) * (1 - live3DMix) * 0.85
      : pose.roomLum;
    const colorMul = (isGrabbed ? 1.14 : anyDragActive ? 0.88 : 1.0 + idleColorBoost) * effectiveRoomLum;

    const idleBreathZ =
      (isIdleMovable ? wave01 * 0.038 + blockHopEnv * 0.052 : bombHeartbeat * 0.5) * live3DMix;
    const grabHoverZ =
      !reducedMotion && isGrabbed ? Math.sin(timeSec * 7.2) * 0.022 * Math.min(1, liftAlpha) : 0;
    const zLift = pose.roomZOffset + Math.max(0, Math.min(1, liftAlpha)) * 0.46 + grabHoverZ + idleBreathZ;

    const bouncePop =
      bounceRem > 0 && !reducedMotion ? Math.sin((1.0 - bounceRem / 0.34) * Math.PI) * 0.14 : 0;
    const idleScaleXY =
      (isIdleMovable ? Math.sin(wavePhase) * 0.01 + blockHopEnv * 0.018 : bombHeartbeat) * live3DMix;
    const idleScaleZ =
      (isIdleMovable ? Math.sin(wavePhase) * 0.015 + blockHopEnv * 0.025 : bombHeartbeat) * live3DMix;
    const scaleXY = 1.0 + 0.05 * Math.min(1, liftAlpha) + bouncePop + idleScaleXY;
    const scaleZ = 1.0 + 0.06 * Math.min(1, liftAlpha) + bouncePop * 0.8 + idleScaleZ;

    const effAxisLock: AxisLock | 'LOCKED_BOTH' = agg
      ? agg.hasH && agg.hasV
        ? 'LOCKED_BOTH'
        : agg.hasH
          ? 'H'
          : agg.hasV
            ? 'V'
            : 'NONE'
      : block.axisLock;
    let idleDriftX = 0;
    let idleDriftY = 0;
    if (isIdleMovable && live3DMix > 0.1) {
      const hopWiggle = isSpotlightHopping ? Math.sin(spotlightHopT * Math.PI * 4.0) * 0.014 : 0;
      if (effAxisLock === 'H') {
        idleDriftX = (Math.sin(timeSec * 2.0 + poseSeed * 1.3) * 0.008 + hopWiggle) * live3DMix;
      } else if (effAxisLock === 'V') {
        idleDriftY = (Math.sin(timeSec * 2.0 + poseSeed * 1.3) * 0.008 + hopWiggle) * live3DMix;
      }
    }

    const reboundX = agg ? agg.reboundX : pose.drawX;
    const reboundY = agg ? agg.reboundY : pose.drawY;
    let drawX = block.x + idleDriftX + reboundX;
    let drawY = block.y + idleDriftY + reboundY;

    if (
      (block.status === 'SHREDDING' || block.shredProgress > 0) &&
      block.shredGateIndex >= 0 &&
      board.gates[block.shredGateIndex]
    ) {
      const gate = board.gates[block.shredGateIndex];
      const [nx, ny] = getGateOutwardNormal(gate.edge);
      const span = nx !== 0 ? shape.cols : shape.rows;
      const feedDist = block.shredProgress * (span + 0.45);
      drawX += nx * feedDist;
      drawY += ny * feedDist;
    }

    pose.poseSeed = poseSeed;
    pose.drawX = drawX;
    pose.drawY = drawY;
    pose.meshTx = drawX - (scaleXY - 1.0) * shape.cols * 0.5;
    pose.meshTy = drawY - (scaleXY - 1.0) * shape.rows * 0.5;
    pose.zLift = zLift;
    pose.scaleXY = scaleXY;
    pose.scaleZ = scaleZ;
    pose.colorMul = colorMul;
    pose.rRoomMul = effectiveRoomLum;
    pose.blockHopEnv = blockHopEnv;
    pose.bombHeartbeat = bombHeartbeat;
    pose.liftAlpha = liftAlpha;
    pose.effectiveRoomLum = effectiveRoomLum;
    pose.isGrabbed = isGrabbed;
    pose.isIdleMovable = isIdleMovable;
  }

  return poses;
}
