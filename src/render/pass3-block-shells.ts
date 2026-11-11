import { getGateOutwardNormal } from '../core/gate-clearance';
import {
  getBlockRoomId,
  getMovedGroupBlocks,
  isBlockInLockedRoom,
  isBlockInSealedVault,
} from '../core/physics';
import { getActiveColor, getLayersRemaining, getShape } from '../core/polyomino';
import type { BoardState, ColorId, SkinId } from '../core/types';
import { ENVIRONMENT_MESHES, getPolyominoMeshPair, POLYOMINO_MESH_CATALOG } from './mesh-generator';
import { renderBlockSurfaceOverlays3D, renderGhostAndWeldClamps3D } from './pass3-block-overlays';
import type { RenderPassContext, RenderSceneOptions } from './render-types';

export function renderPass3BlocksImpl(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  board: BoardState,
  options: RenderSceneOptions,
  skinId: SkinId,
  highContrast: boolean,
  colorblind: boolean,
  pulse: number,
  timeSec: number,
  dtSec = 1 / 60
): void {
  const matStyle = rctx.getMaterialStyleCode(skinId);
  const dtMs = dtSec * 1000;
  const reducedMotion = Boolean(options.reducedMotion);
  const isStoneRuin = (options.blueprintMix ?? 0) > 0.45;
  const live3DMix = Math.max(0, 1.0 - (options.blueprintMix ?? 0));

  // Identify all blocks in the currently grabbed/dragged group (`F-03`)
  const draggedGroupIds = new Set<number>();
  const liftedBlock = board.blocks.find((b) => b.status === 'ACTIVE' && b.liftAlpha > 0.05);
  const leadDraggedId = liftedBlock ? liftedBlock.id : null;
  if (leadDraggedId !== null) {
    for (const gb of getMovedGroupBlocks(board, leadDraggedId)) {
      draggedGroupIds.add(gb.id);
    }
  }
  const anyDragActive = draggedGroupIds.size > 0;

  // 3.0 Visual Shred Clip-Plane Animation Queue (`R3D-01`, `R3D-02`, `R3D-14`)
  for (let i = rctx.activeVisualShreds.length - 1; i >= 0; i--) {
    const anim = rctx.activeVisualShreds[i];
    anim.progress += dtSec / 0.22;
    const gate = board.gates[anim.gateIndex];
    if (anim.progress >= 1 || !gate) {
      rctx.activeVisualShreds.splice(i, 1);
      continue;
    }

    gate.rollerPhase += dtSec * 14.0;
    const shape = getShape(anim.shapeId);
    const meshPair = getPolyominoMeshPair(anim.shapeId, skinId);
    const [r, g, b] = rctx.getColorRgb(anim.colorId, highContrast);
    const [nx, ny] = getGateOutwardNormal(gate.edge);
    const span = nx !== 0 ? shape.cols : shape.rows;
    const feedDist = anim.progress * (span + 0.45);
    const sx = anim.x + nx * feedDist;
    const sy = anim.y + ny * feedDist;

    const planeNx = -nx;
    const planeNy = -ny;
    let planeD = 0.21;
    if (gate.edge === 'TOP') planeD = 0.21 - gate.edgeLine;
    else if (gate.edge === 'BOTTOM') planeD = gate.edgeLine + 1 + 0.21;
    else if (gate.edge === 'LEFT') planeD = 0.21 - gate.edgeLine;
    else if (gate.edge === 'RIGHT') planeD = gate.edgeLine + 1 + 0.21;

    gl.disable(gl.CULL_FACE);
    gl.uniform1i(rctx.uUseClipPlane, 1);
    gl.uniform4f(rctx.uClipPlane, planeNx, planeNy, 0, planeD);
    gl.uniform3f(rctx.uCapColor, r * 0.72, g * 0.72, b * 0.72);

    const shredOuterMesh =
      anim.isOuterPeelOnly && skinId === 'classic_studs'
        ? (POLYOMINO_MESH_CATALOG[anim.shapeId]?.meshOuter ?? meshPair.meshOuter)
        : meshPair.meshOuter;
    const isHorizShredGate = gate.edge === 'TOP' || gate.edge === 'BOTTOM';
    const shredAdjR = isHorizShredGate ? gate.edgeLine : gate.spanStart;
    const shredAdjC = isHorizShredGate ? gate.spanStart : gate.edgeLine;
    const shredRoomId =
      shredAdjR >= 0 && shredAdjR < board.rows && shredAdjC >= 0 && shredAdjC < board.cols
        ? (board.roomMap[shredAdjR * board.cols + shredAdjC] ?? 0)
        : 0;
    const shredRoomVis = rctx.getRoomVisualState(board, shredRoomId);

    rctx.drawMesh(
      gl,
      shredOuterMesh,
      sx,
      sy,
      shredRoomVis.zOffset,
      1.0,
      1.0,
      1.0,
      r * shredRoomVis.luminanceMul,
      g * shredRoomVis.luminanceMul,
      b * shredRoomVis.luminanceMul,
      1.0,
      0,
      0,
      anim.colorId === 0 ? 6 : matStyle
    );

    gl.uniform1i(rctx.uUseClipPlane, 0);
    gl.enable(gl.CULL_FACE);
  }

  // Identify all idle movable blocks so we can cycle the Staggered Spotlight Double-Bounce Hop (`IDLE-02`)
  const idleMovableBlockIds: number[] = [];
  for (const blk of board.blocks) {
    if (
      blk.status === 'ACTIVE' &&
      blk.iceCount === 0 &&
      !blk.chained &&
      blk.ropeColor === 0 &&
      !isBlockInLockedRoom(board, blk) &&
      !draggedGroupIds.has(blk.id) &&
      blk.liftAlpha <= 0.05
    ) {
      idleMovableBlockIds.push(blk.id);
    }
  }
  const spotlightCycleSec = 3.2;
  const spotlightHopWindowSec = 0.72;
  const spotlightCycleIndex = Math.floor(timeSec / spotlightCycleSec);
  const spotlightPhaseSec = timeSec - spotlightCycleIndex * spotlightCycleSec;
  const spotlightBlockId =
    !reducedMotion &&
    !anyDragActive &&
    idleMovableBlockIds.length > 0 &&
    spotlightPhaseSec < spotlightHopWindowSec
      ? idleMovableBlockIds[spotlightCycleIndex % idleMovableBlockIds.length]
      : -1;
  const spotlightHopT = spotlightBlockId >= 0 ? spotlightPhaseSec / spotlightHopWindowSec : 0;
  const spotlightHopEnv =
    spotlightBlockId >= 0
      ? Math.sin(spotlightHopT * Math.PI) * Math.abs(Math.sin(spotlightHopT * Math.PI * 2.0))
      : 0;

  for (const block of board.blocks) {
    if (block.status === 'CLEARED') continue;
    if (isBlockInSealedVault(board, block)) continue;

    const shape = getShape(block.shapeId);
    const meshPair = getPolyominoMeshPair(block.shapeId, skinId);
    const activeColor: ColorId = getActiveColor(block.colorStack, block.colorCursor);
    const [rawR, rawG, rawB] = rctx.getColorRgb(activeColor, highContrast);
    const layersLeft = getLayersRemaining(block.colorStack, block.colorCursor);

    const blockRoomId = getBlockRoomId(board, block);
    const blockRoomVis = rctx.getRoomVisualState(board, blockRoomId);
    const roomLum = blockRoomVis.luminanceMul;

    const isGrabbed = draggedGroupIds.has(block.id) || block.liftAlpha > 0.05;
    const isIdleMovable =
      !reducedMotion &&
      !isGrabbed &&
      !blockRoomVis.isLocked &&
      block.iceCount === 0 &&
      !block.chained &&
      block.ropeColor === 0;
    const isSpotlightHopping = isIdleMovable && block.id === spotlightBlockId;
    const blockHopEnv = isSpotlightHopping ? spotlightHopEnv : 0;

    // Diagonal harmonic wave across the courtyard (`IDLE-01`)
    const wavePhase = timeSec * 2.1 - (block.col * 0.68 + block.row * 0.54) + block.id * 0.55;
    const wave01 = isIdleMovable ? 0.5 + 0.5 * Math.sin(wavePhase) : 0;

    // Bomb blocks also throb with an urgent rhythmic heartbeat (`IDLE-05`)
    const isBombBlock = !reducedMotion && !blockRoomVis.isLocked && block.bombMax > 0 && block.bombCount > 0;
    const bombHeartbeat = isBombBlock
      ? (0.5 + 0.5 * Math.sin(timeSec * (block.bombCount <= 4 ? 7.6 : 4.2) + block.id)) *
        (block.bombCount <= 4 ? 0.036 : 0.018)
      : 0;

    const idleColorBoost = isIdleMovable ? wave01 * 0.048 + blockHopEnv * 0.075 : bombHeartbeat * 1.2;
    const colorMul = (isGrabbed ? 1.14 : anyDragActive ? 0.88 : 1.0 + idleColorBoost) * roomLum;
    const r = Math.min(1, rawR * colorMul + (1 - roomLum) * 0.03);
    const g = Math.min(1, rawG * colorMul + (1 - roomLum) * 0.04);
    const b = Math.min(1, rawB * colorMul + (1 - roomLum) * 0.09);

    // Gentle 3D vertical buoyancy + Spotlight Double-Bounce Hop (`IDLE-01`, `IDLE-02`)
    // Scaled by `live3DMix` so blocks lie still as an etched scroll diagram on the Title Screen
    const idleBreathZ =
      (isIdleMovable ? wave01 * 0.038 + blockHopEnv * 0.052 : bombHeartbeat * 0.5) * live3DMix;
    const grabHoverZ =
      !reducedMotion && isGrabbed ? Math.sin(timeSec * 7.2) * 0.022 * Math.min(1, block.liftAlpha) : 0;
    const zLift =
      blockRoomVis.zOffset + Math.max(0, Math.min(1, block.liftAlpha)) * 0.46 + grabHoverZ + idleBreathZ;

    // Knock-on scale bounce + grabbed scale pop + idle breathing scale (`IDLE-01`, `IDLE-02`)
    const bounceRem = rctx.blockBounceMap.get(block.id) ?? 0;
    const bouncePop =
      bounceRem > 0 && !reducedMotion ? Math.sin((1.0 - bounceRem / 0.34) * Math.PI) * 0.14 : 0;
    const idleScaleXY =
      (isIdleMovable ? Math.sin(wavePhase) * 0.01 + blockHopEnv * 0.018 : bombHeartbeat) * live3DMix;
    const idleScaleZ =
      (isIdleMovable ? Math.sin(wavePhase) * 0.015 + blockHopEnv * 0.025 : bombHeartbeat) * live3DMix;
    const scaleXY = 1.0 + 0.05 * Math.min(1, block.liftAlpha) + bouncePop + idleScaleXY;
    const scaleZ = 1.0 + 0.06 * Math.min(1, block.liftAlpha) + bouncePop * 0.8 + idleScaleZ;

    // Subtle axis-advertising micro-drift along free movement lanes (`IDLE-01`)
    let idleDriftX = 0;
    let idleDriftY = 0;
    if (isIdleMovable && live3DMix > 0.1) {
      const hopWiggle = isSpotlightHopping ? Math.sin(spotlightHopT * Math.PI * 4.0) * 0.014 : 0;
      if (block.axisLock === 'H') {
        idleDriftX = (Math.sin(timeSec * 2.0 + block.id * 1.3) * 0.008 + hopWiggle) * live3DMix;
      } else if (block.axisLock === 'V') {
        idleDriftY = (Math.sin(timeSec * 2.0 + block.id * 1.3) * 0.008 + hopWiggle) * live3DMix;
      }
    }

    let drawX = block.x + idleDriftX;
    let drawY = block.y + idleDriftY;

    // Damped spring rebound / immobile block tap shake (`R3D-01`)
    if (block.reboundTimerMs > 0) {
      block.reboundTimerMs = Math.max(0, block.reboundTimerMs - dtMs);
      const reboundT = block.reboundTimerMs / 200;
      if (block.shredGateIndex >= 0 && board.gates[block.shredGateIndex]) {
        const [nx, ny] = getGateOutwardNormal(board.gates[block.shredGateIndex].edge);
        const bounce = Math.sin(reboundT * Math.PI) * 0.14;
        drawX -= nx * bounce;
        drawY -= ny * bounce;
      } else {
        drawX += Math.sin(block.reboundTimerMs * 0.08) * 0.09 * reboundT;
      }
    }

    const meshTx = drawX - (scaleXY - 1.0) * shape.cols * 0.5;
    const meshTy = drawY - (scaleXY - 1.0) * shape.rows * 0.5;

    // Clip-plane shredding (`ENG-03`, `R3D-02`, `R3D-14`) when block is actively shredding through a gate
    let useClip = false;
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

      // Clip plane aligned with spinning roller centerline (`±0.21`, `R3D-14`)
      const planeNx = -nx;
      const planeNy = -ny;
      let planeD = 0.21;
      if (gate.edge === 'TOP') planeD = 0.21 - gate.edgeLine;
      else if (gate.edge === 'BOTTOM') planeD = gate.edgeLine + 1 + 0.21;
      else if (gate.edge === 'LEFT') planeD = 0.21 - gate.edgeLine;
      else if (gate.edge === 'RIGHT') planeD = gate.edgeLine + 1 + 0.21;

      useClip = true;
      gl.disable(gl.CULL_FACE);
      gl.uniform1i(rctx.uUseClipPlane, 1);
      gl.uniform4f(rctx.uClipPlane, planeNx, planeNy, 0, planeD);
      gl.uniform3f(rctx.uCapColor, r * 0.72, g * 0.72, b * 0.72);
    } else {
      gl.uniform1i(rctx.uUseClipPlane, 0);
    }

    // Dynamic floor drop shadow when lifted or spotlight-hopping (`IDLE-02`)
    const shadowAlpha = Math.max(block.liftAlpha, blockHopEnv * 0.28);
    if (shadowAlpha > 0.02) {
      for (const [dr, dc] of shape.cells) {
        // Crisp offset drop shadow on floor
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.overlayQuad,
          drawX + dc + 0.12 * shadowAlpha,
          drawY + dr + 0.14 * shadowAlpha,
          blockRoomVis.zOffset + 0.008,
          0.92,
          0.92,
          1.0,
          0.01,
          0.02,
          0.05,
          0.46 * shadowAlpha,
          0,
          0,
          4
        );
        // Energized pulsing block-tinted selection rim halo around actively grabbed/lifted block
        if (block.liftAlpha > 0.02) {
          rctx.drawMesh(
            gl,
            ENVIRONMENT_MESHES.overlayQuad,
            drawX + dc - 0.05,
            drawY + dr - 0.05,
            Math.max(0.02, zLift - 0.015),
            1.1,
            1.1,
            1.0,
            Math.min(1, rawR * 0.65 + 0.35),
            Math.min(1, rawG * 0.65 + 0.35),
            Math.min(1, rawB * 0.65 + 0.35),
            (0.42 + 0.22 * pulse) * block.liftAlpha,
            0,
            0,
            4
          );
        }
      }
    }

    // 3A. Outer Morphological Shell (`meshOuter`; un-studded collar when `layersLeft > 1` in gameplay, pure solid block in Stone Ruin mode)
    const outerMesh =
      !isStoneRuin && layersLeft > 1 && skinId === 'classic_studs'
        ? (POLYOMINO_MESH_CATALOG[block.shapeId]?.meshOuter ?? meshPair.meshOuter)
        : meshPair.meshOuter;

    rctx.drawMesh(
      gl,
      outerMesh,
      useClip ? drawX : meshTx,
      useClip ? drawY : meshTy,
      zLift,
      scaleXY,
      scaleXY,
      scaleZ,
      r,
      g,
      b,
      1.0,
      0,
      0,
      activeColor === 0 ? 6 : matStyle
    );

    if (isStoneRuin) {
      if (useClip) {
        gl.uniform1i(rctx.uUseClipPlane, 0);
        gl.enable(gl.CULL_FACE);
      }
      continue;
    }

    // 3B. Nested Inner Core Shell (`meshInnerCore`) if multi-layered (`layersLeft > 1`)
    if (layersLeft > 1) {
      const innerColor = block.colorStack[block.colorCursor + 1] ?? activeColor;
      const [ir, ig, ib] = rctx.getColorRgb(innerColor, highContrast);
      rctx.drawMesh(
        gl,
        meshPair.meshInnerCore,
        useClip ? drawX : meshTx,
        useClip ? drawY : meshTy,
        zLift,
        scaleXY,
        scaleXY,
        scaleZ,
        Math.min(1, ir * colorMul),
        Math.min(1, ig * colorMul),
        Math.min(1, ib * colorMul),
        1.0,
        0,
        0,
        matStyle
      );
    }

    const zCbSymbol = zLift + 0.692 * scaleZ;
    const zMedallionBase = zLift + 0.562 * scaleZ;
    const zStrapCenter = zLift + 0.588 * scaleZ;

    // 3C. 3D Colored Rope Straps (`block.ropeColor > 0` — sculpted 3D wrapping straps)
    if (block.ropeColor > 0) {
      const [rawRr, rawRg, rawRb] = rctx.getColorRgb(block.ropeColor, highContrast);
      const rr = rawRr * roomLum;
      const rg = rawRg * roomLum;
      const rb = rawRb * roomLum;
      const anchorCell = shape.cells[shape.anchorCellIndex] ?? shape.cells[0];
      const rCx = drawX + anchorCell[1] + 0.5;
      const rCy = drawY + anchorCell[0] + 0.5;
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        rCx,
        rCy,
        zStrapCenter,
        0.94,
        0.24,
        0.068 * scaleZ,
        rr,
        rg,
        rb,
        1.0,
        0,
        0,
        0
      );
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        rCx,
        rCy,
        zStrapCenter + 0.004,
        0.24,
        0.94,
        0.068 * scaleZ,
        rr * 0.92,
        rg * 0.92,
        rb * 0.92,
        1.0,
        0,
        0,
        0
      );
      if (colorblind) {
        rctx.drawAtlasBadge(
          gl,
          `CB_${block.ropeColor}`,
          drawX + anchorCell[1] + 0.79,
          rCy,
          zCbSymbol + 0.006,
          0.25,
          roomLum,
          roomLum,
          roomLum,
          1
        );
      }
    }

    // 3D. 3D Chained / Padlock Iron Straps (`block.chained`, sculpted 3D dark-bronze/iron bars)
    if (block.chained) {
      const anchorCell = shape.cells[shape.anchorCellIndex] ?? shape.cells[0];
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        drawX + shape.cols * 0.5,
        drawY + anchorCell[0] + 0.5,
        zStrapCenter,
        Math.max(0.92, shape.cols - 0.08),
        0.22,
        0.066 * scaleZ,
        0.28 * roomLum,
        0.32 * roomLum,
        0.4 * roomLum,
        1.0,
        0,
        0,
        0
      );
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        drawX + anchorCell[1] + 0.5,
        drawY + shape.rows * 0.5,
        zStrapCenter + 0.004,
        0.22,
        Math.max(0.92, shape.rows - 0.08),
        0.066 * scaleZ,
        0.32 * roomLum,
        0.36 * roomLum,
        0.44 * roomLum,
        1.0,
        0,
        0,
        0
      );
    }

    // 3E. Translucent Ice Casing (`block.iceCount > 0`, `R3D-11`)
    if (block.iceCount > 0) {
      gl.depthMask(false);
      rctx.drawMesh(
        gl,
        outerMesh,
        meshTx - shape.cols * 0.008,
        meshTy - shape.rows * 0.008,
        zLift + 0.01,
        scaleXY * 1.016,
        scaleXY * 1.016,
        scaleZ * 1.02,
        0.62 * roomLum,
        0.92 * roomLum,
        1.0 * roomLum,
        0.48,
        0,
        0,
        1
      );
      gl.depthMask(true);
    }

    renderBlockSurfaceOverlays3D(
      rctx,
      gl,
      block,
      shape,
      drawX,
      drawY,
      zLift,
      scaleZ,
      r,
      g,
      b,
      roomLum,
      activeColor,
      layersLeft,
      zCbSymbol,
      zMedallionBase,
      highContrast,
      colorblind,
      pulse,
      timeSec,
      live3DMix,
      reducedMotion,
      blockRoomVis.isLocked,
      bombHeartbeat
    );

    if (useClip) {
      gl.uniform1i(rctx.uUseClipPlane, 0);
      gl.enable(gl.CULL_FACE);
    }
  }

  if (!isStoneRuin) {
    renderGhostAndWeldClamps3D(
      rctx,
      gl,
      board,
      options,
      skinId,
      highContrast,
      timeSec,
      anyDragActive,
      reducedMotion
    );
  }
}
