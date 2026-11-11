import { getGateActiveColor } from '../core/gate-clearance';
import type { BoardState, GateState } from '../core/types';
import { ENVIRONMENT_MESHES } from './mesh-generator';
import { type RenderPassContext, TRAY_WALL_STYLE, type TrayPalette } from './render-types';

export function renderPass1WallsAndGates(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  board: BoardState,
  palette: TrayPalette,
  highContrast: boolean,
  colorblind: boolean,
  timeSec: number
): void {
  const { rows, cols, occupancy } = board;
  const isStoneRuin = (rctx.lastOptions.blueprintMix ?? 0) > 0.45;
  const live3DMix = Math.max(0, 1.0 - (rctx.lastOptions.blueprintMix ?? 0));
  const isCellPlayable = (r: number, c: number): boolean =>
    r >= 0 && r < rows && c >= 0 && c < cols && occupancy[r * cols + c] !== -1;

  // 1F. Contoured Perimeter Parapet Walls, Corner Posts & Stepped-Edge Exit Gates (`COURTYARD-01`, `GATE-STEP-01`)
  const wallThick = 0.42;
  const [wr, wg, wb] = palette.wallColor;
  const [rhr, rhg, rhb] = palette.rimHighlight;

  const isUnitEdgeCoveredByGate = (edge: GateState['edge'], edgeLine: number, spanCell: number): boolean => {
    for (const gate of board.gates) {
      if (
        gate.edge === edge &&
        gate.edgeLine === edgeLine &&
        spanCell >= gate.spanStart &&
        spanCell < gate.spanStart + gate.spanLength
      ) {
        return true;
      }
    }
    return false;
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!isCellPlayable(r, c)) continue;

      const roomId = board.roomMap[r * cols + c] ?? 0;
      const roomVis = rctx.getRoomVisualState(board, roomId);
      const zOff = roomVis.zOffset;
      const lum = roomVis.luminanceMul;
      const cwr = wr * lum;
      const cwg = wg * lum;
      const cwb = wb * lum;
      const crhr = rhr * lum;
      const crhg = rhg * lum;
      const crhb = rhb * lum;

      const topOpen = !isCellPlayable(r - 1, c);
      const botOpen = !isCellPlayable(r + 1, c);
      const leftOpen = !isCellPlayable(r, c - 1);
      const rightOpen = !isCellPlayable(r, c + 1);

      const gateThick = wallThick - 0.03;
      if (topOpen && !isUnitEdgeCoveredByGate('TOP', r, c)) {
        const trimLeft =
          isCellPlayable(r - 1, c - 1) && isUnitEdgeCoveredByGate('RIGHT', c - 1, r - 1) ? gateThick : 0;
        const trimRight =
          isCellPlayable(r - 1, c + 1) && isUnitEdgeCoveredByGate('LEFT', c + 1, r - 1) ? gateThick : 0;
        const segW = 1 - trimLeft - trimRight;
        if (segW > 0.02) {
          rctx.drawMesh(
            gl,
            ENVIRONMENT_MESHES.wallSegment,
            c + trimLeft,
            r - wallThick,
            zOff,
            segW,
            wallThick,
            1,
            cwr,
            cwg,
            cwb,
            1.0,
            0,
            0,
            TRAY_WALL_STYLE
          );
          rctx.drawMesh(
            gl,
            ENVIRONMENT_MESHES.overlayQuad,
            c + trimLeft,
            r - 0.09,
            zOff + 0.682,
            segW,
            0.08,
            1,
            crhr,
            crhg,
            crhb,
            0.9
          );
        }
      }
      if (botOpen && !isUnitEdgeCoveredByGate('BOTTOM', r, c)) {
        const trimLeft =
          isCellPlayable(r + 1, c - 1) && isUnitEdgeCoveredByGate('RIGHT', c - 1, r + 1) ? gateThick : 0;
        const trimRight =
          isCellPlayable(r + 1, c + 1) && isUnitEdgeCoveredByGate('LEFT', c + 1, r + 1) ? gateThick : 0;
        const segW = 1 - trimLeft - trimRight;
        if (segW > 0.02) {
          rctx.drawMesh(
            gl,
            ENVIRONMENT_MESHES.wallSegment,
            c + trimLeft,
            r + 1,
            zOff,
            segW,
            wallThick,
            1,
            cwr,
            cwg,
            cwb,
            1.0,
            0,
            0,
            TRAY_WALL_STYLE
          );
          rctx.drawMesh(
            gl,
            ENVIRONMENT_MESHES.overlayQuad,
            c + trimLeft,
            r + 1.01,
            zOff + 0.682,
            segW,
            0.08,
            1,
            crhr,
            crhg,
            crhb,
            0.9
          );
        }
      }
      if (leftOpen && !isUnitEdgeCoveredByGate('LEFT', c, r)) {
        const trimTop = isCellPlayable(r - 1, c - 1)
          ? isUnitEdgeCoveredByGate('BOTTOM', r - 1, c - 1)
            ? gateThick
            : wallThick
          : 0;
        const trimBot = isCellPlayable(r + 1, c - 1)
          ? isUnitEdgeCoveredByGate('TOP', r + 1, c - 1)
            ? gateThick
            : wallThick
          : 0;
        const segH = 1 - trimTop - trimBot;
        if (segH > 0.02) {
          rctx.drawMesh(
            gl,
            ENVIRONMENT_MESHES.wallSegment,
            c - wallThick,
            r + trimTop,
            zOff,
            wallThick,
            segH,
            1,
            cwr,
            cwg,
            cwb,
            1.0,
            0,
            0,
            TRAY_WALL_STYLE
          );
          rctx.drawMesh(
            gl,
            ENVIRONMENT_MESHES.overlayQuad,
            c - 0.09,
            r + trimTop,
            zOff + 0.682,
            0.08,
            segH,
            1,
            crhr,
            crhg,
            crhb,
            0.9
          );
        }
      }
      if (rightOpen && !isUnitEdgeCoveredByGate('RIGHT', c, r)) {
        const trimTop = isCellPlayable(r - 1, c + 1)
          ? isUnitEdgeCoveredByGate('BOTTOM', r - 1, c + 1)
            ? gateThick
            : wallThick
          : 0;
        const trimBot = isCellPlayable(r + 1, c + 1)
          ? isUnitEdgeCoveredByGate('TOP', r + 1, c + 1)
            ? gateThick
            : wallThick
          : 0;
        const segH = 1 - trimTop - trimBot;
        if (segH > 0.02) {
          rctx.drawMesh(
            gl,
            ENVIRONMENT_MESHES.wallSegment,
            c + 1,
            r + trimTop,
            zOff,
            wallThick,
            segH,
            1,
            cwr,
            cwg,
            cwb,
            1.0,
            0,
            0,
            TRAY_WALL_STYLE
          );
          rctx.drawMesh(
            gl,
            ENVIRONMENT_MESHES.overlayQuad,
            c + 1.01,
            r + trimTop,
            zOff + 0.682,
            0.08,
            segH,
            1,
            crhr,
            crhg,
            crhb,
            0.9
          );
        }
      }

      // Convex outer corner posts & concave inner elbow posts when stepped-edge gates abut an inward corner
      const drawCornerPost = (px: number, py: number): void => {
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.wallSegment,
          px,
          py,
          zOff,
          wallThick,
          wallThick,
          1,
          cwr,
          cwg,
          cwb,
          1.0,
          0,
          0,
          TRAY_WALL_STYLE
        );
      };
      if (topOpen && leftOpen) drawCornerPost(c - wallThick, r - wallThick);
      if (topOpen && rightOpen) drawCornerPost(c + 1, r - wallThick);
      if (botOpen && leftOpen) drawCornerPost(c - wallThick, r + 1);
      if (botOpen && rightOpen) drawCornerPost(c + 1, r + 1);
      if (
        !topOpen &&
        !leftOpen &&
        !isCellPlayable(r - 1, c - 1) &&
        isUnitEdgeCoveredByGate('LEFT', c, r - 1) &&
        isUnitEdgeCoveredByGate('TOP', r, c - 1)
      ) {
        drawCornerPost(c - wallThick, r - wallThick);
      }
      if (
        !topOpen &&
        !rightOpen &&
        !isCellPlayable(r - 1, c + 1) &&
        isUnitEdgeCoveredByGate('RIGHT', c, r - 1) &&
        isUnitEdgeCoveredByGate('TOP', r, c + 1)
      ) {
        drawCornerPost(c + 1, r - wallThick);
      }
      if (
        !botOpen &&
        !leftOpen &&
        !isCellPlayable(r + 1, c - 1) &&
        isUnitEdgeCoveredByGate('LEFT', c, r + 1) &&
        isUnitEdgeCoveredByGate('BOTTOM', r, c - 1)
      ) {
        drawCornerPost(c - wallThick, r + 1);
      }
      if (
        !botOpen &&
        !rightOpen &&
        !isCellPlayable(r + 1, c + 1) &&
        isUnitEdgeCoveredByGate('RIGHT', c, r + 1) &&
        isUnitEdgeCoveredByGate('BOTTOM', r, c + 1)
      ) {
        drawCornerPost(c + 1, r + 1);
      }
    }
  }

  // Render each Exit Gate housing, spinning shredder roller, queue pips, and badges (`GATE-STEP-01`)
  for (const gate of board.gates) {
    const activeColor = getGateActiveColor(gate);
    const [rawGr, rawGg, rawGb] = rctx.getColorRgb(activeColor, highContrast);
    const isHorizEdge = gate.edge === 'TOP' || gate.edge === 'BOTTOM';
    const spanAxisX = isHorizEdge ? 1 : 0;
    const spanAxisY = isHorizEdge ? 0 : 1;

    const adjR = isHorizEdge ? gate.edgeLine : gate.spanStart;
    const adjC = isHorizEdge ? gate.spanStart : gate.edgeLine;
    const gateRoomId =
      adjR >= 0 && adjR < rows && adjC >= 0 && adjC < cols ? (board.roomMap[adjR * cols + adjC] ?? 0) : 0;
    const gateVis = rctx.getRoomVisualState(board, gateRoomId);
    const zOff = gateVis.zOffset;
    const lum = gateVis.luminanceMul;
    const gr = rawGr * lum;
    const gg = rawGg * lum;
    const gb = rawGb * lum;

    let gx = 0;
    let gy = 0;
    let gw = 1;
    let gh = 1;
    let rollerX = 0;
    let rollerY = 0;
    const rollerLen = gate.spanLength;
    let rollerRotZ = 0;

    if (gate.edge === 'TOP') {
      gx = gate.spanStart;
      gy = gate.edgeLine - wallThick;
      gw = gate.spanLength;
      gh = wallThick;
      rollerX = gate.spanStart + gate.spanLength * 0.5;
      rollerY = gate.edgeLine - wallThick * 0.5;
      rollerRotZ = 0;
    } else if (gate.edge === 'BOTTOM') {
      gx = gate.spanStart;
      gy = gate.edgeLine + 1;
      gw = gate.spanLength;
      gh = wallThick;
      rollerX = gate.spanStart + gate.spanLength * 0.5;
      rollerY = gate.edgeLine + 1 + wallThick * 0.5;
      rollerRotZ = 0;
    } else if (gate.edge === 'LEFT') {
      gx = gate.edgeLine - wallThick;
      gy = gate.spanStart;
      gw = wallThick;
      gh = gate.spanLength;
      rollerX = gate.edgeLine - wallThick * 0.5;
      rollerY = gate.spanStart + gate.spanLength * 0.5;
      rollerRotZ = Math.PI * 0.5;
    } else {
      gx = gate.edgeLine + 1;
      gy = gate.spanStart;
      gw = wallThick;
      gh = gate.spanLength;
      rollerX = gate.edgeLine + 1 + wallThick * 0.5;
      rollerY = gate.spanStart + gate.spanLength * 0.5;
      rollerRotZ = Math.PI * 0.5;
    }

    // Sliding / Size-Changing Gate Rail Track (`R3D-08` — hidden in static Stone Ruin mode)
    if (!isStoneRuin && (gate.slidesOnClear || gate.sizeChangesOnClear)) {
      const railMin = gate.slidesOnClear ? gate.slideMin : gate.spanStart;
      const railSpan = gate.slidesOnClear
        ? Math.max(gate.spanLength, gate.slideMax - gate.slideMin + gate.spanLength)
        : Math.max(gate.spanLength, gate.maxLength);
      const rx = isHorizEdge ? railMin : gx + gw * 0.35;
      const ry = isHorizEdge ? gy + gh * 0.35 : railMin;
      const rw = isHorizEdge ? railSpan : gw * 0.3;
      const rh = isHorizEdge ? gh * 0.3 : railSpan;
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.gateHousing,
        rx,
        ry,
        zOff,
        rw,
        rh,
        0.18,
        rhr * 0.9 * lum,
        rhg * 0.9 * lum,
        rhb * 0.9 * lum,
        0.95
      );
      rctx.drawAtlasBadge(
        gl,
        isHorizEdge ? 'LOCK_H' : 'LOCK_V',
        rollerX + spanAxisX * (gate.spanLength * 0.5 - 0.16),
        rollerY + spanAxisY * (gate.spanLength * 0.5 - 0.16),
        zOff + 0.72,
        0.24,
        0.9 * lum,
        0.96 * lum,
        1.0 * lum,
        0.95
      );
    }

    // Gate colored base sill
    rctx.drawMesh(gl, ENVIRONMENT_MESHES.gateHousing, gx, gy, zOff, gw, gh, 0.42, gr, gg, gb, 1.0);

    // Spinning 3D Shredder Roller cylinder + Breathing Threshold Floor Aura (`IDLE-03`)
    const gateReady =
      gate.shutterOpen && gate.shutterLockColor === 0 && gate.iceCount <= 0 && !gateVis.isLocked;
    const isGateActivelyShredding = rctx.activeVisualShreds.some((a) => a.gateIndex === gate.index);
    const isGateDragTargeted = rctx.lastOptions.dragEligibleGateIndex === gate.index;
    const gatePulse = !rctx.lastOptions.reducedMotion
      ? 0.5 + 0.5 * Math.sin(timeSec * 2.2 + gate.index * 1.4)
      : 0.5;
    const rollerGlint = !isStoneRuin && !rctx.lastOptions.reducedMotion && gateReady ? 0.08 * gatePulse : 0;
    const rollerSpeed =
      !gateReady || rctx.lastOptions.reducedMotion
        ? 0.0
        : (isGateActivelyShredding || isGateDragTargeted ? 6.4 : 1.35) * live3DMix;
    const rollerSpin = gate.rollerPhase + timeSec * rollerSpeed;
    rctx.drawMesh(
      gl,
      ENVIRONMENT_MESHES.rollerMesh,
      rollerX,
      rollerY,
      zOff + 0.34,
      rollerLen * 0.92,
      0.135,
      0.135,
      Math.min(1, (rawGr * 0.85 + 0.18 + rollerGlint) * lum),
      Math.min(1, (rawGg * 0.85 + 0.18 + rollerGlint) * lum),
      Math.min(1, (rawGb * 0.85 + 0.18 + rollerGlint * 0.8) * lum),
      1.0,
      rollerSpin,
      rollerRotZ
    );

    // Breathing Threshold Intake Floor Glow on ready gates (`IDLE-03`)
    if (gateReady && live3DMix > 0.05) {
      const auraDepth = 0.38 + 0.07 * gatePulse * live3DMix;
      let auraX = 0;
      let auraY = 0;
      let auraW = 1;
      let auraH = 1;
      if (gate.edge === 'TOP') {
        auraX = gate.spanStart + 0.04;
        auraY = gate.edgeLine + 0.01;
        auraW = gate.spanLength - 0.08;
        auraH = auraDepth;
      } else if (gate.edge === 'BOTTOM') {
        auraX = gate.spanStart + 0.04;
        auraY = gate.edgeLine + 1 - auraDepth - 0.01;
        auraW = gate.spanLength - 0.08;
        auraH = auraDepth;
      } else if (gate.edge === 'LEFT') {
        auraX = gate.edgeLine + 0.01;
        auraY = gate.spanStart + 0.04;
        auraW = auraDepth;
        auraH = gate.spanLength - 0.08;
      } else {
        auraX = gate.edgeLine + 1 - auraDepth - 0.01;
        auraY = gate.spanStart + 0.04;
        auraW = auraDepth;
        auraH = gate.spanLength - 0.08;
      }
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.overlayQuad,
        auraX,
        auraY,
        zOff + 0.007,
        Math.max(0.2, auraW),
        Math.max(0.2, auraH),
        1.0,
        Math.min(1, gr * 0.8 + 0.2 * lum),
        Math.min(1, gg * 0.8 + 0.2 * lum),
        Math.min(1, gb * 0.8 + 0.2 * lum),
        (0.1 + 0.1 * gatePulse) * live3DMix,
        0,
        0,
        4
      );
    }

    // In static Stone Ruin Title Screen mode, omit all gate modifiers, lock/frost medallions, star/CB badges & queue pips
    if (isStoneRuin) {
      continue;
    }

    // Toggling Shutter Side-Posts & Status Bar (`R3D-08`)
    if (gate.togglesOnClear) {
      const indR = (gate.shutterOpen ? 0.14 : 0.92) * lum;
      const indG = (gate.shutterOpen ? 0.82 : 0.22) * lum;
      const indB = (gate.shutterOpen ? 0.38 : 0.28) * lum;
      const postW = isHorizEdge ? 0.1 : gw * 0.86;
      const postH = isHorizEdge ? gh * 0.86 : 0.1;
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.gateHousing,
        gx + (isHorizEdge ? 0.02 : gw * 0.07),
        gy + (isHorizEdge ? gh * 0.07 : 0.02),
        zOff + 0.26,
        postW,
        postH,
        0.52,
        indR,
        indG,
        indB,
        1.0
      );
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.gateHousing,
        gx + (isHorizEdge ? gw - 0.12 : gw * 0.07),
        gy + (isHorizEdge ? gh * 0.07 : gh - 0.12),
        zOff + 0.26,
        postW,
        postH,
        0.52,
        indR,
        indG,
        indB,
        1.0
      );
    }

    // Shutter Lock / Closed Shutter Bars
    if (!gate.shutterOpen || gate.shutterLockColor > 0) {
      const lockRgb =
        gate.shutterLockColor > 0
          ? rctx.getColorRgb(gate.shutterLockColor, highContrast)
          : ([0.65, 0.72, 0.8] as [number, number, number]);
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.gateHousing,
        gx + gw * 0.08,
        gy + gh * 0.08,
        zOff + 0.32,
        gw * 0.84,
        gh * 0.84,
        0.45,
        lockRgb[0] * 0.7 * lum,
        lockRgb[1] * 0.7 * lum,
        lockRgb[2] * 0.7 * lum,
        0.95
      );
      if (gate.shutterLockColor > 0) {
        rctx.drawAtlasBadge(
          gl,
          'BADGE_GEM',
          rollerX,
          rollerY,
          zOff + 0.72,
          0.32,
          lockRgb[0] * lum,
          lockRgb[1] * lum,
          lockRgb[2] * lum,
          1.0
        );
        if (colorblind) {
          rctx.drawAtlasBadge(
            gl,
            `CB_${gate.shutterLockColor}`,
            rollerX + spanAxisX * 0.2,
            rollerY + spanAxisY * 0.2,
            zOff + 0.725,
            0.22,
            lum,
            lum,
            lum,
            1
          );
        }
      }
    }

    // Frozen Gate Overlay (`R3D-04`, `R3D-11`, `GATE-ICE-01`: 3D Sculpted Frost Medallion + crisp 1/2-digit countdown)
    if (gate.iceCount > 0) {
      const twoDigitIce = gate.iceCount >= 10;
      const iceInwardX = !isHorizEdge && twoDigitIce ? (gate.edge === 'LEFT' ? 0.04 : -0.04) : 0;
      gl.depthMask(false);
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.gateHousing,
        gx - 0.008,
        gy - 0.008,
        zOff + 0.02,
        gw + 0.016,
        gh + 0.016,
        0.92,
        0.55 * lum,
        0.88 * lum,
        1.0 * lum,
        0.55,
        0,
        0,
        1
      );
      gl.depthMask(true);
      const medW = isHorizEdge ? (twoDigitIce ? 0.76 : 0.64) : 0.38;
      const medH = isHorizEdge ? 0.38 : twoDigitIce ? 0.72 : 0.66;
      const iceMedZ = rctx.drawBadgeMedallion3D(
        gl,
        rollerX + iceInwardX * 0.5,
        rollerY,
        zOff + 0.642,
        medW,
        medH,
        0.09 * lum,
        0.19 * lum,
        0.32 * lum,
        0.56 * lum,
        0.9 * lum,
        1.0 * lum
      );
      const iceIconOffset = isHorizEdge ? (twoDigitIce ? 0.18 : 0.14) : 0.15;
      const iceNumOffset = isHorizEdge ? (twoDigitIce ? 0.15 : 0.14) : 0.15;
      rctx.drawAtlasBadge(
        gl,
        'BADGE_ICE',
        rollerX - spanAxisX * iceIconOffset + iceInwardX * 0.5,
        rollerY - spanAxisY * iceIconOffset,
        iceMedZ,
        twoDigitIce ? 0.26 : 0.28,
        0.78 * lum,
        0.96 * lum,
        1.0 * lum,
        1.0
      );
      rctx.drawNumberBadges(
        gl,
        gate.iceCount,
        rollerX + spanAxisX * iceNumOffset + iceInwardX,
        rollerY + spanAxisY * iceNumOffset,
        iceMedZ + 0.002,
        twoDigitIce ? 0.25 : 0.3,
        lum,
        lum,
        lum
      );
    }

    // Star Gate Emblem (`R3D-04`: separated along span axis and elevated to z = 0.72)
    if (gate.isStar) {
      const starOffset =
        gate.iceCount > 0 ? (gate.iceCount >= 10 ? 0.52 : 0.46) : gate.shutterLockColor > 0 ? 0.28 : 0.0;
      rctx.drawAtlasBadge(
        gl,
        'BADGE_STAR',
        rollerX + spanAxisX * starOffset,
        rollerY + spanAxisY * starOffset,
        zOff + 0.72,
        0.32,
        1.0 * lum,
        0.9 * lum,
        0.25 * lum,
        1.0
      );
    }

    // Colorblind symbol on gate housing (`UX-10`, `R3D-04`: clear of center badges and outward queue pips)
    if (colorblind) {
      const hasCenterGateBadge = gate.iceCount > 0 || gate.shutterLockColor > 0 || gate.isStar;
      const symSpanOffset =
        gate.iceCount > 0
          ? -Math.max(0.54, Math.min(0.68, gate.spanLength * 0.5 - 0.22))
          : hasCenterGateBadge
            ? -Math.max(0.34, Math.min(0.46, gate.spanLength * 0.5 - 0.22))
            : 0.0;
      const inwardX = gate.edge === 'LEFT' ? 0.06 : gate.edge === 'RIGHT' ? -0.06 : 0;
      const inwardY = gate.edge === 'TOP' ? 0.06 : gate.edge === 'BOTTOM' ? -0.06 : 0;
      rctx.drawAtlasBadge(
        gl,
        `CB_${activeColor}`,
        rollerX + spanAxisX * symSpanOffset + inwardX,
        rollerY + spanAxisY * symSpanOffset + inwardY,
        zOff + 0.755,
        0.28,
        lum,
        lum,
        lum,
        1.0
      );
    }

    // Queued Next-Color Bars (`gate.colorQueue.slice(gate.colorCursor + 1)`, `FR-21`, `R3D-04`)
    const remainingQueue = gate.colorQueue.length - (gate.colorCursor + 1);
    const visibleQueue = Math.min(3, remainingQueue);
    for (let q = 0; q < visibleQueue; q++) {
      const nextCol = gate.colorQueue[gate.colorCursor + 1 + q];
      const [qr, qg, qb] = rctx.getColorRgb(nextCol, highContrast);
      const pipOffset = (q - (visibleQueue - 1) * 0.5) * 0.62;
      const px = isHorizEdge ? rollerX + pipOffset : rollerX + (gate.edge === 'LEFT' ? -0.18 : 0.18);
      const py = !isHorizEdge ? rollerY + pipOffset : rollerY + (gate.edge === 'TOP' ? -0.18 : 0.18);
      const barW = isHorizEdge ? 0.5 : 0.16;
      const barH = !isHorizEdge ? 0.5 : 0.16;
      const pipBobZ =
        !rctx.lastOptions.reducedMotion && !gateVis.isLocked
          ? Math.sin(timeSec * 3.4 + q * 1.1 + gate.index * 0.8) * 0.025
          : 0;

      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        px,
        py,
        zOff + 0.62 + pipBobZ,
        barW + 0.08,
        barH + 0.08,
        0.11,
        0.08 * lum,
        0.11 * lum,
        0.18 * lum,
        1.0
      );
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        px,
        py,
        zOff + 0.65 + pipBobZ,
        barW,
        barH,
        0.12,
        qr * lum,
        qg * lum,
        qb * lum,
        1.0
      );
      if (colorblind) {
        rctx.drawAtlasBadge(gl, `CB_${nextCol}`, px, py, zOff + 0.72 + pipBobZ, 0.15, lum, lum, lum, 0.96);
      }
    }
  }
}
