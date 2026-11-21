import { getShape } from '../core/polyomino';
import type { BoardState } from '../core/types';
import { MESH_INSTANCE_STRIDE } from './gl-program-state';
import { ENVIRONMENT_MESHES } from './mesh-generator';
import { acquirePass1InstanceScratch, getOrBuildStaticPass1Topology } from './pass1-board-cache';
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
  const { rows, cols } = board;
  const isStoneRuin = (rctx.lastOptions.blueprintMix ?? 0) > 0.45;
  const reducedMotion = Boolean(rctx.lastOptions.reducedMotion);
  const topo = getOrBuildStaticPass1Topology(board);

  // 1A. Contoured Stepped Sanctuary Pedestal Plinth (cached per BoardState & batched into 1 instanced draw)
  const plinthCount = topo.plinthSpans.length * 2;
  if (plinthCount > 0) {
    const [wr, wg, wb] = palette.wallColor;
    if (rctx.drawMeshInstanced) {
      const buf = acquirePass1InstanceScratch(plinthCount);
      let ptr = 0;
      for (const span of topo.plinthSpans) {
        const roomVis = rctx.getRoomVisualState(board, span.roomId);
        const zOff = roomVis.zOffset;
        const lum = roomVis.luminanceMul;
        buf[ptr] = span.lowerX;
        buf[ptr + 1] = span.lowerY;
        buf[ptr + 2] = -0.34 + zOff * 0.45;
        buf[ptr + 3] = span.lowerW;
        buf[ptr + 4] = span.lowerH;
        buf[ptr + 5] = 0.16;
        buf[ptr + 6] = wr * 0.56 * lum;
        buf[ptr + 7] = wg * 0.55 * lum;
        buf[ptr + 8] = wb * 0.62 * lum;
        ptr += MESH_INSTANCE_STRIDE;

        buf[ptr] = span.upperX;
        buf[ptr + 1] = span.upperY;
        buf[ptr + 2] = -0.18 + zOff * 0.65;
        buf[ptr + 3] = span.upperW;
        buf[ptr + 4] = span.upperH;
        buf[ptr + 5] = 0.18;
        buf[ptr + 6] = wr * 0.78 * lum;
        buf[ptr + 7] = wg * 0.76 * lum;
        buf[ptr + 8] = wb * 0.82 * lum;
        ptr += MESH_INSTANCE_STRIDE;
      }
      rctx.drawMeshInstanced(gl, ENVIRONMENT_MESHES.wallSegment, buf, plinthCount, 1.0, TRAY_WALL_STYLE);
    } else {
      for (const span of topo.plinthSpans) {
        const roomVis = rctx.getRoomVisualState(board, span.roomId);
        const zOff = roomVis.zOffset;
        const lum = roomVis.luminanceMul;
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.wallSegment,
          span.lowerX,
          span.lowerY,
          -0.34 + zOff * 0.45,
          span.lowerW,
          span.lowerH,
          0.16,
          wr * 0.56 * lum,
          wg * 0.55 * lum,
          wb * 0.62 * lum,
          1.0,
          0,
          0,
          TRAY_WALL_STYLE
        );
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.wallSegment,
          span.upperX,
          span.upperY,
          -0.18 + zOff * 0.65,
          span.upperW,
          span.upperH,
          0.18,
          wr * 0.78 * lum,
          wg * 0.76 * lum,
          wb * 0.82 * lum,
          1.0,
          0,
          0,
          TRAY_WALL_STYLE
        );
      }
    }
  }

  // 1B. Interior Floor Tiles (batched into 1 instanced draw), Color-Filter Mosaic Runners & Pillars
  const tileCount = topo.playableTiles.length;
  const allowSheen = !isStoneRuin && !reducedMotion;
  if (tileCount > 0) {
    const tileA = palette.floorTileA;
    const tileB = palette.floorTileB;
    if (rctx.drawMeshInstanced) {
      const buf = acquirePass1InstanceScratch(tileCount);
      let ptr = 0;
      for (const tile of topo.playableTiles) {
        const roomVis = rctx.getRoomVisualState(board, tile.roomId);
        const lum = roomVis.luminanceMul;
        const checker = tile.isCheckerA ? tileA : tileB;
        let sheen = 0;
        if (allowSheen && !roomVis.isLocked) {
          const primaryWave = Math.max(0, Math.sin(timeSec * 1.1 - (tile.c * 0.58 + tile.r * 0.46))) ** 3;
          const crossWave = Math.max(0, Math.cos(timeSec * 0.8 + (tile.c - tile.r) * 0.52)) ** 4;
          sheen = primaryWave * 0.048 + crossWave * 0.022;
        }
        buf[ptr] = tile.c;
        buf[ptr + 1] = tile.r;
        buf[ptr + 2] = roomVis.zOffset;
        buf[ptr + 3] = 1.0;
        buf[ptr + 4] = 1.0;
        buf[ptr + 5] = 1.0;
        buf[ptr + 6] = Math.min(1, (checker[0] + sheen) * lum);
        buf[ptr + 7] = Math.min(1, (checker[1] + sheen * 0.9) * lum);
        buf[ptr + 8] = Math.min(1, (checker[2] + sheen * 0.65) * lum + (1 - lum) * 0.05);
        ptr += MESH_INSTANCE_STRIDE;
      }
      rctx.drawMeshInstanced(gl, ENVIRONMENT_MESHES.trayFloorTile, buf, tileCount, 1.0, STONE_SURFACE_STYLE);
    } else {
      for (const tile of topo.playableTiles) {
        const roomVis = rctx.getRoomVisualState(board, tile.roomId);
        const lum = roomVis.luminanceMul;
        const checker = tile.isCheckerA ? tileA : tileB;
        let sheen = 0;
        if (allowSheen && !roomVis.isLocked) {
          const primaryWave = Math.max(0, Math.sin(timeSec * 1.1 - (tile.c * 0.58 + tile.r * 0.46))) ** 3;
          const crossWave = Math.max(0, Math.cos(timeSec * 0.8 + (tile.c - tile.r) * 0.52)) ** 4;
          sheen = primaryWave * 0.048 + crossWave * 0.022;
        }
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.trayFloorTile,
          tile.c,
          tile.r,
          roomVis.zOffset,
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
    }
  }

  // Dedicated Sanctuary Color-Filter Mosaic Runners (`FLOOR_PATHS`) — sparse cached iteration
  if (!isStoneRuin && topo.floorPathTiles.length > 0) {
    for (const fp of topo.floorPathTiles) {
      const roomVis = rctx.getRoomVisualState(board, fp.roomId);
      const zOff = roomVis.zOffset;
      const lum = roomVis.luminanceMul;
      let sheen = 0;
      if (allowSheen && !roomVis.isLocked) {
        const primaryWave = Math.max(0, Math.sin(timeSec * 1.1 - (fp.c * 0.58 + fp.r * 0.46))) ** 3;
        const crossWave = Math.max(0, Math.cos(timeSec * 0.8 + (fp.c - fp.r) * 0.52)) ** 4;
        sheen = primaryWave * 0.048 + crossWave * 0.022;
      }
      const [pr, pg, pb] = rctx.getColorRgb(fp.colorId, highContrast);
      const sheenBoost = sheen * 0.45;
      const padR = Math.min(1, (pr * 0.84 + sheenBoost) * lum);
      const padG = Math.min(1, (pg * 0.84 + sheenBoost) * lum);
      const padB = Math.min(1, (pb * 0.84 + sheenBoost * 0.7) * lum);
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        fp.padCx,
        fp.padCy,
        zOff + 0.005,
        fp.padW,
        fp.padH,
        0.006,
        padR,
        padG,
        padB,
        1.0,
        0,
        0,
        0
      );

      const trimR = Math.min(1, pr * 0.55 + 0.42) * lum;
      const trimG = Math.min(1, pg * 0.55 + 0.4) * lum;
      const trimB = Math.min(1, pb * 0.55 + 0.36) * lum;
      const railW = 0.042;
      if (!fp.sameTop) {
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          fp.padCx,
          fp.y0 + railW * 0.5,
          zOff + 0.006,
          fp.padW,
          railW,
          0.0085,
          trimR,
          trimG,
          trimB,
          1.0,
          0,
          0,
          0
        );
      }
      if (!fp.sameBot) {
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          fp.padCx,
          fp.y1 - railW * 0.5,
          zOff + 0.006,
          fp.padW,
          railW,
          0.0085,
          trimR,
          trimG,
          trimB,
          1.0,
          0,
          0,
          0
        );
      }
      if (!fp.sameLeft) {
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          fp.x0 + railW * 0.5,
          fp.padCy,
          zOff + 0.006,
          railW,
          fp.padH,
          0.0085,
          trimR,
          trimG,
          trimB,
          1.0,
          0,
          0,
          0
        );
      }
      if (!fp.sameRight) {
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          fp.x1 - railW * 0.5,
          fp.padCy,
          zOff + 0.006,
          railW,
          fp.padH,
          0.0085,
          trimR,
          trimG,
          trimB,
          1.0,
          0,
          0,
          0
        );
      }

      if (colorblind) {
        const tileLum = padR * 0.2126 + padG * 0.7152 + padB * 0.0722;
        drawToneOnToneSigil3D(
          rctx,
          gl,
          fp.colorId,
          fp.c + 0.5,
          fp.r + 0.5,
          zOff + 0.0128,
          0.46,
          lum,
          highContrast,
          tileLum < 0.18
        );
      } else {
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          fp.c + 0.5,
          fp.r + 0.5,
          zOff + 0.0095,
          0.29,
          0.29,
          0.004,
          trimR,
          trimG,
          trimB,
          0.94,
          0,
          Math.PI * 0.25,
          0
        );
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          fp.c + 0.5,
          fp.r + 0.5,
          zOff + 0.0105,
          0.2,
          0.2,
          0.004,
          pr * 0.68 * lum,
          pg * 0.68 * lum,
          pb * 0.68 * lum,
          1.0,
          0,
          Math.PI * 0.25,
          0
        );
        rctx.drawAtlasBadge(
          gl,
          'DIAMOND',
          fp.c + 0.5,
          fp.r + 0.5,
          zOff + 0.013,
          0.22,
          trimR,
          trimG,
          trimB,
          0.78
        );
      }
    }
  }

  // Interior Stone Pillars (`occ === -2`) — sparse cached iteration
  for (const pil of topo.pillarTiles) {
    const roomVis = rctx.getRoomVisualState(board, pil.roomId);
    const zOff = roomVis.zOffset;
    const lum = roomVis.luminanceMul;
    const pr = Math.min(1, palette.wallColor[0] * 1.38 * lum);
    const pg = Math.min(1, palette.wallColor[1] * 1.38 * lum);
    const pb = Math.min(1, palette.wallColor[2] * 1.38 * lum);
    rctx.drawMesh(
      gl,
      ENVIRONMENT_MESHES.pillarMesh,
      pil.c,
      pil.r,
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
      const pillarHoverZ =
        !reducedMotion && !roomVis.isLocked
          ? (0.5 + 0.5 * Math.sin(timeSec * 2.8 + pil.r * 0.9 + pil.c * 1.1)) * 0.032
          : 0.012;
      const pillarSpinZ =
        !reducedMotion && !roomVis.isLocked ? Math.PI * 0.25 + timeSec * 0.95 : Math.PI * 0.25;
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        pil.c + 0.5,
        pil.r + 0.5,
        zOff + 0.694 + pillarHoverZ,
        0.38,
        0.38,
        0.052,
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
        pil.c + 0.5,
        pil.r + 0.5,
        zOff + 0.726 + pillarHoverZ,
        0.36,
        0.98 * lum,
        0.86 * lum,
        0.58 * lum,
        0.95
      );
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
      const elevCx = elev.col + elev.width * 0.5;
      const elevCy = elev.row + elev.height * 0.5;
      const plaqueW = isHorizTrack ? 0.52 : 0.38;
      const plaqueH = isHorizTrack ? 0.38 : 0.52;
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        elevCx,
        elevCy,
        zOff + 0.054,
        plaqueW + 0.05,
        plaqueH + 0.05,
        0.008,
        0.92 * lum,
        0.8 * lum,
        0.52 * lum,
        1.0
      );
      rctx.drawMesh(
        gl,
        ENVIRONMENT_MESHES.unitParticleCube,
        elevCx,
        elevCy,
        zOff + 0.056,
        plaqueW,
        plaqueH,
        0.01,
        0.24 * lum,
        0.46 * lum,
        0.66 * lum,
        1.0
      );
      rctx.drawAtlasBadge(
        gl,
        chevronKey,
        elevCx,
        elevCy,
        zOff + 0.063,
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
        zOff + 0.602,
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

        const previewHoverZ =
          !rctx.lastOptions.reducedMotion && !genVis.isLocked
            ? (0.5 + 0.5 * Math.sin(timeSec * 3.8 + gen.col)) * 0.036
            : 0.018;
        rctx.drawMesh(
          gl,
          ENVIRONMENT_MESHES.unitParticleCube,
          gen.col + 0.5,
          gen.row + 0.31,
          zOff + 0.762 + previewHoverZ,
          0.62,
          0.34,
          0.064,
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
            gen.row + 0.31,
            zOff + 0.801 + previewHoverZ,
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
        gen.row + 0.71,
        zOff + 0.722,
        0.68,
        0.3,
        gr,
        gg,
        gb
      );
      rctx.drawAtlasBadge(
        gl,
        'BADGE_GENERATOR',
        gen.col + 0.34,
        gen.row + 0.71,
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
        gen.row + 0.71,
        genBadgeZ + 0.002,
        0.3,
        lum,
        lum,
        lum
      );
    }
  }
}
