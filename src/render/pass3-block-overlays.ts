import {
  getBlockRoomId,
} from "../core/physics";
import {
  getActiveColor,
  getShape,
  type PolyominoShape,
} from "../core/polyomino";
import {
  type BlockState,
  type BoardState,
  type ColorId,
  type SkinId,
} from "../core/types";
import { BLOCK_LIFT_DELTA_Z } from "./camera-3d";
import {
  ENVIRONMENT_MESHES,
  getPolyominoMeshPair,
} from "./mesh-generator";
import type { RenderPassContext, RenderSceneOptions } from "./render-types";

export function renderBlockSurfaceOverlays3D(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  block: BlockState,
  shape: PolyominoShape,
  drawX: number,
  drawY: number,
  zLift: number,
  scaleZ: number,
  r: number,
  g: number,
  b: number,
  roomLum: number,
  activeColor: ColorId,
  layersLeft: number,
  zCbSymbol: number,
  zMedallionBase: number,
  highContrast: boolean,
  colorblind: boolean,
  pulse: number,
  timeSec: number,
  live3DMix: number,
  reducedMotion: boolean,
  isLockedRoom: boolean,
  bombHeartbeat: number
): void {
  // 3F. 3-Zone Sculpted Architectural Surface Overlays (`UX-10`, `AX-01`, `R3D-07`)
  const anchor = shape.cells[shape.anchorCellIndex] ?? shape.cells[0];
  const anchorCx = drawX + anchor[1] + 0.5;
  const anchorCy = drawY + anchor[0] + 0.5;
  const hasImmobilizer = block.iceCount > 0 || block.chained;
  const hasPayload =
    (block.bombMax > 0 && block.bombCount > 0) ||
    block.hasKey > 0 ||
    block.scissorColor > 0 ||
    block.shutterGemColor > 0 ||
    block.isStar;
  let lockBadgeCx = -999;
  let lockBadgeCy = -999;

  // Zone A: Integrated 3D Axis-Lock Side-Flange Rails + Sculpted Tone-on-Tone Medallion (`UX-10`, `R3D-07`)
  // Circular studs occupy [0.34, 0.66]; placing 3D side rails at 0.13 and 0.87 leaves the 3D studs 100% uncovered!
  if (block.axisLock === 'H') {
    const rowCells = shape.cells.filter((c) => c[0] === anchor[0]);
    let minCol = anchor[1];
    let maxCol = anchor[1];
    for (const rc of rowCells) {
      if (rc[1] < minCol) minCol = rc[1];
      if (rc[1] > maxCol) maxCol = rc[1];
    }
    const spanW = maxCol - minCol + 1;
    const railCenterX = drawX + minCol + spanW * 0.5;
    const railLen = spanW - 0.12;
    const zRail = zLift + 0.592 * scaleZ;
    const flangeR = Math.min(1, r * 0.42 + 0.58);
    const flangeG = Math.min(1, g * 0.42 + 0.55);
    const flangeB = Math.min(1, b * 0.42 + 0.48);

    // Parallel 3D beveled architectural side-flange rails along the locked top & bottom edges
    rctx.drawMesh(
      gl,
      ENVIRONMENT_MESHES.unitParticleCube,
      railCenterX,
      drawY + anchor[0] + 0.13,
      zRail,
      railLen,
      0.092,
      0.058 * scaleZ,
      flangeR,
      flangeG,
      flangeB,
      1.0,
      0,
      0,
      0
    );
    rctx.drawMesh(
      gl,
      ENVIRONMENT_MESHES.unitParticleCube,
      railCenterX,
      drawY + anchor[0] + 0.87,
      zRail,
      railLen,
      0.092,
      0.058 * scaleZ,
      flangeR,
      flangeG,
      flangeB,
      1.0,
      0,
      0,
      0
    );

    // Sculpted 3D tone-on-tone medallion + pill-free architectural double-chevron (`LOCK_H`)
    let arrowCx = railCenterX;
    let arrowCy = anchorCy;
    let medW = spanW >= 2 ? 0.58 : 0.48;
    let medH = 0.36;
    let iconSize = spanW >= 2 ? 0.5 : 0.42;

    if (hasImmobilizer || hasPayload) {
      const freeCell =
        rowCells.find((c) => c[1] !== anchor[1]) ??
        shape.cells.find((c) => c[0] !== anchor[0] || c[1] !== anchor[1]);
      if (freeCell) {
        arrowCx = drawX + freeCell[1] + 0.5;
        arrowCy = drawY + freeCell[0] + 0.5;
        medW = 0.5;
        medH = 0.36;
        iconSize = 0.44;
      } else {
        arrowCx = anchorCx;
        arrowCy = drawY + anchor[0] + 0.8;
        medW = 0.42;
        medH = 0.28;
        iconSize = 0.34;
      }
    }
    lockBadgeCx = arrowCx;
    lockBadgeCy = arrowCy;

    const lockBadgeZ = rctx.drawBadgeMedallion3D(
      gl,
      arrowCx,
      arrowCy,
      zMedallionBase,
      medW,
      medH,
      r,
      g,
      b
    );
    rctx.drawAtlasBadge(
      gl,
      'LOCK_H',
      arrowCx,
      arrowCy,
      lockBadgeZ,
      iconSize,
      1.0,
      0.99,
      0.94,
      1.0
    );
  } else if (block.axisLock === 'V') {
    const colCells = shape.cells.filter((c) => c[1] === anchor[1]);
    let minRow = anchor[0];
    let maxRow = anchor[0];
    for (const cc of colCells) {
      if (cc[0] < minRow) minRow = cc[0];
      if (cc[0] > maxRow) maxRow = cc[0];
    }
    const spanH = maxRow - minRow + 1;
    const railCenterY = drawY + minRow + spanH * 0.5;
    const railLen = spanH - 0.12;
    const zRail = zLift + 0.592 * scaleZ;
    const flangeR = Math.min(1, r * 0.42 + 0.58);
    const flangeG = Math.min(1, g * 0.42 + 0.55);
    const flangeB = Math.min(1, b * 0.42 + 0.48);

    // Parallel 3D beveled architectural side-flange rails along the locked left & right edges
    rctx.drawMesh(
      gl,
      ENVIRONMENT_MESHES.unitParticleCube,
      drawX + anchor[1] + 0.13,
      railCenterY,
      zRail,
      0.092,
      railLen,
      0.058 * scaleZ,
      flangeR,
      flangeG,
      flangeB,
      1.0,
      0,
      0,
      0
    );
    rctx.drawMesh(
      gl,
      ENVIRONMENT_MESHES.unitParticleCube,
      drawX + anchor[1] + 0.87,
      railCenterY,
      zRail,
      0.092,
      railLen,
      0.058 * scaleZ,
      flangeR,
      flangeG,
      flangeB,
      1.0,
      0,
      0,
      0
    );

    // Sculpted 3D tone-on-tone medallion + pill-free architectural double-chevron (`LOCK_V`)
    let arrowCx = anchorCx;
    let arrowCy = railCenterY;
    let medW = 0.36;
    let medH = spanH >= 2 ? 0.58 : 0.48;
    let iconSize = spanH >= 2 ? 0.5 : 0.42;

    if (hasImmobilizer || hasPayload) {
      const freeCell =
        colCells.find((c) => c[0] !== anchor[0]) ??
        shape.cells.find((c) => c[0] !== anchor[0] || c[1] !== anchor[1]);
      if (freeCell) {
        arrowCx = drawX + freeCell[1] + 0.5;
        arrowCy = drawY + freeCell[0] + 0.5;
        medW = 0.36;
        medH = 0.5;
        iconSize = 0.44;
      } else {
        arrowCx = drawX + anchor[1] + 0.8;
        arrowCy = anchorCy;
        medW = 0.28;
        medH = 0.42;
        iconSize = 0.34;
      }
    }
    lockBadgeCx = arrowCx;
    lockBadgeCy = arrowCy;

    const lockBadgeZ = rctx.drawBadgeMedallion3D(
      gl,
      arrowCx,
      arrowCy,
      zMedallionBase,
      medW,
      medH,
      r,
      g,
      b
    );
    rctx.drawAtlasBadge(
      gl,
      'LOCK_V',
      arrowCx,
      arrowCy,
      lockBadgeZ,
      iconSize,
      1.0,
      0.99,
      0.94,
      1.0
    );
  }

  // Zone B: Decoupled Immobilizer Badge vs Payload / Modifier Badge (`R3D-03`, `UX-10`)
  let immCx = anchorCx;
  let immCy = anchorCy;
  let immScale = layersLeft > 1 && shape.cells.length === 1 ? 0.86 : 1.0;
  let payCx = anchorCx;
  let payCy = anchorCy;
  let payScale = layersLeft > 1 && shape.cells.length === 1 ? 0.86 : 1.0;

  if (hasImmobilizer && hasPayload) {
    if (shape.cells.length >= 2) {
      const secCell = shape.cells[(shape.anchorCellIndex + 1) % shape.cells.length];
      payCx = drawX + secCell[1] + 0.5;
      payCy = drawY + secCell[0] + 0.5;
    } else {
      immCx = anchorCx - 0.16;
      immCy = anchorCy - 0.14;
      immScale = 0.76;
      payCx = anchorCx + 0.16;
      payCy = anchorCy + 0.14;
      payScale = 0.76;
    }
  }

  const isCellCenterBusy = (cellR: number, cellC: number, ci: number): boolean => {
    const cellCx = drawX + cellC + 0.5;
    const cellCy = drawY + cellR + 0.5;
    return (
      (hasImmobilizer && Math.hypot(cellCx - immCx, cellCy - immCy) < 0.36) ||
      (hasPayload && Math.hypot(cellCx - payCx, cellCy - payCy) < 0.36) ||
      (block.axisLock !== 'NONE' &&
        Math.hypot(cellCx - lockBadgeCx, cellCy - lockBadgeCy) < 0.38) ||
      (block.ropeColor > 0 && ci === shape.anchorCellIndex) ||
      (block.chained && (cellR === anchor[0] || cellC === anchor[1]))
    );
  };

  // Neutral `color: 0` Stone Sliders: 3D carved architectural masonry inlay when `colorblind === false`
  if (activeColor === 0 && !colorblind) {
    for (let ci = 0; ci < shape.cells.length; ci++) {
      const cell = shape.cells[ci];
      if (isCellCenterBusy(cell[0], cell[1], ci)) continue;
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        drawX + cell[1] + 0.5,
        drawY + cell[0] + 0.5,
        zLift + 0.602 * scaleZ,
        0.44,
        0.44,
        0.046 * scaleZ,
        Math.min(1, r * 0.78 + 0.18),
        Math.min(1, g * 0.78 + 0.18),
        Math.min(1, b * 0.78 + 0.18),
        1.0,
        0,
        Math.PI * 0.25,
        0
      );
    }
  }

  // AX-01 Colorblind Symbols embossed above all studs/medallions (`zCbSymbol = zLift + 0.692 * scaleZ`)
  if (colorblind) {
    for (let ci = 0; ci < shape.cells.length; ci++) {
      const cell = shape.cells[ci];
      const isBusyCell = layersLeft > 1 || isCellCenterBusy(cell[0], cell[1], ci);
      const symX = drawX + cell[1] + (isBusyCell ? 0.21 : 0.5);
      const symY = drawY + cell[0] + (isBusyCell ? 0.21 : 0.5);
      const symSize = isBusyCell ? 0.25 : 0.35;
      rctx.drawAtlasBadge(
        gl,
        `CB_${activeColor}`,
        symX,
        symY,
        zCbSymbol,
        symSize,
        roomLum,
        roomLum,
        roomLum,
        0.98
      );
    }
    const firstCell = shape.cells[0];
    if (layersLeft > 1) {
      const innerColor = block.colorStack[block.colorCursor + 1] ?? activeColor;
      const firstBusy = isCellCenterBusy(firstCell[0], firstCell[1], 0);
      rctx.drawAtlasBadge(
        gl,
        `CB_${innerColor}`,
        drawX + firstCell[1] + (firstBusy ? 0.79 : 0.5),
        drawY + firstCell[0] + (firstBusy ? 0.79 : 0.5),
        zCbSymbol + 0.004,
        firstBusy ? 0.24 : 0.31,
        roomLum,
        roomLum,
        roomLum,
        0.98
      );
    }
  }

  // 1) Immobilizer Badge (`iceCount > 0` or `chained`) via Sculpted 3D Medallion
  if (block.iceCount > 0) {
    const iceBadgeZ = rctx.drawBadgeMedallion3D(
      gl,
      immCx,
      immCy,
      zMedallionBase,
      0.66 * immScale,
      0.44 * immScale,
      0.38 * roomLum,
      0.74 * roomLum,
      0.96 * roomLum
    );
    rctx.drawAtlasBadge(
      gl,
      'BADGE_ICE',
      immCx - 0.14 * immScale,
      immCy,
      iceBadgeZ,
      0.35 * immScale,
      0.88 * roomLum,
      0.98 * roomLum,
      1.0 * roomLum,
      1.0
    );
    rctx.drawNumberBadges(
      gl,
      block.iceCount,
      immCx + 0.15 * immScale,
      immCy,
      iceBadgeZ + 0.002,
      0.35 * immScale,
      roomLum,
      roomLum,
      roomLum
    );
  } else if (block.chained) {
    const lockBadgeZ = rctx.drawBadgeMedallion3D(
      gl,
      immCx,
      immCy,
      zMedallionBase,
      0.52 * immScale,
      0.52 * immScale,
      0.36 * roomLum,
      0.4 * roomLum,
      0.48 * roomLum
    );
    rctx.drawAtlasBadge(
      gl,
      'BADGE_LOCK',
      immCx,
      immCy,
      lockBadgeZ,
      0.48 * immScale,
      1.0 * roomLum,
      0.9 * roomLum,
      0.42 * roomLum,
      1.0
    );
  }

  // 2) Payload / Modifier Badge (`bomb`, `hasKey`, `scissorColor`, `shutterGemColor`, `isStar`) via Sculpted 3D Medallion (`IDLE-05`)
  const payBobZ =
    !reducedMotion && !isLockedRoom
      ? Math.sin(timeSec * 2.2 + block.id * 0.9) * 0.011 * live3DMix
      : 0;
  const payPulseScale =
    !reducedMotion && !isLockedRoom
      ? payScale * (1.0 + Math.sin(timeSec * 2.2 + block.id * 0.9) * 0.028 * live3DMix)
      : payScale;

  if (block.bombMax > 0 && block.bombCount > 0) {
    const urgent = block.bombCount <= 3 && !isLockedRoom ? 0.65 + 0.35 * pulse : 1.0;
    const bombMedScale =
      !reducedMotion && !isLockedRoom
        ? payScale * (1.0 + bombHeartbeat * 1.2 * live3DMix)
        : payScale;
    const twoDigit = block.bombCount >= 10;
    const bombBadgeZ = rctx.drawBadgeMedallion3D(
      gl,
      payCx,
      payCy,
      zMedallionBase + payBobZ * 0.6,
      0.74 * bombMedScale,
      0.46 * bombMedScale,
      r,
      g,
      b
    );
    rctx.drawAtlasBadge(
      gl,
      'BADGE_BOMB',
      payCx - (twoDigit ? 0.2 : 0.15) * bombMedScale,
      payCy,
      bombBadgeZ,
      (twoDigit ? 0.32 : 0.35) * bombMedScale,
      1.0 * roomLum,
      0.86 * urgent * roomLum,
      0.3 * urgent * roomLum,
      1.0
    );
    rctx.drawNumberBadges(
      gl,
      block.bombCount,
      payCx + (twoDigit ? 0.16 : 0.15) * bombMedScale,
      payCy,
      bombBadgeZ + 0.002,
      (twoDigit ? 0.3 : 0.35) * bombMedScale,
      1.0 * roomLum,
      0.97 * roomLum,
      0.48 * roomLum
    );
  } else if (block.hasKey > 0) {
    const keyBadgeZ = rctx.drawBadgeMedallion3D(
      gl,
      payCx,
      payCy,
      zMedallionBase + payBobZ,
      0.52 * payPulseScale,
      0.52 * payPulseScale,
      r,
      g,
      b
    );
    rctx.drawAtlasBadge(
      gl,
      'BADGE_KEY',
      payCx,
      payCy,
      keyBadgeZ,
      0.48 * payPulseScale,
      1.0 * roomLum,
      0.9 * roomLum,
      0.32 * roomLum,
      1.0
    );
  } else if (block.scissorColor > 0) {
    const [sr, sg, sb] = rctx.getColorRgb(block.scissorColor, highContrast);
    const scisBadgeZ = rctx.drawBadgeMedallion3D(
      gl,
      payCx,
      payCy,
      zMedallionBase + payBobZ,
      0.52 * payPulseScale,
      0.52 * payPulseScale,
      r,
      g,
      b
    );
    rctx.drawAtlasBadge(
      gl,
      'BADGE_SCISSORS',
      payCx,
      payCy,
      scisBadgeZ,
      0.48 * payPulseScale,
      sr * roomLum,
      sg * roomLum,
      sb * roomLum,
      1.0
    );
    if (colorblind) {
      rctx.drawAtlasBadge(
        gl,
        `CB_${block.scissorColor}`,
        payCx + 0.2 * payPulseScale,
        payCy + 0.18 * payPulseScale,
        scisBadgeZ + 0.003,
        0.22 * payPulseScale,
        roomLum,
        roomLum,
        roomLum,
        1
      );
    }
  } else if (block.shutterGemColor > 0) {
    const [gr, gg, gb] = rctx.getColorRgb(block.shutterGemColor, highContrast);
    const gemBadgeZ = rctx.drawBadgeMedallion3D(
      gl,
      payCx,
      payCy,
      zMedallionBase + payBobZ,
      0.52 * payPulseScale,
      0.52 * payPulseScale,
      r,
      g,
      b
    );
    rctx.drawAtlasBadge(
      gl,
      'BADGE_GEM',
      payCx,
      payCy,
      gemBadgeZ,
      0.48 * payPulseScale,
      gr * roomLum,
      gg * roomLum,
      gb * roomLum,
      1.0
    );
    if (colorblind) {
      rctx.drawAtlasBadge(
        gl,
        `CB_${block.shutterGemColor}`,
        payCx + 0.2 * payPulseScale,
        payCy + 0.18 * payPulseScale,
        gemBadgeZ + 0.003,
        0.22 * payPulseScale,
        roomLum,
        roomLum,
        roomLum,
        1
      );
    }
  } else if (block.isStar) {
    const starBadgeZ = rctx.drawBadgeMedallion3D(
      gl,
      payCx,
      payCy,
      zMedallionBase + payBobZ,
      0.5 * payPulseScale,
      0.5 * payPulseScale,
      r,
      g,
      b
    );
    rctx.drawAtlasBadge(
      gl,
      'BADGE_STAR',
      payCx,
      payCy,
      starBadgeZ,
      0.46 * payPulseScale,
      1.0 * roomLum,
      0.92 * roomLum,
      0.32 * roomLum,
      1.0
    );
  }
}

export function renderGhostAndWeldClamps3D(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  board: BoardState,
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
    const ghostBlock = board.blocks.find(
      (b) => b.id === guideMove.blockId && b.status === 'ACTIVE'
    );
    if (ghostBlock) {
      const meshPair = getPolyominoMeshPair(ghostBlock.shapeId, skinId);
      const activeColor: ColorId = getActiveColor(ghostBlock.colorStack, ghostBlock.colorCursor);
      const [gr, gg, gb] = rctx.getColorRgb(activeColor, highContrast);
      const rawPhase = (timeSec * 0.72) % 1.0;
      const moveT =
        rawPhase < 0.78 ? (1.0 - Math.cos((rawPhase / 0.78) * Math.PI)) * 0.5 : 1.0;
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
          0.09,
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
    if (a.status !== 'ACTIVE' || a.groupId <= 0) continue;
    const shapeA = getShape(a.shapeId);

    for (let j = i + 1; j < board.blocks.length; j++) {
      const b = board.blocks[j];
      if (b.status !== 'ACTIVE' || b.groupId !== a.groupId) continue;
      const shapeB = getShape(b.shapeId);

      let clamped = false;
      for (const [ar, ac] of shapeA.cells) {
        if (clamped) break;
        const ax = a.x + ac;
        const ay = a.y + ar;
        for (const [br, bc] of shapeB.cells) {
          const bx = b.x + bc;
          const by = b.y + br;
          if (Math.abs(ax - bx) + Math.abs(ay - by) < 1.05) {
            const mx = (ax + bx) * 0.5 + 0.5;
            const my = (ay + by) * 0.5 + 0.5;
            const clampRoomVis = rctx.getRoomVisualState(board, getBlockRoomId(board, a));
            const mz =
              clampRoomVis.zOffset + Math.max(a.liftAlpha, b.liftAlpha) * BLOCK_LIFT_DELTA_Z;
            rctx.drawMesh(
              gl,
              ENVIRONMENT_MESHES.weldClampMesh,
              mx,
              my,
              mz,
              1.0,
              1.0,
              1.0,
              0.78 * clampRoomVis.luminanceMul,
              0.84 * clampRoomVis.luminanceMul,
              0.92 * clampRoomVis.luminanceMul,
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
