import { getShape } from '../core/polyomino';
import type { BoardState, ColorId } from '../core/types';
import { ENVIRONMENT_MESHES } from './mesh-generator';
import {
  drawToneOnToneSigil3D,
  type RenderPassContext,
  STONE_SURFACE_STYLE,
  TRAY_WALL_STYLE,
  type TrayPalette,
} from './render-types';

export function renderPass1Courtyard(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  board: BoardState,
  palette: TrayPalette,
  highContrast: boolean,
  colorblind: boolean,
  timeSec: number
): void {
  const { rows, cols, occupancy, floorColor } = board;
  const isStoneRuin = (rctx.lastOptions.blueprintMix ?? 0) > 0.45;
  const isCellPlayable = (r: number, c: number): boolean =>
    r >= 0 && r < rows && c >= 0 && c < cols && occupancy[r * cols + c] !== -1;

  // 1A. Contoured Stepped Sanctuary Pedestal Plinth (merged contiguous spans to minimize draw calls & overdraw)
  const plinthSpans: Array<{ r0: number; r1: number; c0: number; c1: number; roomId: number }> = [];
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (!isCellPlayable(r, c)) {
        c++;
        continue;
      }
      const roomId = board.roomMap[r * cols + c] ?? 0;
      const c0 = c;
      while (
        c + 1 < cols &&
        isCellPlayable(r, c + 1) &&
        (board.roomMap[r * cols + (c + 1)] ?? 0) === roomId
      ) {
        c++;
      }
      const c1 = c;
      const prev = plinthSpans.find(
        (s) => s.r1 === r - 1 && s.c0 === c0 && s.c1 === c1 && s.roomId === roomId
      );
      if (prev) {
        prev.r1 = r;
      } else {
        plinthSpans.push({ r0: r, r1: r, c0, c1, roomId });
      }
      c++;
    }
  }

  for (const span of plinthSpans) {
    const roomVis = rctx.getRoomVisualState(board, span.roomId);
    const zOff = roomVis.zOffset;
    const lum = roomVis.luminanceMul;
    let bordersDiffRoomTop = false;
    let bordersDiffRoomBot = false;
    for (let c = span.c0; c <= span.c1; c++) {
      if (
        span.r0 > 0 &&
        isCellPlayable(span.r0 - 1, c) &&
        (board.roomMap[(span.r0 - 1) * cols + c] ?? 0) !== span.roomId
      ) {
        bordersDiffRoomTop = true;
      }
      if (
        span.r1 < rows - 1 &&
        isCellPlayable(span.r1 + 1, c) &&
        (board.roomMap[(span.r1 + 1) * cols + c] ?? 0) !== span.roomId
      ) {
        bordersDiffRoomBot = true;
      }
    }
    let bordersDiffRoomLeft = false;
    let bordersDiffRoomRight = false;
    for (let r = span.r0; r <= span.r1; r++) {
      if (
        span.c0 > 0 &&
        isCellPlayable(r, span.c0 - 1) &&
        (board.roomMap[r * cols + (span.c0 - 1)] ?? 0) !== span.roomId
      ) {
        bordersDiffRoomLeft = true;
      }
      if (
        span.c1 < cols - 1 &&
        isCellPlayable(r, span.c1 + 1) &&
        (board.roomMap[r * cols + (span.c1 + 1)] ?? 0) !== span.roomId
      ) {
        bordersDiffRoomRight = true;
      }
    }

    const stepL = bordersDiffRoomLeft ? 0.02 : 0.55;
    const stepR = bordersDiffRoomRight ? 0.02 : 0.55;
    const stepT = bordersDiffRoomTop ? 0.02 : 0.55;
    const stepB = bordersDiffRoomBot ? 0.02 : 0.55;
    const spanW = span.c1 - span.c0 + 1;
    const spanH = span.r1 - span.r0 + 1;

    rctx.drawMesh(
      gl,
      ENVIRONMENT_MESHES.wallSegment,
      span.c0 - stepL,
      span.r0 - stepT,
      -0.34 + zOff * 0.45,
      spanW + stepL + stepR,
      spanH + stepT + stepB,
      0.16,
      palette.wallColor[0] * 0.56 * lum,
      palette.wallColor[1] * 0.55 * lum,
      palette.wallColor[2] * 0.62 * lum,
      1.0,
      0,
      0,
      TRAY_WALL_STYLE
    );

    const padL = bordersDiffRoomLeft ? 0.02 : 0.38;
    const padR = bordersDiffRoomRight ? 0.02 : 0.38;
    const padT = bordersDiffRoomTop ? 0.02 : 0.38;
    const padB = bordersDiffRoomBot ? 0.02 : 0.38;
    rctx.drawMesh(
      gl,
      ENVIRONMENT_MESHES.wallSegment,
      span.c0 - padL,
      span.r0 - padT,
      -0.18 + zOff * 0.65,
      spanW + padL + padR,
      spanH + padT + padB,
      0.18,
      palette.wallColor[0] * 0.78 * lum,
      palette.wallColor[1] * 0.76 * lum,
      palette.wallColor[2] * 0.82 * lum,
      1.0,
      0,
      0,
      TRAY_WALL_STYLE
    );
  }

  // 1B. Interior Floor Tiles, Sunken Twilight Veil, Pillars & Floor Paths
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const occ = occupancy[idx];

      if (occ === -1) {
        // Exterior VOID cell (`COURTYARD-01`): carved completely away into open negative space!
        continue;
      }

      const roomId = board.roomMap[idx] ?? 0;
      const roomVis = rctx.getRoomVisualState(board, roomId);
      const zOff = roomVis.zOffset;
      const lum = roomVis.luminanceMul;

      const checker = (r + c) % 2 === 0 ? palette.floorTileA : palette.floorTileB;
      const primaryWave = Math.max(0, Math.sin(timeSec * 1.1 - (c * 0.58 + r * 0.46))) ** 3;
      const crossWave = Math.max(0, Math.cos(timeSec * 0.8 + (c - r) * 0.52)) ** 4;
      const sheen =
        !isStoneRuin && !rctx.lastOptions.reducedMotion && !roomVis.isLocked
          ? primaryWave * 0.048 + crossWave * 0.022
          : 0;
      const pathColorId = isStoneRuin ? (0 as ColorId) : ((floorColor[idx] ?? 0) as ColorId);

      if (pathColorId > 0) {
        const [pr, pg, pb] = rctx.getColorRgb(pathColorId, highContrast);
        const pMix = colorblind ? 0.76 : 0.62;
        const cMix = 1 - pMix;
        const tileR = Math.min(1, (pr * pMix + checker[0] * cMix + sheen) * lum);
        const tileG = Math.min(1, (pg * pMix + checker[1] * cMix + sheen) * lum);
        const tileB = Math.min(1, (pb * pMix + checker[2] * cMix + sheen * 0.7) * lum);
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.trayFloorTile,
          c,
          r,
          zOff,
          1.0,
          1.0,
          1.0,
          tileR,
          tileG,
          tileB,
          1.0,
          0,
          0,
          STONE_SURFACE_STYLE
        );
        if (colorblind) {
          const tileLum = tileR * 0.2126 + tileG * 0.7152 + tileB * 0.0722;
          drawToneOnToneSigil3D(
            rctx,
            gl,
            pathColorId,
            c + 0.5,
            r + 0.5,
            zOff + 0.008,
            0.46,
            lum,
            highContrast,
            tileLum < 0.18
          );
        }
      } else {
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.trayFloorTile,
          c,
          r,
          zOff,
          1.0,
          1.0,
          1.0,
          Math.min(1, (checker[0] + sheen) * lum),
          Math.min(1, (checker[1] + sheen * 0.9) * lum),
          Math.min(1, (checker[2] + sheen * 0.65) * lum + (1 - lum) * 0.05),
          1.0,
          0,
          0,
          STONE_SURFACE_STYLE
        );
      }

      // Interior Stone Pillar (`occ === -2`): Fixed architectural wall column (devoid of floating UI badges in Stone Ruin mode)
      if (occ === -2) {
        const pr = Math.min(1, palette.wallColor[0] * 1.38 * lum);
        const pg = Math.min(1, palette.wallColor[1] * 1.38 * lum);
        const pb = Math.min(1, palette.wallColor[2] * 1.38 * lum);
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.pillarMesh,
          c,
          r,
          zOff,
          1.0,
          1.0,
          1.0,
          pr,
          pg,
          pb,
          1.0,
          0,
          0,
          TRAY_WALL_STYLE
        );
        if (!isStoneRuin) {
          const pillarBobZ =
            !rctx.lastOptions.reducedMotion && !roomVis.isLocked
              ? Math.sin(timeSec * 2.8 + r * 0.9 + c * 1.1) * 0.024
              : 0;
          const pillarSpinZ =
            !rctx.lastOptions.reducedMotion && !roomVis.isLocked
              ? Math.PI * 0.25 + timeSec * 0.95
              : Math.PI * 0.25;
          rctx.drawMesh(
            gl,
            ENVIRONMENT_MESHES.unitParticleCube,
            c + 0.5,
            r + 0.5,
            zOff + 0.652 + pillarBobZ,
            0.38,
            0.38,
            0.056,
            Math.min(1, pr * 0.85 + 0.22 * lum),
            Math.min(1, pg * 0.82 + 0.18 * lum),
            Math.min(1, pb * 0.78 + 0.12 * lum),
            1.0,
            0,
            pillarSpinZ,
            0
          );
          rctx.drawAtlasBadge(
            gl,
            'DIAMOND',
            c + 0.5,
            r + 0.5,
            zOff + 0.686 + pillarBobZ,
            0.36,
            0.98 * lum,
            0.86 * lum,
            0.58 * lum,
            0.95
          );
        }
      }
    }
  }

  // 1C. Moving Elevator Platforms (`board.elevators`)
  for (const elev of board.elevators) {
    const elevRoomId = board.roomMap[elev.row * cols + elev.col] ?? 0;
    const elevVis = rctx.getRoomVisualState(board, elevRoomId);
    const zOff = elevVis.zOffset;
    const lum = elevVis.luminanceMul;
    const dir = elev.atAlternatePos ? -1 : 1;
    const targetR = elev.row + elev.deltaRow * dir;
    const targetC = elev.col + elev.deltaCol * dir;

    const minR = Math.min(elev.row, targetR);
    const minC = Math.min(elev.col, targetC);
    const spanR = Math.abs(targetR - elev.row) + elev.height;
    const spanC = Math.abs(targetC - elev.col) + elev.width;
    const isHorizTrack = Math.abs(elev.deltaCol) >= Math.abs(elev.deltaRow);
    if (!isStoneRuin && isHorizTrack) {
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        minC + spanC * 0.5,
        minR + 0.22,
        zOff + 0.014,
        spanC - 0.24,
        0.08,
        0.028,
        0.36 * lum,
        0.66 * lum,
        0.86 * lum,
        0.88,
        0,
        0,
        0
      );
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        minC + spanC * 0.5,
        minR + spanR - 0.22,
        zOff + 0.014,
        spanC - 0.24,
        0.08,
        0.028,
        0.36 * lum,
        0.66 * lum,
        0.86 * lum,
        0.88,
        0,
        0,
        0
      );
    } else if (!isStoneRuin) {
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        minC + 0.22,
        minR + spanR * 0.5,
        zOff + 0.014,
        0.08,
        spanR - 0.24,
        0.028,
        0.36 * lum,
        0.66 * lum,
        0.86 * lum,
        0.88,
        0,
        0,
        0
      );
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        minC + spanC - 0.22,
        minR + spanR * 0.5,
        zOff + 0.014,
        0.08,
        spanR - 0.24,
        0.028,
        0.36 * lum,
        0.66 * lum,
        0.86 * lum,
        0.88,
        0,
        0,
        0
      );
    }

    rctx.drawMesh(
      gl,
      ENVIRONMENT_MESHES.elevatorMesh,
      elev.col,
      elev.row,
      zOff,
      elev.width,
      elev.height,
      1.0,
      0.32 * lum,
      0.58 * lum,
      0.78 * lum,
      1.0
    );
    if (!isStoneRuin) {
      const chevronKey = isHorizTrack ? 'LOCK_H' : 'LOCK_V';
      const elevBadgeZ = rctx.drawBadgeMedallion3D(
        gl,
        elev.col + elev.width * 0.5,
        elev.row + elev.height * 0.5,
        zOff + 0.032,
        isHorizTrack ? 0.52 : 0.38,
        isHorizTrack ? 0.38 : 0.52,
        0.32 * lum,
        0.58 * lum,
        0.78 * lum
      );
      rctx.drawAtlasBadge(
        gl,
        chevronKey,
        elev.col + elev.width * 0.5,
        elev.row + elev.height * 0.5,
        elevBadgeZ,
        0.42,
        0.92 * lum,
        0.98 * lum,
        1.0 * lum,
        0.95
      );
    }
  }

  // 1D. Wooden Crates (`board.crates`)
  for (const crate of board.crates) {
    if (crate.destroyed || crate.hp <= 0) continue;
    const crateRoomId = board.roomMap[crate.row * cols + crate.col] ?? 0;
    const crateVis = rctx.getRoomVisualState(board, crateRoomId);
    const zOff = crateVis.zOffset;
    const lum = crateVis.luminanceMul;
    const hpRatio = crate.hp / Math.max(1, crate.maxHp);
    const cr = (0.68 + 0.12 * hpRatio) * lum;
    const cg = (0.44 + 0.1 * hpRatio) * lum;
    const cb = (0.2 + 0.06 * hpRatio) * lum;
    rctx.drawMesh(
      gl,
      ENVIRONMENT_MESHES.crateMesh,
      crate.col,
      crate.row,
      zOff,
      1.0,
      1.0,
      1.0,
      cr,
      cg,
      cb,
      1.0,
      0,
      0,
      2
    );
    if (!isStoneRuin) {
      const crateBadgeZ = rctx.drawBadgeMedallion3D(
        gl,
        crate.col + 0.5,
        crate.row + 0.5,
        zOff + 0.585,
        0.46,
        0.42,
        cr,
        cg,
        cb
      );
      rctx.drawNumberBadges(
        gl,
        crate.hp,
        crate.col + 0.5,
        crate.row + 0.5,
        crateBadgeZ,
        0.38,
        1.0 * lum,
        0.96 * lum,
        0.84 * lum
      );
    }
  }

  // 1E. Block Generators (`board.generators`)
  for (const gen of board.generators) {
    const genRoomId = board.roomMap[gen.row * cols + gen.col] ?? 0;
    const genVis = rctx.getRoomVisualState(board, genRoomId);
    const zOff = genVis.zOffset;
    const lum = genVis.luminanceMul;
    const depleted = gen.state === 'DEPLETED' || gen.queueCursor >= gen.queue.length;
    const gr = (depleted ? 0.25 : 0.35) * lum;
    const gg = (depleted ? 0.28 : 0.42) * lum;
    const gb = (depleted ? 0.32 : 0.55) * lum;
    rctx.drawMesh(
      gl,
      ENVIRONMENT_MESHES.generatorMesh,
      gen.col,
      gen.row,
      zOff,
      1.0,
      1.0,
      1.0,
      gr,
      gg,
      gb,
      1.0
    );

    if (!depleted && !isStoneRuin) {
      const nextSpec = gen.queue[gen.queueCursor];
      if (nextSpec && nextSpec.colorStack.length > 0) {
        const nextColor = nextSpec.colorStack[0];
        const [rawNr, rawNg, rawNb] = rctx.getColorRgb(nextColor, highContrast);
        const nr = rawNr * lum;
        const ng = rawNg * lum;
        const nb = rawNb * lum;

        const genPulse =
          !rctx.lastOptions.reducedMotion && !genVis.isLocked
            ? 0.5 + 0.5 * Math.sin(timeSec * 3.8 + gen.col * 0.9)
            : 0.5;
        const spawnShape = getShape(nextSpec.shapeId);
        for (const [dr, dc] of spawnShape.cells) {
          const sc = gen.spawnCol + dc;
          const sr = gen.spawnRow + dr;
          if (sc >= 0 && sc < cols && sr >= 0 && sr < rows) {
            rctx.drawMesh(
              gl,
              ENVIRONMENT_MESHES.overlayQuad,
              sc + 0.06,
              sr + 0.06,
              zOff + 0.006,
              0.88,
              0.88,
              1.0,
              nr,
              ng,
              nb,
              0.24 + 0.22 * genPulse,
              0,
              0,
              4
            );
          }
        }

        const previewBobZ =
          !rctx.lastOptions.reducedMotion && !genVis.isLocked ? Math.sin(timeSec * 3.8 + gen.col) * 0.034 : 0;
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          gen.col + 0.5,
          gen.row + 0.34,
          zOff + 0.735 + previewBobZ,
          0.62,
          0.36,
          0.065,
          nr,
          ng,
          nb,
          1.0,
          0,
          0,
          0
        );
        if (colorblind) {
          drawToneOnToneSigil3D(
            rctx,
            gl,
            nextColor,
            gen.col + 0.5,
            gen.row + 0.34,
            zOff + 0.774 + previewBobZ,
            0.29,
            lum,
            highContrast,
            false
          );
        }
      }
      const genBadgeZ = rctx.drawBadgeMedallion3D(
        gl,
        gen.col + 0.5,
        gen.row + 0.68,
        zOff + 0.705,
        0.68,
        0.32,
        gr,
        gg,
        gb
      );
      rctx.drawAtlasBadge(
        gl,
        'BADGE_GENERATOR',
        gen.col + 0.34,
        gen.row + 0.68,
        genBadgeZ,
        0.3,
        1.0 * lum,
        0.92 * lum,
        0.25 * lum,
        1.0
      );
      rctx.drawNumberBadges(
        gl,
        gen.cooldown,
        gen.col + 0.66,
        gen.row + 0.68,
        genBadgeZ + 0.002,
        0.3,
        lum,
        lum,
        lum
      );
    }
  }
}
