import { isBlockInLockedRoom, isRoomUnlocked } from '../core/physics';
import { getActiveColor, getShape } from '../core/polyomino';
import type { BoardState, ColorId } from '../core/types';
import { ENVIRONMENT_MESHES } from './mesh-generator';
import { renderActiveDragReticleAndOriginFootprint, renderMysticPathTraces3D } from './pass2-drag-fx';
import type { RenderPassContext, RenderSceneOptions, TrayPalette } from './render-types';

export function renderPass1PortcullisBarriers(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  board: BoardState,
  palette: TrayPalette,
  timeSec: number
): void {
  const isStoneRuin = (rctx.lastOptions.blueprintMix ?? 0) > 0.45;
  const live3DMix = Math.max(0, 1.0 - (rctx.lastOptions.blueprintMix ?? 0));
  // 1G. 3D Sanctuary Portcullis Barriers (`board.barriers`, `SANCTUM-01`, `SANCTUM-02`)
  for (const bar of board.barriers) {
    if (bar.cells.length === 0) continue;
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
    const isHoriz = bar.orientation === 'H';
    const spanW = maxC - minC + 1;
    const spanH = maxR - minR + 1;
    const barLen = Math.max(spanW, spanH);
    const bcx = minC + spanW * 0.5;
    const bcy = minR + spanH * 0.5;
    const portPulse =
      !isStoneRuin && !rctx.lastOptions.reducedMotion
        ? 0.5 + 0.5 * Math.sin(timeSec * 3.2 + bar.id * 1.3)
        : 0.5;

    if (bar.isVault) {
      if (bar.open) {
        // Flush inlaid brass corner brackets (`Z <= 0.014` so sliding blocks never clip)
        for (const cx of [minC + 0.14, maxC + 0.86]) {
          for (const cy of [minR + 0.14, maxR + 0.86]) {
            rctx.drawMesh(
              gl,
              ENVIRONMENT_MESHES.unitParticleCube,
              cx,
              cy,
              0.008,
              0.22,
              0.22,
              0.012,
              0.78,
              0.62,
              0.3,
              0.92
            );
          }
        }
        continue;
      }

      // Closed 3D Carved Sanctuary Vault Lid (`VAULT-01`)
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        bcx,
        bcy,
        0.28,
        spanW - 0.06,
        spanH - 0.06,
        0.54,
        0.86 + 0.06 * portPulse,
        0.68 + 0.06 * portPulse,
        0.3,
        1.0
      );
      const slabR = Math.min(1, palette.wallColor[0] * 0.45 + 0.16);
      const slabG = Math.min(1, palette.wallColor[1] * 0.42 + 0.14);
      const slabB = Math.min(1, palette.wallColor[2] * 0.55 + 0.3);
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        bcx,
        bcy,
        0.31,
        spanW - 0.22,
        spanH - 0.22,
        0.56,
        slabR,
        slabG,
        slabB,
        1.0
      );
      const ribCount = Math.max(3, spanH * 2);
      for (let ri = 0; ri < ribCount; ri++) {
        const ry = minR + 0.22 + ((ri + 0.5) / ribCount) * (spanH - 0.44);
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          bcx,
          ry,
          0.6,
          spanW - 0.3,
          0.1,
          0.036,
          Math.min(1, slabR + 0.08),
          Math.min(1, slabG + 0.07),
          Math.min(1, slabB + 0.1),
          1.0
        );
      }
      for (const cx of [minC + 0.2, maxC + 0.8]) {
        for (const cy of [minR + 0.2, maxR + 0.8]) {
          rctx.drawMesh(
            gl,
            ENVIRONMENT_MESHES.unitParticleCube,
            cx,
            cy,
            0.6,
            0.18,
            0.18,
            0.05,
            0.94,
            0.78,
            0.38,
            1.0
          );
        }
      }
      if (isStoneRuin) {
        continue;
      }
      const isKeyOnly = Boolean(bar.lockId && bar.lockId > 0 && bar.shredsRemaining <= 0);
      const medBobZ = !rctx.lastOptions.reducedMotion
        ? Math.sin(timeSec * 2.6 + bar.id) * 0.014 * live3DMix
        : 0;
      const medZ = rctx.drawBadgeMedallion3D(
        gl,
        bcx,
        bcy,
        0.635 + medBobZ,
        isKeyOnly ? 0.58 : 0.84,
        0.52,
        0.36,
        0.24,
        0.12,
        0.98,
        0.84,
        0.44
      );
      if (isKeyOnly) {
        rctx.drawAtlasBadge(gl, 'BADGE_KEY', bcx, bcy, medZ, 0.44, 1.0, 0.9, 0.35, 1.0);
      } else {
        const twoDigit = bar.shredsRemaining >= 10;
        rctx.drawAtlasBadge(
          gl,
          'BADGE_LOCK',
          bcx - (twoDigit ? 0.22 : 0.17),
          bcy,
          medZ,
          twoDigit ? 0.34 : 0.38,
          1.0,
          0.9,
          0.38,
          1.0
        );
        rctx.drawNumberBadges(
          gl,
          bar.shredsRemaining,
          bcx + (twoDigit ? 0.14 : 0.16),
          bcy,
          medZ,
          twoDigit ? 0.29 : 0.35,
          1.0,
          0.98,
          0.92
        );
      }
      continue;
    }

    // Flush inlaid brass & obsidian threshold track across the barrier cells (visible both open and closed)
    rctx.drawMesh(
      gl,
      ENVIRONMENT_MESHES.unitParticleCube,
      bcx,
      bcy,
      0.008,
      spanW - 0.08,
      spanH - 0.08,
      0.016,
      0.58,
      0.46,
      0.24,
      0.92
    );
    rctx.drawMesh(
      gl,
      ENVIRONMENT_MESHES.unitParticleCube,
      bcx,
      bcy,
      0.012,
      isHoriz ? spanW - 0.14 : 0.24,
      isHoriz ? 0.24 : spanH - 0.14,
      0.02,
      0.22,
      0.18,
      0.14,
      0.96
    );

    if (bar.open) {
      // Retracted threshold side-bollards at the two outer ends of the opened doorway
      const endOffset = (barLen - 0.22) * 0.5;
      for (const sign of [-1, 1]) {
        const px = isHoriz ? bcx + sign * endOffset : bcx;
        const py = isHoriz ? bcy : bcy + sign * endOffset;
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          px,
          py,
          0.03,
          0.18,
          0.18,
          0.06,
          0.84,
          0.68,
          0.34,
          0.95
        );
      }
      continue;
    }

    // Subtle golden threshold floor aura beneath the closed portcullis (hidden in static Stone Ruin mode)
    if (!isStoneRuin) {
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.overlayQuad,
        minC + 0.06,
        minR + 0.06,
        0.018,
        spanW - 0.12,
        spanH - 0.12,
        1.0,
        0.98,
        0.8,
        0.32,
        0.18 + 0.1 * portPulse,
        0,
        0,
        4
      );
    }

    // Twin sculpted stone-and-brass jamb pillars at the two ends of the portcullis span
    const pillarOffset = Math.max(0.32, barLen * 0.5 - 0.16);
    const jambR = Math.min(1, palette.wallColor[0] * 0.65 + 0.16);
    const jambG = Math.min(1, palette.wallColor[1] * 0.65 + 0.14);
    const jambB = Math.min(1, palette.wallColor[2] * 0.65 + 0.18);
    for (const sign of [-1, 1]) {
      const px = isHoriz ? bcx + sign * pillarOffset : bcx;
      const py = isHoriz ? bcy : bcy + sign * pillarOffset;
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        px,
        py,
        0.32,
        isHoriz ? 0.26 : 0.62,
        isHoriz ? 0.62 : 0.26,
        0.64,
        jambR,
        jambG,
        jambB,
        1.0
      );
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        px,
        py,
        0.65,
        isHoriz ? 0.3 : 0.66,
        isHoriz ? 0.66 : 0.3,
        0.06,
        0.92,
        0.76,
        0.38,
        1.0
      );
    }

    // Upper sculpted bronze-gold lintel beam + lower sill beam
    rctx.drawMesh(
      gl,
      ENVIRONMENT_MESHES.unitParticleCube,
      bcx,
      bcy,
      0.54,
      isHoriz ? spanW - 0.12 : 0.42,
      isHoriz ? 0.42 : spanH - 0.12,
      0.14,
      0.88 + 0.08 * portPulse,
      0.72 + 0.08 * portPulse,
      0.34,
      1.0
    );
    rctx.drawMesh(
      gl,
      ENVIRONMENT_MESHES.unitParticleCube,
      bcx,
      bcy,
      0.08,
      isHoriz ? spanW - 0.16 : 0.36,
      isHoriz ? 0.36 : spanH - 0.16,
      0.12,
      0.72,
      0.58,
      0.28,
      1.0
    );

    // Vertical 3D golden portcullis spears along the span
    const barCount = Math.max(3, barLen * 2 + 1);
    for (let bi = 0; bi < barCount; bi++) {
      const frac = (bi + 0.5) / barCount - 0.5;
      const bx = isHoriz ? bcx + frac * (barLen - 0.32) : bcx;
      const by = isHoriz ? bcy : bcy + frac * (barLen - 0.32);
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        bx,
        by,
        0.31,
        0.09,
        0.09,
        0.42,
        0.95,
        0.82,
        0.42,
        1.0
      );
    }

    // Central 3D Sculpted Portcullis Medallion (`BADGE_PORTCULLIS` + `shredsRemaining` or `BADGE_KEY`)
    if (isStoneRuin) {
      continue;
    }
    const isKeyOnly = Boolean(bar.lockId && bar.lockId > 0 && bar.shredsRemaining <= 0);
    const medBobZ = !rctx.lastOptions.reducedMotion
      ? Math.sin(timeSec * 2.6 + bar.id) * 0.015 * live3DMix
      : 0;
    const medZ = rctx.drawBadgeMedallion3D(
      gl,
      bcx,
      bcy,
      0.615 + medBobZ,
      isKeyOnly ? 0.54 : 0.78,
      0.48,
      0.32,
      0.24,
      0.14,
      0.96,
      0.82,
      0.42
    );
    if (isKeyOnly) {
      rctx.drawAtlasBadge(gl, 'BADGE_KEY', bcx, bcy, medZ, 0.44, 1.0, 0.9, 0.35, 1.0);
    } else {
      const twoDigit = bar.shredsRemaining >= 10;
      rctx.drawAtlasBadge(
        gl,
        'BADGE_PORTCULLIS',
        bcx - (twoDigit ? 0.21 : 0.16),
        bcy,
        medZ,
        twoDigit ? 0.34 : 0.38,
        1.0,
        0.9,
        0.38,
        1.0
      );
      rctx.drawNumberBadges(
        gl,
        bar.shredsRemaining,
        bcx + (twoDigit ? 0.16 : 0.15),
        bcy,
        medZ + 0.002,
        twoDigit ? 0.32 : 0.36,
        1.0,
        0.97,
        0.52
      );
    }
  }
}

export function renderPass2ReticleAndPromptsImpl(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  board: BoardState,
  options: RenderSceneOptions,
  highContrast: boolean,
  pulse: number
): void {
  if ((options.blueprintMix ?? 0) > 0.45) {
    // Stone-relic mode: no gameplay UI, but RELIC-AWAKEN-01 glow shockwaves still sweep the board
    // during the Play transition (never on the idle Title Screen where mix === 1).
    if ((options.blueprintMix ?? 0) < 0.999) renderShockwaveRings(rctx, gl);
    return;
  }
  // 2A. Active Drag Floor Target Reticle, Origin Ghost Footprint & Gate Alignment Beam (`UX-01`, `ORIGIN-GHOST-01`)
  const draggedId = renderActiveDragReticleAndOriginFootprint(rctx, gl, board, options, highContrast, pulse);

  // 2B. Booster Targeting Highlights (`TARGET_HAMMER`, `TARGET_ROCKET`, `TARGET_VACUUM`)
  const inputMode = options.inputMode ?? 'DRAG';
  if (inputMode === 'TARGET_ROCKET') {
    const axis = options.rocketAxis ?? 'ROW';
    const hRow = options.hoverRow ?? -1;
    const hCol = options.hoverCol ?? -1;
    if (axis === 'ROW' && hRow >= 0 && hRow < board.rows) {
      for (let c = 0; c < board.cols; c++) {
        if (board.occupancy[hRow * board.cols + c] === -1) continue;
        const roomVis = rctx.getRoomVisualState(board, board.roomMap[hRow * board.cols + c] ?? 0);
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.overlayQuad,
          c + 0.02,
          hRow + 0.1,
          roomVis.zOffset + 0.025,
          0.96,
          0.8,
          1.0,
          1.0,
          0.35,
          0.2,
          (0.42 + 0.22 * pulse) * roomVis.luminanceMul,
          0,
          0,
          4
        );
      }
    } else if (axis === 'COL' && hCol >= 0 && hCol < board.cols) {
      for (let r = 0; r < board.rows; r++) {
        if (board.occupancy[r * board.cols + hCol] === -1) continue;
        const roomVis = rctx.getRoomVisualState(board, board.roomMap[r * board.cols + hCol] ?? 0);
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.overlayQuad,
          hCol + 0.1,
          r + 0.02,
          roomVis.zOffset + 0.025,
          0.8,
          0.96,
          1.0,
          1.0,
          0.35,
          0.2,
          (0.42 + 0.22 * pulse) * roomVis.luminanceMul,
          0,
          0,
          4
        );
      }
    }
  } else if (inputMode === 'TARGET_HAMMER' || inputMode === 'TARGET_VACUUM') {
    for (const b of board.blocks) {
      if (b.status !== 'ACTIVE') continue;
      if (isBlockInLockedRoom(board, b)) continue;
      const cId: ColorId = getActiveColor(b.colorStack, b.colorCursor);
      if (cId === 0 && inputMode === 'TARGET_VACUUM') continue;
      if (inputMode === 'TARGET_VACUUM' && (b.chained || b.ropeColor > 0 || b.iceCount > 0)) {
        continue;
      }
      const shape = getShape(b.shapeId);
      for (const [dr, dc] of shape.cells) {
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.overlayQuad,
          b.col + dc + 0.04,
          b.row + dr + 0.04,
          0.02,
          0.92,
          0.92,
          1.0,
          1.0,
          0.85,
          0.25,
          0.25 + 0.2 * pulse,
          0,
          0,
          4
        );
      }
    }

    if (inputMode === 'TARGET_HAMMER') {
      if (board.barriers) {
        for (const bar of board.barriers) {
          if (bar.open) continue;
          for (const [br, bc] of bar.cells) {
            rctx.drawMesh(
              gl,
              ENVIRONMENT_MESHES.overlayQuad,
              bc + 0.04,
              br + 0.04,
              0.025,
              0.92,
              0.92,
              1.0,
              1.0,
              0.85,
              0.25,
              0.28 + 0.22 * pulse,
              0,
              0,
              4
            );
          }
        }
      }
      for (const crate of board.crates) {
        if (crate.destroyed) continue;
        if (!isRoomUnlocked(board, board.roomMap[crate.row * board.cols + crate.col] ?? 0)) continue;
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.overlayQuad,
          crate.col + 0.04,
          crate.row + 0.04,
          0.02,
          0.92,
          0.92,
          1.0,
          1.0,
          0.85,
          0.25,
          0.25 + 0.2 * pulse,
          0,
          0,
          4
        );
      }
    }
  }

  // 2C. ZEN Mode Hint & Early-Stage Auto-Guide Trail (`board.hintMove` / `options.autoGuideMove`)
  const guideMove = board.hintMove ?? (draggedId === null ? options.autoGuideMove : null) ?? null;
  if (guideMove) {
    const hintBlock = board.blocks.find((b) => b.id === guideMove.blockId && b.status === 'ACTIVE');
    if (hintBlock) {
      const shape = getShape(hintBlock.shapeId);
      const { targetRow, targetCol } = guideMove;
      const hintColor: ColorId = getActiveColor(hintBlock.colorStack, hintBlock.colorCursor);
      const [hr, hg, hb] = rctx.getColorRgb(hintColor, highContrast);
      const frameR = Math.min(1, hr * 0.72 + 0.28);
      const frameG = Math.min(1, hg * 0.72 + 0.28);
      const frameB = Math.min(1, hb * 0.72 + 0.28);
      const frameAlpha = 0.62 + 0.26 * pulse;

      // Render hollow 3D beveled perimeter frame around target footprint (tinted in block's own color, never a solid yellow fill)
      const minC = targetCol + 0.05;
      const maxC = targetCol + shape.cols - 0.05;
      const minR = targetRow + 0.05;
      const maxR = targetRow + shape.rows - 0.05;
      const spanW = Math.max(0.2, maxC - minC);
      const spanH = Math.max(0.2, maxR - minR);
      const barThick = 0.075;
      const barZ = 0.022;
      // Top & bottom frame bars
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        minC + spanW * 0.5,
        minR + barThick * 0.5,
        barZ,
        spanW,
        barThick,
        0.028,
        frameR,
        frameG,
        frameB,
        frameAlpha,
        0,
        0,
        0
      );
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        minC + spanW * 0.5,
        maxR - barThick * 0.5,
        barZ,
        spanW,
        barThick,
        0.028,
        frameR,
        frameG,
        frameB,
        frameAlpha,
        0,
        0,
        0
      );
      // Left & right frame bars
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        minC + barThick * 0.5,
        minR + spanH * 0.5,
        barZ,
        barThick,
        spanH,
        0.028,
        frameR,
        frameG,
        frameB,
        frameAlpha,
        0,
        0,
        0
      );
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        maxC - barThick * 0.5,
        minR + spanH * 0.5,
        barZ,
        barThick,
        spanH,
        0.028,
        frameR,
        frameG,
        frameB,
        frameAlpha,
        0,
        0,
        0
      );

      // Animated stepping directional chevrons from source centroid to target centroid
      const startCx = hintBlock.col + shape.cols * 0.5;
      const startCy = hintBlock.row + shape.rows * 0.5;
      const endCx = targetCol + shape.cols * 0.5;
      const endCy = targetRow + shape.rows * 0.5;
      const dx = endCx - startCx;
      const dy = endCy - startCy;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.25) {
        const chevronKey = Math.abs(dx) >= Math.abs(dy) ? 'LOCK_H' : 'LOCK_V';
        const steps = 3;
        const timeSec = options.timeSec ?? (performance.now() - rctx.startTimeMs) * 0.001;
        for (let s = 0; s < steps; s++) {
          const rawT = options.reducedMotion ? (s + 1) / (steps + 1) : (s / steps + timeSec * 0.75) % 1.0;
          const px = startCx + dx * rawT;
          const py = startCy + dy * rawT;
          const alpha = Math.sin(rawT * Math.PI) * 0.78;
          rctx.drawAtlasBadge(gl, chevronKey, px, py, 0.028, 0.36, frameR, frameG, frameB, alpha);
        }
      }
    }
  }

  // 2D. Post-Move / Post-Shred Mystic Fissure Path-Tracing Flourish (`MYSTIC-TRACE-01`)
  renderMysticPathTraces3D(rctx, gl, options, highContrast);

  // 2E. Expanding 3D Knock-On & Shredding Shockwave Rings (`rctx.activeShockwaves`, `R3D-08`)
  renderShockwaveRings(rctx, gl);
}

function renderShockwaveRings(rctx: RenderPassContext, gl: WebGL2RenderingContext): void {
  if (rctx.activeShockwaves.length > 0) {
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    for (const sw of rctx.activeShockwaves) {
      const progress = Math.min(1, sw.age / sw.maxAge);
      const eased = 1 - (1 - progress) * (1 - progress);
      const radius = sw.minRadius + (sw.maxRadius - sw.minRadius) * eased;
      const alpha = (1 - progress) * 0.88;
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.shockwaveRingMesh,
        sw.cx,
        sw.cy,
        sw.z,
        radius * 2,
        radius * 2,
        1.0,
        sw.r,
        sw.g,
        sw.b,
        alpha,
        0,
        0,
        4
      );
    }
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
  }
}
