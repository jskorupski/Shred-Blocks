import { getGateOutwardNormal } from '../core/gate-clearance';
import { getBlockRoomId, getMovedGroupBlocks, isBlockInSealedVault } from '../core/physics';
import { getActiveColor, getLayersRemaining, getShape } from '../core/polyomino';
import type { BoardState, ColorId, SkinId } from '../core/types';
import {
  type AnimatedBlockPose,
  blockLocalXToWorld,
  blockLocalYToWorld,
  blockLocalZToWorld,
  computeBlockSurfaceClearanceLocalZ,
  computeBoardAnimatedBlockPoses,
  getCellFloorTopZ,
} from './block-pose-and-clearance';
import { ENVIRONMENT_MESHES, getPolyominoMeshPair, POLYOMINO_MESH_CATALOG } from './mesh-generator';
import { renderBlockSurfaceOverlays3D } from './pass3-block-overlays';
import { drawToneOnToneSigil3D, type RenderPassContext, type RenderSceneOptions } from './render-types';
import { renderGateBursts3D } from './shred-style-fx';

const DRAGGED_GROUP_SCRATCH = new Set<number>();

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
  DRAGGED_GROUP_SCRATCH.clear();
  const draggedGroupIds = DRAGGED_GROUP_SCRATCH;
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
    if (rctx.setClipPlaneState) {
      rctx.setClipPlaneState(gl, true, planeNx, planeNy, 0, planeD, r * 0.72, g * 0.72, b * 0.72);
    } else {
      gl.uniform1i(rctx.uUseClipPlane, 1);
      gl.uniform4f(rctx.uClipPlane, planeNx, planeNy, 0, planeD);
      gl.uniform3f(rctx.uCapColor, r * 0.72, g * 0.72, b * 0.72);
    }

    const shredOuterMesh =
      anim.colorId === 0
        ? (POLYOMINO_MESH_CATALOG[anim.shapeId]?.meshOuterWorn ?? meshPair.meshOuter)
        : anim.isOuterPeelOnly && skinId === 'classic_studs'
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

    const shredSeed = (anim.gateIndex * 17 + anim.colorId * 7) % 97;
    if (rctx.setBlockSeed) {
      rctx.setBlockSeed(shredSeed);
    } else {
      gl.uniform1f(rctx.uBlockSeed, shredSeed);
    }
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

    if (rctx.setClipPlaneState) {
      rctx.setClipPlaneState(gl, false);
    } else {
      gl.uniform1i(rctx.uUseClipPlane, 0);
    }
    gl.enable(gl.CULL_FACE);
  }

  // Unified rigid per-block & glued-group animation poses (`Z-CLEARANCE-01`, `IDLE-01`, `IDLE-02`)
  const poses = computeBoardAnimatedBlockPoses(
    rctx,
    board,
    draggedGroupIds,
    anyDragActive,
    options,
    timeSec,
    dtMs
  );

  for (const block of board.blocks) {
    if (block.status === 'CLEARED') continue;
    if (isBlockInSealedVault(board, block)) continue;
    const pose = poses.get(block.id);
    if (!pose) continue;

    const shape = getShape(block.shapeId);
    const meshPair = getPolyominoMeshPair(block.shapeId, skinId);
    const activeColor: ColorId = getActiveColor(block.colorStack, block.colorCursor);
    const [rawR, rawG, rawB] = rctx.getColorRgb(activeColor, highContrast);
    const layersLeft = getLayersRemaining(block.colorStack, block.colorCursor);
    const layers = computeBlockSurfaceClearanceLocalZ(
      skinId,
      layersLeft,
      activeColor,
      block.chained || block.ropeColor > 0
    );

    const r = Math.min(1, rawR * pose.colorMul + (1 - pose.effectiveRoomLum) * 0.03);
    const g = Math.min(1, rawG * pose.colorMul + (1 - pose.effectiveRoomLum) * 0.04);
    const b = Math.min(1, rawB * pose.colorMul + (1 - pose.effectiveRoomLum) * 0.09);

    // Clip-plane shredding (`ENG-03`, `R3D-02`, `R3D-14`) when block is actively shredding through a gate
    let useClip = false;
    if (
      (block.status === 'SHREDDING' || block.shredProgress > 0) &&
      block.shredGateIndex >= 0 &&
      board.gates[block.shredGateIndex]
    ) {
      const gate = board.gates[block.shredGateIndex];
      const [nx, ny] = getGateOutwardNormal(gate.edge);
      const planeNx = -nx;
      const planeNy = -ny;
      let planeD = 0.21;
      if (gate.edge === 'TOP') planeD = 0.21 - gate.edgeLine;
      else if (gate.edge === 'BOTTOM') planeD = gate.edgeLine + 1 + 0.21;
      else if (gate.edge === 'LEFT') planeD = 0.21 - gate.edgeLine;
      else if (gate.edge === 'RIGHT') planeD = gate.edgeLine + 1 + 0.21;

      useClip = true;
      gl.disable(gl.CULL_FACE);
      if (rctx.setClipPlaneState) {
        rctx.setClipPlaneState(gl, true, planeNx, planeNy, 0, planeD, r * 0.72, g * 0.72, b * 0.72);
      } else {
        gl.uniform1i(rctx.uUseClipPlane, 1);
        gl.uniform4f(rctx.uClipPlane, planeNx, planeNy, 0, planeD);
        gl.uniform3f(rctx.uCapColor, r * 0.72, g * 0.72, b * 0.72);
      }
    } else if (rctx.setClipPlaneState) {
      rctx.setClipPlaneState(gl, false);
    } else {
      gl.uniform1i(rctx.uUseClipPlane, 0);
    }

    // Dynamic floor drop shadow when lifted or spotlight-hopping (`IDLE-02`)
    const shadowAlpha = Math.max(pose.liftAlpha, pose.blockHopEnv * 0.28);
    if (shadowAlpha > 0.02) {
      for (const [dr, dc] of shape.cells) {
        const floorZ = getCellFloorTopZ(board, rctx, block.row + dr, block.col + dc);
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.overlayQuad,
          pose.drawX + dc + 0.12 * shadowAlpha,
          pose.drawY + dr + 0.14 * shadowAlpha,
          floorZ + 0.008,
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
        if (pose.liftAlpha > 0.02) {
          rctx.drawMesh(
            gl,
            ENVIRONMENT_MESHES.overlayQuad,
            pose.meshTx + (dc - 0.05) * pose.scaleXY,
            pose.meshTy + (dr - 0.05) * pose.scaleXY,
            Math.max(floorZ + 0.02, pose.zLift - 0.015),
            1.1 * pose.scaleXY,
            1.1 * pose.scaleXY,
            1.0,
            Math.min(1, rawR * 0.65 + 0.35),
            Math.min(1, rawG * 0.65 + 0.35),
            Math.min(1, rawB * 0.65 + 0.35),
            (0.42 + 0.22 * pulse) * pose.liftAlpha,
            0,
            0,
            4
          );
        }
      }
    }

    // 3A. Outer Morphological Shell (`meshOuter`; un-studded collar when `layersLeft > 1` in gameplay, pure solid block in Stone Ruin mode)
    const outerMesh =
      activeColor === 0
        ? (POLYOMINO_MESH_CATALOG[block.shapeId]?.meshOuterWorn ?? meshPair.meshOuter)
        : !isStoneRuin && layersLeft > 1 && skinId === 'classic_studs'
          ? (POLYOMINO_MESH_CATALOG[block.shapeId]?.meshOuter ?? meshPair.meshOuter)
          : meshPair.meshOuter;

    if (rctx.setBlockSeed) {
      rctx.setBlockSeed(block.id % 97);
    } else {
      gl.uniform1f(rctx.uBlockSeed, block.id % 97);
    }
    rctx.drawMesh(
      gl,
      outerMesh,
      pose.meshTx,
      pose.meshTy,
      pose.zLift,
      pose.scaleXY,
      pose.scaleXY,
      pose.scaleZ,
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
        if (rctx.setClipPlaneState) {
          rctx.setClipPlaneState(gl, false);
        } else {
          gl.uniform1i(rctx.uUseClipPlane, 0);
        }
        gl.enable(gl.CULL_FACE);
      }
      continue;
    }

    // 3B. Nested Inner Core Shell (`meshInnerCore`) if multi-layered (`layersLeft > 1`)
    if (layersLeft > 1) {
      const innerColor = block.colorStack[block.colorCursor + 1] ?? activeColor;
      const [ir, ig, ib] = rctx.getColorRgb(innerColor, highContrast);
      if (rctx.setBlockSeed) {
        rctx.setBlockSeed((block.id + 37) % 97);
      } else {
        gl.uniform1f(rctx.uBlockSeed, (block.id + 37) % 97);
      }
      rctx.drawMesh(
        gl,
        meshPair.meshInnerCore,
        pose.meshTx,
        pose.meshTy,
        pose.zLift,
        pose.scaleXY,
        pose.scaleXY,
        pose.scaleZ,
        Math.min(1, ir * pose.colorMul),
        Math.min(1, ig * pose.colorMul),
        Math.min(1, ib * pose.colorMul),
        1.0,
        0,
        0,
        matStyle
      );
    }

    const roomLum = pose.roomLum;

    // 3C. 3D Colored Rope Straps (`block.ropeColor > 0` — sculpted 3D wrapping straps)
    if (block.ropeColor > 0) {
      const [rawRr, rawRg, rawRb] = rctx.getColorRgb(block.ropeColor, highContrast);
      const rr = rawRr * roomLum;
      const rg = rawRg * roomLum;
      const rb = rawRb * roomLum;
      const anchorCell = shape.cells[shape.anchorCellIndex] ?? shape.cells[0];
      const rCx = blockLocalXToWorld(pose, anchorCell[1] + 0.5);
      const rCy = blockLocalYToWorld(pose, anchorCell[0] + 0.5);
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        rCx,
        rCy,
        blockLocalZToWorld(pose, layers.strapHorizCenter),
        0.94 * pose.scaleXY,
        0.24 * pose.scaleXY,
        layers.strapHorizSizeZ * pose.scaleZ,
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
        blockLocalZToWorld(pose, layers.strapVertCenter),
        0.24 * pose.scaleXY,
        0.94 * pose.scaleXY,
        layers.strapVertSizeZ * pose.scaleZ,
        rr * 0.92,
        rg * 0.92,
        rb * 0.92,
        1.0,
        0,
        0,
        0
      );
      if (colorblind) {
        const anchorBusy =
          block.iceCount > 0 ||
          block.chained ||
          (block.bombMax > 0 && block.bombCount > 0) ||
          block.hasKey > 0 ||
          block.scissorColor > 0 ||
          block.shutterGemColor > 0 ||
          block.isStar;
        const knotLocalX = anchorCell[1] + (anchorBusy ? 0.8 : 0.5);
        const knotLocalY = anchorCell[0] + 0.5;
        const knotSize = (anchorBusy ? 0.34 : 0.44) * pose.scaleXY;
        const knotCenterZ = anchorBusy ? layers.busyCornerCapPadCenter : layers.ropeKnotCenter;
        const knotSizeZ = anchorBusy ? layers.busyCornerCapPadSizeZ : layers.ropeKnotSizeZ;
        const knotSigilZ = anchorBusy ? layers.busyCornerSigil : layers.ropeKnotSigil;
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          blockLocalXToWorld(pose, knotLocalX),
          blockLocalYToWorld(pose, knotLocalY),
          blockLocalZToWorld(pose, knotCenterZ),
          knotSize,
          knotSize,
          knotSizeZ * pose.scaleZ,
          rr,
          rg,
          rb,
          1.0,
          0,
          0,
          0
        );
        drawToneOnToneSigil3D(
          rctx,
          gl,
          block.ropeColor,
          blockLocalXToWorld(pose, knotLocalX),
          blockLocalYToWorld(pose, knotLocalY),
          blockLocalZToWorld(pose, knotSigilZ),
          (anchorBusy ? 0.28 : 0.36) * pose.scaleXY,
          roomLum,
          highContrast,
          false
        );
      }
    }

    // 3D. 3D Chained / Padlock Iron Straps (`block.chained`, sculpted 3D dark-bronze/iron bars)
    if (block.chained) {
      const anchorCell = shape.cells[shape.anchorCellIndex] ?? shape.cells[0];
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        blockLocalXToWorld(pose, shape.cols * 0.5),
        blockLocalYToWorld(pose, anchorCell[0] + 0.5),
        blockLocalZToWorld(pose, layers.strapHorizCenter),
        Math.max(0.92, shape.cols - 0.08) * pose.scaleXY,
        0.22 * pose.scaleXY,
        layers.strapHorizSizeZ * pose.scaleZ,
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
        blockLocalXToWorld(pose, anchorCell[1] + 0.5),
        blockLocalYToWorld(pose, shape.rows * 0.5),
        blockLocalZToWorld(pose, layers.strapVertCenter),
        0.22 * pose.scaleXY,
        Math.max(0.92, shape.rows - 0.08) * pose.scaleXY,
        layers.strapVertSizeZ * pose.scaleZ,
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
      const iceZLift = pose.zLift + (layersLeft > 1 ? 0.018 : 0.01) * pose.scaleZ;
      const iceScaleZ = pose.scaleZ * (layersLeft > 1 ? 1.028 : 1.02);
      gl.depthMask(false);
      rctx.drawMesh(
        gl,
        outerMesh,
        pose.meshTx - shape.cols * 0.008 * pose.scaleXY,
        pose.meshTy - shape.rows * 0.008 * pose.scaleXY,
        iceZLift,
        pose.scaleXY * 1.016,
        pose.scaleXY * 1.016,
        iceScaleZ,
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
      pose,
      layers,
      r,
      g,
      b,
      activeColor,
      layersLeft,
      highContrast,
      colorblind,
      pulse,
      timeSec,
      live3DMix,
      reducedMotion
    );

    if (useClip) {
      if (rctx.setClipPlaneState) {
        rctx.setClipPlaneState(gl, false);
      } else {
        gl.uniform1i(rctx.uUseClipPlane, 0);
      }
      gl.enable(gl.CULL_FACE);
    }
  }
  if (rctx.setBlockSeed) {
    rctx.setBlockSeed(0);
  } else {
    gl.uniform1f(rctx.uBlockSeed, 0);
  }

  if (!isStoneRuin) {
    renderGhostAndWeldClamps3D(
      rctx,
      gl,
      board,
      poses,
      options,
      skinId,
      highContrast,
      timeSec,
      anyDragActive,
      reducedMotion
    );
    renderGateBursts3D(rctx, gl);
  }
}

export function renderGhostAndWeldClamps3D(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  board: BoardState,
  poses: ReadonlyMap<number, AnimatedBlockPose>,
  options: RenderSceneOptions,
  skinId: SkinId,
  highContrast: boolean,
  timeSec: number,
  anyDragActive: boolean,
  reducedMotion: boolean
): void {
  // 3F.2 Early-Stage & Hint 3D Sliding Ghost Polyomino (`UX-10`)
  const guideMove = board.hintMove ?? (!anyDragActive ? options.autoGuideMove : null) ?? null;
  if (guideMove && !anyDragActive && !reducedMotion) {
    const ghostBlock = board.blocks.find((b) => b.id === guideMove.blockId && b.status === 'ACTIVE');
    if (ghostBlock) {
      const meshPair = getPolyominoMeshPair(ghostBlock.shapeId, skinId);
      const activeColor: ColorId = getActiveColor(ghostBlock.colorStack, ghostBlock.colorCursor);
      const [gr, gg, gb] = rctx.getColorRgb(activeColor, highContrast);
      const ghostRoomVis = rctx.getRoomVisualState(board, getBlockRoomId(board, ghostBlock));
      const rawPhase = (timeSec * 0.72) % 1.0;
      const moveT = rawPhase < 0.78 ? (1.0 - Math.cos((rawPhase / 0.78) * Math.PI)) * 0.5 : 1.0;
      const ghostAlpha = Math.sin(rawPhase * Math.PI) * 0.38;
      if (ghostAlpha > 0.03 && moveT > 0.06) {
        const gx = ghostBlock.col + (guideMove.targetCol - ghostBlock.col) * moveT;
        const gy = ghostBlock.row + (guideMove.targetRow - ghostBlock.row) * moveT;
        gl.depthMask(false);
        rctx.drawMesh(
          gl,
          meshPair.meshOuter,
          gx,
          gy,
          ghostRoomVis.zOffset + 0.09,
          1.0,
          1.0,
          1.0,
          Math.min(1, gr * 0.7 + 0.3),
          Math.min(1, gg * 0.7 + 0.28),
          Math.min(1, gb * 0.7 + 0.15),
          ghostAlpha,
          0,
          0,
          1
        );
        gl.depthMask(true);
      }
    }
  }

  // 3G. 3D Metallic Weld Clamps bridging adjacent blocks that share `groupId > 0`
  for (let i = 0; i < board.blocks.length; i++) {
    const a = board.blocks[i];
    if (a.status !== 'ACTIVE' || a.groupId <= 0 || isBlockInSealedVault(board, a)) continue;
    const poseA = poses.get(a.id);
    if (!poseA) continue;
    const shapeA = getShape(a.shapeId);

    for (let j = i + 1; j < board.blocks.length; j++) {
      const b = board.blocks[j];
      if (b.status !== 'ACTIVE' || b.groupId !== a.groupId) continue;
      const poseB = poses.get(b.id);
      if (!poseB) continue;
      const shapeB = getShape(b.shapeId);

      let clamped = false;
      for (const [ar, ac] of shapeA.cells) {
        if (clamped) break;
        for (const [br, bc] of shapeB.cells) {
          if (Math.abs(a.x + ac - (b.x + bc)) + Math.abs(a.y + ar - (b.y + br)) < 1.05) {
            const ax = blockLocalXToWorld(poseA, ac + 0.5);
            const ay = blockLocalYToWorld(poseA, ar + 0.5);
            const bx = blockLocalXToWorld(poseB, bc + 0.5);
            const by = blockLocalYToWorld(poseB, br + 0.5);
            const mx = (ax + bx) * 0.5;
            const my = (ay + by) * 0.5;
            const mz = Math.max(poseA.zLift, poseB.zLift);
            const sxy = Math.max(poseA.scaleXY, poseB.scaleXY);
            const sz = Math.max(poseA.scaleZ, poseB.scaleZ);
            const lum = Math.max(poseA.roomLum, poseB.roomLum);
            rctx.drawMesh(
              gl,
              ENVIRONMENT_MESHES.weldClampMesh,
              mx,
              my,
              mz,
              sxy,
              sxy,
              sz,
              0.78 * lum,
              0.84 * lum,
              0.92 * lum,
              1.0
            );
            clamped = true;
            break;
          }
        }
      }
    }
  }
}
