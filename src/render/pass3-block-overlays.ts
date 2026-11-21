import type { PolyominoShape } from '../core/polyomino';
import type { BlockState, ColorId } from '../core/types';
import {
  type AnimatedBlockPose,
  type BlockSurfaceClearanceLocalZ,
  blockLocalXToWorld,
  blockLocalYToWorld,
  blockLocalZToWorld,
} from './block-pose-and-clearance';
import { ENVIRONMENT_MESHES } from './mesh-generator';
import { drawToneOnToneSigil3D, getToneOnToneGlyphRgb, type RenderPassContext } from './render-types';

export function renderBlockSurfaceOverlays3D(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  block: BlockState,
  shape: PolyominoShape,
  pose: AnimatedBlockPose,
  layers: BlockSurfaceClearanceLocalZ,
  r: number,
  g: number,
  b: number,
  activeColor: ColorId,
  layersLeft: number,
  highContrast: boolean,
  colorblind: boolean,
  pulse: number,
  timeSec: number,
  live3DMix: number,
  reducedMotion: boolean
): void {
  // 3F. 3-Zone Sculpted Architectural Surface Overlays (`UX-10`, `AX-01`, `R3D-07`, `Z-CLEARANCE-01`)
  const roomLum = pose.roomLum;
  const sxy = pose.scaleXY;
  const sz = pose.scaleZ;
  const anchor = shape.cells[shape.anchorCellIndex] ?? shape.cells[0];
  const anchorLocalX = anchor[1] + 0.5;
  const anchorLocalY = anchor[0] + 0.5;
  const hasImmobilizer = block.iceCount > 0 || block.chained;
  const hasPayload =
    (block.bombMax > 0 && block.bombCount > 0) ||
    block.hasKey > 0 ||
    block.scissorColor > 0 ||
    block.shutterGemColor > 0 ||
    block.isStar;
  let lockBadgeLocalX = -999;
  let lockBadgeLocalY = -999;

  // Zone A: Integrated 3D Axis-Lock Side-Flange Rails + Sculpted Tone-on-Tone Medallion (`UX-10`, `R3D-07`)
  // Circular studs occupy [0.34, 0.66]; placing 3D side rails at 0.13 and 0.87 leaves the 3D studs 100% uncovered!
  if (block.axisLock === 'H') {
    let minCol = anchor[1];
    let maxCol = anchor[1];
    let freeRowCell: readonly [number, number] | undefined;
    let freeAnyCell: readonly [number, number] | undefined;
    for (let i = 0; i < shape.cells.length; i++) {
      const cell = shape.cells[i];
      if (cell[0] === anchor[0]) {
        if (cell[1] < minCol) minCol = cell[1];
        if (cell[1] > maxCol) maxCol = cell[1];
        if (!freeRowCell && cell[1] !== anchor[1]) freeRowCell = cell;
      }
      if (!freeAnyCell && (cell[0] !== anchor[0] || cell[1] !== anchor[1])) {
        freeAnyCell = cell;
      }
    }
    const spanW = maxCol - minCol + 1;
    const railCenterLocalX = minCol + spanW * 0.5;
    const railLen = spanW - 0.12;
    const zRail = blockLocalZToWorld(pose, layers.railCenter);
    const flangeR = Math.min(1, r * 0.42 + 0.58);
    const flangeG = Math.min(1, g * 0.42 + 0.55);
    const flangeB = Math.min(1, b * 0.42 + 0.48);

    // Parallel 3D beveled architectural side-flange rails along the locked top & bottom edges
    rctx.drawMesh(
      gl,
      ENVIRONMENT_MESHES.unitParticleCube,
      blockLocalXToWorld(pose, railCenterLocalX),
      blockLocalYToWorld(pose, anchor[0] + 0.13),
      zRail,
      railLen * sxy,
      0.092 * sxy,
      layers.railSizeZ * sz,
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
      blockLocalXToWorld(pose, railCenterLocalX),
      blockLocalYToWorld(pose, anchor[0] + 0.87),
      zRail,
      railLen * sxy,
      0.092 * sxy,
      layers.railSizeZ * sz,
      flangeR,
      flangeG,
      flangeB,
      1.0,
      0,
      0,
      0
    );

    // Sculpted 3D tone-on-tone medallion + pill-free architectural double-chevron (`LOCK_H`)
    let arrowLocalX = railCenterLocalX;
    let arrowLocalY = anchorLocalY;
    let medW = spanW >= 2 ? 0.58 : 0.48;
    let medH = 0.36;
    let iconSize = spanW >= 2 ? 0.5 : 0.42;
    let usesStackedFallback = false;

    if (hasImmobilizer || hasPayload) {
      const freeCell = freeRowCell ?? freeAnyCell;
      if (freeCell) {
        arrowLocalX = freeCell[1] + 0.5;
        arrowLocalY = freeCell[0] + 0.5;
        medW = 0.5;
        medH = 0.36;
        iconSize = 0.44;
      } else {
        arrowLocalX = anchorLocalX;
        arrowLocalY = anchor[0] + 0.8;
        medW = 0.42;
        medH = 0.28;
        iconSize = 0.34;
        usesStackedFallback = true;
      }
    }
    lockBadgeLocalX = arrowLocalX;
    lockBadgeLocalY = arrowLocalY;

    const arrowWx = blockLocalXToWorld(pose, arrowLocalX);
    const arrowWy = blockLocalYToWorld(pose, arrowLocalY);
    const lockMedLocalZ = layers.medallionBase + (usesStackedFallback ? 0.02 : 0);
    const lockBadgeZ = rctx.drawBadgeMedallion3D(
      gl,
      arrowWx,
      arrowWy,
      blockLocalZToWorld(pose, lockMedLocalZ),
      medW,
      medH,
      r,
      g,
      b,
      0.92,
      0.8,
      0.52,
      sxy,
      sz
    );
    rctx.drawAtlasBadge(gl, 'LOCK_H', arrowWx, arrowWy, lockBadgeZ, iconSize * sxy, 1.0, 0.99, 0.94, 1.0);
  } else if (block.axisLock === 'V') {
    let minRow = anchor[0];
    let maxRow = anchor[0];
    let freeColCell: readonly [number, number] | undefined;
    let freeAnyCell: readonly [number, number] | undefined;
    for (let i = 0; i < shape.cells.length; i++) {
      const cell = shape.cells[i];
      if (cell[1] === anchor[1]) {
        if (cell[0] < minRow) minRow = cell[0];
        if (cell[0] > maxRow) maxRow = cell[0];
        if (!freeColCell && cell[0] !== anchor[0]) freeColCell = cell;
      }
      if (!freeAnyCell && (cell[0] !== anchor[0] || cell[1] !== anchor[1])) {
        freeAnyCell = cell;
      }
    }
    const spanH = maxRow - minRow + 1;
    const railCenterLocalY = minRow + spanH * 0.5;
    const railLen = spanH - 0.12;
    const zRail = blockLocalZToWorld(pose, layers.railCenter);
    const flangeR = Math.min(1, r * 0.42 + 0.58);
    const flangeG = Math.min(1, g * 0.42 + 0.55);
    const flangeB = Math.min(1, b * 0.42 + 0.48);

    // Parallel 3D beveled architectural side-flange rails along the locked left & right edges
    rctx.drawMesh(
      gl,
      ENVIRONMENT_MESHES.unitParticleCube,
      blockLocalXToWorld(pose, anchor[1] + 0.13),
      blockLocalYToWorld(pose, railCenterLocalY),
      zRail,
      0.092 * sxy,
      railLen * sxy,
      layers.railSizeZ * sz,
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
      blockLocalXToWorld(pose, anchor[1] + 0.87),
      blockLocalYToWorld(pose, railCenterLocalY),
      zRail,
      0.092 * sxy,
      railLen * sxy,
      layers.railSizeZ * sz,
      flangeR,
      flangeG,
      flangeB,
      1.0,
      0,
      0,
      0
    );

    // Sculpted 3D tone-on-tone medallion + pill-free architectural double-chevron (`LOCK_V`)
    let arrowLocalX = anchorLocalX;
    let arrowLocalY = railCenterLocalY;
    let medW = 0.36;
    let medH = spanH >= 2 ? 0.58 : 0.48;
    let iconSize = spanH >= 2 ? 0.5 : 0.42;
    let usesStackedFallback = false;

    if (hasImmobilizer || hasPayload) {
      const freeCell = freeColCell ?? freeAnyCell;
      if (freeCell) {
        arrowLocalX = freeCell[1] + 0.5;
        arrowLocalY = freeCell[0] + 0.5;
        medW = 0.36;
        medH = 0.5;
        iconSize = 0.44;
      } else {
        arrowLocalX = anchor[1] + 0.8;
        arrowLocalY = anchorLocalY;
        medW = 0.28;
        medH = 0.42;
        iconSize = 0.34;
        usesStackedFallback = true;
      }
    }
    lockBadgeLocalX = arrowLocalX;
    lockBadgeLocalY = arrowLocalY;

    const arrowWx = blockLocalXToWorld(pose, arrowLocalX);
    const arrowWy = blockLocalYToWorld(pose, arrowLocalY);
    const lockMedLocalZ = layers.medallionBase + (usesStackedFallback ? 0.02 : 0);
    const lockBadgeZ = rctx.drawBadgeMedallion3D(
      gl,
      arrowWx,
      arrowWy,
      blockLocalZToWorld(pose, lockMedLocalZ),
      medW,
      medH,
      r,
      g,
      b,
      0.92,
      0.8,
      0.52,
      sxy,
      sz
    );
    rctx.drawAtlasBadge(gl, 'LOCK_V', arrowWx, arrowWy, lockBadgeZ, iconSize * sxy, 1.0, 0.99, 0.94, 1.0);
  }

  // Zone B: Decoupled Immobilizer Badge vs Payload / Modifier Badge (`R3D-03`, `UX-10`)
  let immLocalX = anchorLocalX;
  let immLocalY = anchorLocalY;
  let immScale = layersLeft > 1 && shape.cells.length === 1 ? 0.86 : 1.0;
  let payLocalX = anchorLocalX;
  let payLocalY = anchorLocalY;
  let payScale = layersLeft > 1 && shape.cells.length === 1 ? 0.86 : 1.0;

  if (hasImmobilizer && hasPayload) {
    if (shape.cells.length >= 2) {
      const secCell = shape.cells[(shape.anchorCellIndex + 1) % shape.cells.length];
      payLocalX = secCell[1] + 0.5;
      payLocalY = secCell[0] + 0.5;
    } else {
      immLocalX = anchorLocalX - 0.16;
      immLocalY = anchorLocalY - 0.14;
      immScale = 0.76;
      payLocalX = anchorLocalX + 0.16;
      payLocalY = anchorLocalY + 0.14;
      payScale = 0.76;
    }
  }

  const isCellCenterBusy = (cellR: number, cellC: number, ci: number): boolean => {
    const cellCx = cellC + 0.5;
    const cellCy = cellR + 0.5;
    return (
      (hasImmobilizer && Math.hypot(cellCx - immLocalX, cellCy - immLocalY) < 0.36) ||
      (hasPayload && Math.hypot(cellCx - payLocalX, cellCy - payLocalY) < 0.36) ||
      (block.axisLock !== 'NONE' && Math.hypot(cellCx - lockBadgeLocalX, cellCy - lockBadgeLocalY) < 0.38) ||
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
        blockLocalXToWorld(pose, cell[1] + 0.5),
        blockLocalYToWorld(pose, cell[0] + 0.5),
        blockLocalZToWorld(pose, 0.604),
        0.44 * sxy,
        0.44 * sxy,
        0.046 * sz,
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

  // AX-01 Colorblind Sigils: borderless, hue-harmonized tone-on-tone sculpted silhouette per block
  if (colorblind) {
    const isNeonCyber = rctx.lastOptions.equippedSkin === 'neon_cyber';
    const matStyle =
      activeColor === 0 ? 6 : rctx.getMaterialStyleCode(rctx.lastOptions.equippedSkin ?? 'classic_studs');
    const hasCenterBadgeOnCell = (cellR: number, cellC: number, ci: number): boolean => {
      const cellCx = cellC + 0.5;
      const cellCy = cellR + 0.5;
      return (
        (hasImmobilizer && Math.hypot(cellCx - immLocalX, cellCy - immLocalY) < 0.42) ||
        (hasPayload && Math.hypot(cellCx - payLocalX, cellCy - payLocalY) < 0.42) ||
        (block.axisLock === 'H' &&
          Math.abs(cellCx - lockBadgeLocalX) < 0.58 &&
          Math.abs(cellCy - lockBadgeLocalY) < 0.42) ||
        (block.axisLock === 'V' &&
          Math.abs(cellCx - lockBadgeLocalX) < 0.42 &&
          Math.abs(cellCy - lockBadgeLocalY) < 0.58) ||
        (block.ropeColor > 0 && ci === shape.anchorCellIndex)
      );
    };

    const freeCellIndices: number[] = [];
    const strapOnlyCellIndices: number[] = [];
    for (let ci = 0; ci < shape.cells.length; ci++) {
      const cell = shape.cells[ci];
      if (hasCenterBadgeOnCell(cell[0], cell[1], ci)) continue;
      if (block.chained && (cell[0] === anchor[0] || cell[1] === anchor[1])) {
        strapOnlyCellIndices.push(ci);
      } else {
        freeCellIndices.push(ci);
      }
    }
    const centroidR = (shape.rows - 1) * 0.5;
    const centroidC = (shape.cols - 1) * 0.5;
    const byAnchorThenCenter = (ia: number, ib: number): number => {
      if (ia === shape.anchorCellIndex) return -1;
      if (ib === shape.anchorCellIndex) return 1;
      const ca = shape.cells[ia];
      const cb = shape.cells[ib];
      return (
        Math.hypot(ca[0] - centroidR, ca[1] - centroidC) - Math.hypot(cb[0] - centroidR, cb[1] - centroidC)
      );
    };
    freeCellIndices.sort(byAnchorThenCenter);
    strapOnlyCellIndices.sort(byAnchorThenCenter);

    const drawCapPad = (
      lx: number,
      ly: number,
      padLocalSize: number,
      busyCorner = false,
      cr = r,
      cg = g,
      cb = b,
      mStyle = matStyle
    ): void => {
      const centerZ = busyCorner ? layers.busyCornerCapPadCenter : layers.capPadCenter;
      const sizeZ = busyCorner ? layers.busyCornerCapPadSizeZ : layers.capPadSizeZ;
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        blockLocalXToWorld(pose, lx),
        blockLocalYToWorld(pose, ly),
        blockLocalZToWorld(pose, centerZ),
        padLocalSize * sxy,
        padLocalSize * sxy,
        sizeZ * sz,
        cr,
        cg,
        cb,
        1.0,
        0,
        0,
        mStyle
      );
    };
    const drawSigil = (col: ColorId, lx: number, ly: number, localZ: number, sigilSize: number): void => {
      drawToneOnToneSigil3D(
        rctx,
        gl,
        col,
        blockLocalXToWorld(pose, lx),
        blockLocalYToWorld(pose, ly),
        blockLocalZToWorld(pose, localZ),
        sigilSize * sxy,
        roomLum,
        highContrast,
        isNeonCyber
      );
    };

    if (layersLeft === 1) {
      if (freeCellIndices.length > 0) {
        const primaryCell = shape.cells[freeCellIndices[0]];
        const px = primaryCell[1] + 0.5;
        const py = primaryCell[0] + 0.5;
        if (block.iceCount > 0) drawCapPad(px, py, 0.52);
        drawSigil(activeColor, px, py, layers.cbSymbol, block.iceCount > 0 ? 0.46 : 0.5);
      } else if (strapOnlyCellIndices.length > 0) {
        const strapCell = shape.cells[strapOnlyCellIndices[0]];
        const sx = strapCell[1] + 0.5;
        const sy = strapCell[0] + 0.5;
        drawCapPad(sx, sy, 0.52);
        drawSigil(activeColor, sx, sy, layers.cbSymbol, 0.46);
      } else if (shape.cells.length >= 2 && block.axisLock !== 'NONE') {
        const endCell =
          shape.cells.find((c, ci) => {
            const cx = c[1] + 0.5;
            const cy = c[0] + 0.5;
            return (
              !(hasImmobilizer && Math.hypot(cx - immLocalX, cy - immLocalY) < 0.42) &&
              !(hasPayload && Math.hypot(cx - payLocalX, cy - payLocalY) < 0.42) &&
              !(block.ropeColor > 0 && ci === shape.anchorCellIndex)
            );
          }) ?? shape.cells[0];
        const ex =
          endCell[1] +
          0.5 +
          (block.axisLock === 'H' ? (endCell[1] + 0.5 <= lockBadgeLocalX ? -0.14 : 0.14) : 0);
        const ey =
          endCell[0] +
          0.5 +
          (block.axisLock === 'V' ? (endCell[0] + 0.5 <= lockBadgeLocalY ? -0.14 : 0.14) : 0);
        const overlapsAxisMedallion = Math.hypot(ex - lockBadgeLocalX, ey - lockBadgeLocalY) < 0.56;
        if (block.iceCount > 0 || overlapsAxisMedallion) drawCapPad(ex, ey, 0.44, overlapsAxisMedallion);
        drawSigil(activeColor, ex, ey, overlapsAxisMedallion ? layers.busyCornerSigil : layers.cbSymbol, 0.4);
      } else {
        const fallbackCell = shape.cells[0];
        const fx = fallbackCell[1] + 0.24;
        const fy = fallbackCell[0] + 0.24;
        drawCapPad(fx, fy, 0.34, true);
        drawSigil(activeColor, fx, fy, layers.busyCornerSigil, 0.28);
      }
    } else {
      // Multi-layer block: seamless outer-color bridge pad + tone-on-tone outer & inner silhouettes
      const innerColor = block.colorStack[block.colorCursor + 1] ?? activeColor;
      const [ir, ig, ib] = rctx.getColorRgb(innerColor, highContrast);
      const innerMatStyle =
        innerColor === 0 ? 6 : rctx.getMaterialStyleCode(rctx.lastOptions.equippedSkin ?? 'classic_studs');
      const usableCells = [...freeCellIndices, ...strapOnlyCellIndices];
      if (shape.cells.length >= 2 && usableCells.length >= 2) {
        const outerCell = shape.cells[usableCells[0]];
        const innerCell = shape.cells[usableCells[1]];
        const ox = outerCell[1] + 0.5;
        const oy = outerCell[0] + 0.5;
        const ix = innerCell[1] + 0.5;
        const iy = innerCell[0] + 0.5;
        drawCapPad(ox, oy, 0.58);
        drawSigil(activeColor, ox, oy, layers.cbSymbol, 0.46);
        if (block.iceCount > 0) {
          drawCapPad(ix, iy, 0.5, false, ir * roomLum, ig * roomLum, ib * roomLum, innerMatStyle);
        }
        drawSigil(innerColor, ix, iy, layers.cbSymbol + 0.002, 0.44);
      } else {
        const targetCell = shape.cells[usableCells[0] ?? 0];
        const cellBusy = usableCells.length === 0;
        const tx = targetCell[1] + 0.24;
        const ty = targetCell[0] + 0.24;
        const ix = targetCell[1] + (cellBusy ? 0.76 : 0.58);
        const iy = targetCell[0] + (cellBusy ? 0.76 : 0.58);
        const sigZ = cellBusy ? layers.busyCornerSigil : layers.cbSymbol;
        drawCapPad(tx, ty, 0.34, cellBusy);
        drawSigil(activeColor, tx, ty, sigZ, 0.31);
        drawCapPad(ix, iy, 0.34, cellBusy, ir * roomLum, ig * roomLum, ib * roomLum, innerMatStyle);
        drawSigil(innerColor, ix, iy, sigZ + 0.003, cellBusy ? 0.29 : 0.33);
      }
    }
  }

  const immWx = blockLocalXToWorld(pose, immLocalX);
  const immWy = blockLocalYToWorld(pose, immLocalY);
  const immBaseZ = blockLocalZToWorld(pose, layers.medallionBase);

  // 1) Immobilizer Badge (`iceCount > 0` or `chained`) via Sculpted 3D Medallion
  if (block.iceCount > 0) {
    const iceBadgeZ = rctx.drawBadgeMedallion3D(
      gl,
      immWx,
      immWy,
      immBaseZ,
      0.66 * immScale,
      0.44 * immScale,
      0.38 * roomLum,
      0.74 * roomLum,
      0.96 * roomLum,
      0.92,
      0.8,
      0.52,
      sxy,
      sz
    );
    rctx.drawAtlasBadge(
      gl,
      'BADGE_ICE',
      immWx - 0.14 * immScale * sxy,
      immWy,
      iceBadgeZ,
      0.35 * immScale * sxy,
      0.88 * roomLum,
      0.98 * roomLum,
      1.0 * roomLum,
      1.0
    );
    rctx.drawNumberBadges(
      gl,
      block.iceCount,
      immWx + 0.15 * immScale * sxy,
      immWy,
      iceBadgeZ + 0.002 * sz,
      0.35 * immScale * sxy,
      roomLum,
      roomLum,
      roomLum
    );
  } else if (block.chained) {
    const lockBadgeZ = rctx.drawBadgeMedallion3D(
      gl,
      immWx,
      immWy,
      immBaseZ,
      0.52 * immScale,
      0.52 * immScale,
      0.36 * roomLum,
      0.4 * roomLum,
      0.48 * roomLum,
      0.92,
      0.8,
      0.52,
      sxy,
      sz
    );
    rctx.drawAtlasBadge(
      gl,
      'BADGE_LOCK',
      immWx,
      immWy,
      lockBadgeZ,
      0.48 * immScale * sxy,
      1.0 * roomLum,
      0.9 * roomLum,
      0.42 * roomLum,
      1.0
    );
  }

  // 2) Payload / Modifier Badge (`bomb`, `hasKey`, `scissorColor`, `shutterGemColor`, `isStar`) via Sculpted 3D Medallion (`IDLE-05`)
  const payHoverLocalZ =
    !reducedMotion && !pose.isLockedRoom
      ? (0.5 + 0.5 * Math.sin(timeSec * 2.2 + pose.poseSeed * 0.9)) * 0.016 * live3DMix
      : 0;
  const payPulseScale =
    !reducedMotion && !pose.isLockedRoom
      ? payScale * (1.0 + Math.sin(timeSec * 2.2 + pose.poseSeed * 0.9) * 0.028 * live3DMix)
      : payScale;
  const payWx = blockLocalXToWorld(pose, payLocalX);
  const payWy = blockLocalYToWorld(pose, payLocalY);

  if (block.bombMax > 0 && block.bombCount > 0) {
    const urgent = block.bombCount <= 3 && !pose.isLockedRoom ? 0.65 + 0.35 * pulse : 1.0;
    const bombMedScale =
      !reducedMotion && !pose.isLockedRoom
        ? payScale * (1.0 + pose.bombHeartbeat * 1.2 * live3DMix)
        : payScale;
    const twoDigit = block.bombCount >= 10;
    const bombBadgeZ = rctx.drawBadgeMedallion3D(
      gl,
      payWx,
      payWy,
      blockLocalZToWorld(pose, layers.medallionBase + payHoverLocalZ * 0.6),
      0.74 * bombMedScale,
      0.46 * bombMedScale,
      r,
      g,
      b,
      0.92,
      0.8,
      0.52,
      sxy,
      sz
    );
    rctx.drawAtlasBadge(
      gl,
      'BADGE_BOMB',
      payWx - (twoDigit ? 0.2 : 0.15) * bombMedScale * sxy,
      payWy,
      bombBadgeZ,
      (twoDigit ? 0.32 : 0.35) * bombMedScale * sxy,
      1.0 * roomLum,
      0.86 * urgent * roomLum,
      0.3 * urgent * roomLum,
      1.0
    );
    rctx.drawNumberBadges(
      gl,
      block.bombCount,
      payWx + (twoDigit ? 0.16 : 0.15) * bombMedScale * sxy,
      payWy,
      bombBadgeZ + 0.002 * sz,
      (twoDigit ? 0.3 : 0.35) * bombMedScale * sxy,
      1.0 * roomLum,
      0.97 * roomLum,
      0.48 * roomLum
    );
  } else if (block.hasKey > 0) {
    const keyBadgeZ = rctx.drawBadgeMedallion3D(
      gl,
      payWx,
      payWy,
      blockLocalZToWorld(pose, layers.medallionBase + payHoverLocalZ),
      0.52 * payPulseScale,
      0.52 * payPulseScale,
      r,
      g,
      b,
      0.92,
      0.8,
      0.52,
      sxy,
      sz
    );
    rctx.drawAtlasBadge(
      gl,
      'BADGE_KEY',
      payWx,
      payWy,
      keyBadgeZ,
      0.48 * payPulseScale * sxy,
      1.0 * roomLum,
      0.9 * roomLum,
      0.32 * roomLum,
      1.0
    );
  } else if (block.scissorColor > 0 || block.shutterGemColor > 0) {
    const isScissor = block.scissorColor > 0;
    const payloadColor = isScissor ? block.scissorColor : block.shutterGemColor;
    const payloadKey = isScissor ? 'BADGE_SCISSORS' : 'BADGE_GEM';
    const [pr, pg, pb] = rctx.getColorRgb(payloadColor, highContrast);
    if (colorblind) {
      const [pfgR, pfgG, pfgB] = getToneOnToneGlyphRgb(payloadColor, highContrast, false);
      const payBadgeZ = rctx.drawBadgeMedallion3D(
        gl,
        payWx,
        payWy,
        blockLocalZToWorld(pose, layers.medallionBase + payHoverLocalZ),
        0.68 * payPulseScale,
        0.46 * payPulseScale,
        pr * roomLum,
        pg * roomLum,
        pb * roomLum,
        0.92,
        0.8,
        0.52,
        sxy,
        sz
      );
      rctx.drawAtlasBadge(
        gl,
        payloadKey,
        payWx - 0.14 * payPulseScale * sxy,
        payWy,
        payBadgeZ,
        0.34 * payPulseScale * sxy,
        pfgR * roomLum,
        pfgG * roomLum,
        pfgB * roomLum,
        1.0
      );
      drawToneOnToneSigil3D(
        rctx,
        gl,
        payloadColor,
        payWx + 0.15 * payPulseScale * sxy,
        payWy,
        payBadgeZ + 0.003 * sz,
        0.33 * payPulseScale * sxy,
        roomLum,
        highContrast,
        false
      );
    } else {
      const payBadgeZ = rctx.drawBadgeMedallion3D(
        gl,
        payWx,
        payWy,
        blockLocalZToWorld(pose, layers.medallionBase + payHoverLocalZ),
        0.52 * payPulseScale,
        0.52 * payPulseScale,
        r,
        g,
        b,
        0.92,
        0.8,
        0.52,
        sxy,
        sz
      );
      rctx.drawAtlasBadge(
        gl,
        payloadKey,
        payWx,
        payWy,
        payBadgeZ,
        0.48 * payPulseScale * sxy,
        pr * roomLum,
        pg * roomLum,
        pb * roomLum,
        1.0
      );
    }
  } else if (block.isStar) {
    const starBadgeZ = rctx.drawBadgeMedallion3D(
      gl,
      payWx,
      payWy,
      blockLocalZToWorld(pose, layers.medallionBase + payHoverLocalZ),
      0.5 * payPulseScale,
      0.5 * payPulseScale,
      r,
      g,
      b,
      0.92,
      0.8,
      0.52,
      sxy,
      sz
    );
    rctx.drawAtlasBadge(
      gl,
      'BADGE_STAR',
      payWx,
      payWy,
      starBadgeZ,
      0.46 * payPulseScale * sxy,
      1.0 * roomLum,
      0.92 * roomLum,
      0.32 * roomLum,
      1.0
    );
  }
}
