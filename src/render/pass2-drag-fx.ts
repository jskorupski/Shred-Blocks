import { findEligibleGateForBlockAt, getGateOutwardNormal } from '../core/gate-clearance';
import { canGroupOccupyOffset, getMovedGroupBlocks } from '../core/physics';
import { getActiveColor, getShape, type PolyominoShape } from '../core/polyomino';
import type { Benchmark120HzResult, BoardState, ColorId } from '../core/types';
import { ENVIRONMENT_MESHES } from './mesh-generator';
import {
  buildTraceSegments,
  DEFAULT_TRACE_MAX_AGE_SEC,
  fillTraceUniformWindow,
  MAX_TRACE_UNIFORM_PTS,
  type PathTraceSegment,
  type PathWaypoint,
  type VisualPathTrace,
} from './path-trace-ribbon';
import type { RenderPassContext, RenderSceneOptions } from './render-types';

export { buildTraceSegments, type PathTraceSegment, type PathWaypoint, type VisualPathTrace };

const TRACE_UNIFORM_BUF = new Float32Array(MAX_TRACE_UNIFORM_PTS * 4);

/**
 * Returns the `(offsetX, offsetY)` from `(block.col, block.row)` to the center of the occupied cell
 * closest to the shape's geometric center so badges and traces always sit on solid block cells
 * even for non-convex `U`, `L`, `J`, or `T` polyominoes.
 */
export function getShapeAnchorCellOffset(shape: PolyominoShape): { x: number; y: number } {
  const targetR = shape.rows * 0.5;
  const targetC = shape.cols * 0.5;
  let bestDr = shape.cells[0]?.[0] ?? 0;
  let bestDc = shape.cells[0]?.[1] ?? 0;
  let bestDist = Infinity;
  for (const [dr, dc] of shape.cells) {
    const d = Math.hypot(dc + 0.5 - targetC, dr + 0.5 - targetR);
    if (d < bestDist) {
      bestDist = d;
      bestDr = dr;
      bestDc = dc;
    }
  }
  return { x: bestDc + 0.5, y: bestDr + 0.5 };
}

export function spawnPathTraceImpl(
  rctx: RenderPassContext,
  waypoints: ReadonlyArray<PathWaypoint>,
  colorId: ColorId,
  z = 0.0,
  spanCols = 1,
  spanRows = 1
): void {
  if (rctx.lastOptions.reducedMotion || waypoints.length < 2) return;
  const cols = Math.max(1, spanCols);
  const rows = Math.max(1, spanRows);
  const adjusted = waypoints.slice();
  const dx0 = adjusted[1].x - adjusted[0].x;
  const dy0 = adjusted[1].y - adjusted[0].y;
  const len0 = Math.hypot(dx0, dy0);
  if (len0 > 0.12) {
    const ux = dx0 / len0;
    const uy = dy0 / len0;
    const hx = Math.max(0.12, cols * 0.5 - 0.22);
    const hy = Math.max(0.12, rows * 0.5 - 0.22);
    const tMaxX = Math.abs(ux) > 1e-4 ? hx / Math.abs(ux) : 99;
    const tMaxY = Math.abs(uy) > 1e-4 ? hy / Math.abs(uy) : 99;
    const pullBack = Math.min(len0 * 0.35, Math.min(tMaxX, tMaxY) * 0.85);
    adjusted[0] = {
      x: Math.max(0.18, adjusted[0].x - ux * pullBack),
      y: Math.max(0.18, adjusted[0].y - uy * pullBack),
    };
  }
  const { segments, totalLength } = buildTraceSegments(adjusted);
  if (segments.length === 0 || totalLength < 0.24) return;

  let weightedPerp = 0;
  for (const seg of segments) {
    const perpSpan = Math.abs(Math.sin(seg.rotZ)) * cols + Math.abs(Math.cos(seg.rotZ)) * rows;
    seg.width = Math.max(0.84, perpSpan * 0.9);
    seg.alphaScale = 1 / Math.max(1, perpSpan) ** 0.1;
    weightedPerp += perpSpan * seg.len;
  }
  const avgPerpSpan = weightedPerp / Math.max(1e-4, totalLength);
  const alphaScale = 1 / Math.max(1, avgPerpSpan) ** 0.1;

  const maxTraces = rctx.qualityGovernor.getActiveTier() === 'ULTRA_120' ? 5 : 3;
  while (rctx.activePathTraces.length >= maxTraces) {
    rctx.activePathTraces.shift();
  }
  rctx.activePathTraces.push({
    segments,
    totalLength,
    colorId,
    z,
    age: 0.001,
    maxAge: DEFAULT_TRACE_MAX_AGE_SEC,
    alphaScale,
  });
}

export function stepPathTracesImpl(rctx: RenderPassContext, dtSec: number): void {
  if (rctx.lastOptions.reducedMotion) {
    if (rctx.activePathTraces.length > 0) {
      rctx.activePathTraces.length = 0;
    }
    return;
  }
  for (let i = rctx.activePathTraces.length - 1; i >= 0; i--) {
    const tr = rctx.activePathTraces[i];
    tr.age += dtSec;
    if (tr.age >= tr.maxAge) {
      rctx.activePathTraces.splice(i, 1);
    }
  }
}

function drawCellOuterCornerBrackets3D(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  shape: PolyominoShape,
  baseCol: number,
  baseRow: number,
  z: number,
  r: number,
  g: number,
  b: number,
  alpha: number
): void {
  const occ = new Set<number>();
  for (const [dr, dc] of shape.cells) {
    occ.add((dr + 1) * 16 + (dc + 1));
  }
  const has = (dr: number, dc: number) => occ.has((dr + 1) * 16 + (dc + 1));

  const inset = 0.07;
  const arm = 0.25;
  const thick = 0.058;
  const quad = (qx: number, qy: number, qw: number, qh: number) =>
    rctx.drawMesh(gl, ENVIRONMENT_MESHES.overlayQuad, qx, qy, z, qw, qh, 1, r, g, b, alpha, 0, 0, 4);

  for (const [dr, dc] of shape.cells) {
    const cx = baseCol + dc;
    const cy = baseRow + dr;
    const freeT = !has(dr - 1, dc);
    const freeB = !has(dr + 1, dc);
    const freeL = !has(dr, dc - 1);
    const freeR = !has(dr, dc + 1);

    if (freeT && freeL) {
      quad(cx + inset, cy + inset, arm, thick);
      quad(cx + inset, cy + inset + thick, thick, arm - thick);
    }
    if (freeT && freeR) {
      quad(cx + 1 - inset - arm, cy + inset, arm, thick);
      quad(cx + 1 - inset - thick, cy + inset + thick, thick, arm - thick);
    }
    if (freeB && freeL) {
      quad(cx + inset, cy + 1 - inset - thick, arm, thick);
      quad(cx + inset, cy + 1 - inset - arm, thick, arm - thick);
    }
    if (freeB && freeR) {
      quad(cx + 1 - inset - arm, cy + 1 - inset - thick, arm, thick);
      quad(cx + 1 - inset - thick, cy + 1 - inset - arm, thick, arm - thick);
    }
  }
}

/**
 * Renders Pass 2A:
 * 1. Active Drag Floor Target Reticle & Gate Alignment Beam (`UX-01`)
 * 2. Mid-Drag Origin Ghost Footprint (`4-corner L-brackets + ↩`, `ORIGIN-GHOST-01`) when `dRow !== 0 || dCol !== 0`
 * 3. Return-Home Cancel Confirmation outline (`0` moves spent) when slid back onto `(0, 0)` after leaving origin
 */
export function renderActiveDragReticleAndOriginFootprint(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  board: BoardState,
  options: RenderSceneOptions,
  highContrast: boolean,
  pulse: number
): number | null {
  let draggedId = options.draggedBlockId ?? null;
  let liftedDetected = false;
  if (draggedId === null) {
    const lifted = board.blocks.find((b) => b.status === 'ACTIVE' && b.liftAlpha > 0.1);
    if (lifted) {
      draggedId = lifted.id;
      liftedDetected = true;
    }
  }
  if (draggedId === null) return null;

  const group = getMovedGroupBlocks(board, draggedId);
  const lead = group.find((b) => b.id === draggedId) ?? group[0];
  if (!lead) return draggedId;

  const isLiveDrag = Boolean(options.isLiveDrag) || liftedDetected || lead.liftAlpha > 0.1;
  let dRow =
    options.dragTargetRow !== undefined && options.dragTargetRow !== null
      ? options.dragTargetRow - lead.row
      : Math.round(lead.y - lead.row);
  let dCol =
    options.dragTargetCol !== undefined && options.dragTargetCol !== null
      ? options.dragTargetCol - lead.col
      : Math.round(lead.x - lead.col);

  if (!canGroupOccupyOffset(board, group, dRow, dCol)) {
    dRow = 0;
    dCol = 0;
  }

  const isDisplacedFromOrigin = isLiveDrag && (dRow !== 0 || dCol !== 0);
  const isReturnedHomeConfirm = isLiveDrag && Boolean(options.dragLeftOrigin) && dRow === 0 && dCol === 0;
  const effPulse = options.reducedMotion ? 0.5 : pulse;
  const drawFlatPad = (
    px: number,
    py: number,
    pz: number,
    pw: number,
    ph: number,
    pr: number,
    pg: number,
    pb: number,
    pa: number
  ) => rctx.drawMesh(gl, ENVIRONMENT_MESHES.overlayQuad, px, py, pz, pw, ph, 1.0, pr, pg, pb, pa, 0, 0, 4);

  for (const b of group) {
    const shape = getShape(b.shapeId);
    const activeColor: ColorId = getActiveColor(b.colorStack, b.colorCursor);
    const [cr, cg, cb] = rctx.getColorRgb(activeColor, highContrast);
    const roomVis = rctx.getRoomVisualState(board, board.roomMap[b.row * board.cols + b.col] ?? 0);
    const snapRow = b.row + dRow;
    const snapCol = b.col + dCol;

    // Origin Ghost Footprint when dragged >= 1 cell away from starting spot
    if (isDisplacedFromOrigin) {
      const brkR = highContrast ? Math.min(1, cr * 0.25 + 0.75) : Math.min(1, cr * 0.28 + 0.7);
      const brkG = highContrast ? Math.min(1, cg * 0.25 + 0.73) : Math.min(1, cg * 0.28 + 0.66);
      const brkB = highContrast ? Math.min(1, cb * 0.25 + 0.66) : Math.min(1, cb * 0.28 + 0.58);
      const origZ = roomVis.zOffset + 0.011;

      for (const [dr, dc] of shape.cells) {
        drawFlatPad(
          b.col + dc + 0.08,
          b.row + dr + 0.08,
          origZ,
          0.84,
          0.84,
          brkR,
          brkG,
          brkB,
          highContrast ? 0.15 : 0.09
        );
      }
      drawCellOuterCornerBrackets3D(
        rctx,
        gl,
        shape,
        b.col,
        b.row,
        origZ + 0.003,
        brkR,
        brkG,
        brkB,
        (highContrast ? 0.78 : 0.56) + 0.16 * effPulse
      );

      if (b.id === lead.id) {
        const anchor = getShapeAnchorCellOffset(shape);
        rctx.drawAtlasBadge(
          gl,
          'BADGE_RETURN',
          b.col + anchor.x,
          b.row + anchor.y,
          origZ + 0.006,
          0.44,
          brkR,
          brkG,
          brkB,
          (highContrast ? 0.88 : 0.68) + 0.14 * effPulse
        );
      }
    }

    // Live Snapped Landing Reticle (shifts to calm pearl/ivory cancel frame when returned home!)
    if (isReturnedHomeConfirm) {
      const homeR = 0.98;
      const homeG = 0.95;
      const homeB = 0.86;
      const homeZ = roomVis.zOffset + 0.012;
      for (const [dr, dc] of shape.cells) {
        drawFlatPad(
          snapCol + dc + 0.06,
          snapRow + dr + 0.06,
          homeZ,
          0.88,
          0.88,
          homeR,
          homeG,
          homeB,
          0.22 + 0.1 * effPulse
        );
      }
      drawCellOuterCornerBrackets3D(
        rctx,
        gl,
        shape,
        snapCol,
        snapRow,
        homeZ + 0.004,
        homeR,
        homeG,
        homeB,
        0.76 + 0.16 * effPulse
      );
    } else {
      for (const [dr, dc] of shape.cells) {
        drawFlatPad(
          snapCol + dc + 0.05,
          snapRow + dr + 0.05,
          0.012,
          0.9,
          0.9,
          cr,
          cg,
          cb,
          0.28 + 0.16 * effPulse
        );
      }
    }

    // Gate Alignment Beam projecting to any eligible gate at the snapped landing footprint
    const eligibleGateIdx =
      options.dragEligibleGateIndex !== undefined && options.dragEligibleGateIndex !== null
        ? options.dragEligibleGateIndex
        : findEligibleGateForBlockAt(board, b, snapRow, snapCol);

    if (eligibleGateIdx >= 0 && board.gates[eligibleGateIdx]) {
      const gate = board.gates[eligibleGateIdx];
      const [nx, ny] = getGateOutwardNormal(gate.edge);
      const beamCx = snapCol + shape.cols * 0.5 + nx * 0.35;
      const beamCy = snapRow + shape.rows * 0.5 + ny * 0.35;
      const beamW = gate.edge === 'TOP' || gate.edge === 'BOTTOM' ? shape.cols * 0.75 : 0.65;
      const beamH = gate.edge === 'LEFT' || gate.edge === 'RIGHT' ? shape.rows * 0.75 : 0.65;

      drawFlatPad(
        beamCx - beamW * 0.5,
        beamCy - beamH * 0.5,
        0.02,
        beamW,
        beamH,
        Math.min(1, cr + 0.25),
        Math.min(1, cg + 0.25),
        Math.min(1, cb + 0.25),
        0.55 + 0.25 * effPulse
      );
    }
  }

  return isLiveDrag ? draggedId : null;
}

/**
 * Renders lightweight post-move / post-shred Block Motion-Blur Smear Ribbons (`MYSTIC-TRACE-01`):
 * - Uses a single axis-aligned bounding quad (`ENVIRONMENT_MESHES.overlayQuad`) with analytic capsule-spline SDF
 *   evaluation (`u_materialStyle = 8`, 1 draw call / 2 non-overlapping triangles per trace, zero polygon fan seams).
 * - Color-matched to the active block (including Colorblind & High-Contrast palettes) and luminance-adapted across all
 *   5 board trays so the motion-blur smear stays legible on both dark slate/arcade and bright birch/quartz floors.
 */
export function renderMysticPathTraces3D(
  rctx: RenderPassContext,
  gl: WebGL2RenderingContext,
  options: RenderSceneOptions,
  highContrast: boolean
): void {
  if (options.reducedMotion || (options.blueprintMix ?? 0) > 0.45 || rctx.activePathTraces.length === 0) {
    return;
  }

  const colorblind = Boolean(options.colorblindSymbols);
  const trayPalette = rctx.getEffectiveTrayPalette(options.equippedTray ?? 'industrial_slate', highContrast);
  const floorLum =
    0.299 * trayPalette.floorTileA[0] + 0.587 * trayPalette.floorTileA[1] + 0.114 * trayPalette.floorTileA[2];
  const isLightTray = floorLum >= 0.38;

  gl.depthMask(false);
  gl.disable(gl.CULL_FACE);

  for (const tr of rctx.activePathTraces) {
    const p = Math.min(1, Math.max(0, tr.age / tr.maxAge));
    const headFrac = Math.min(1, p / 0.15);
    const tailFrac = Math.max(0, (p - 0.26) / 0.74) ** 1.35;
    const headDist = headFrac * tr.totalLength;
    const tailDist = tailFrac * tr.totalLength;
    const win = fillTraceUniformWindow(tr, tailDist, headDist, TRACE_UNIFORM_BUF);
    if (win.pointCount < 2) continue;

    const fadeIn = Math.min(1, p * 18.0);
    const fadeOut = (1 - p) ** 0.96;
    const envelope = fadeIn * fadeOut;

    const [br, bg, bb] = rctx.getColorRgb(tr.colorId, highContrast, colorblind);
    const blockLum = 0.299 * br + 0.587 * bg + 0.114 * bb;

    let auraR: number;
    let auraG: number;
    let auraB: number;
    let coreR: number;
    let coreG: number;
    let coreB: number;
    let baseAlpha: number;

    if (isLightTray) {
      const shade = blockLum > 0.62 ? 0.64 : 0.78;
      const coreShade = blockLum > 0.62 ? 0.5 : 0.64;
      auraR = br * shade;
      auraG = bg * shade;
      auraB = bb * shade;
      coreR = br * coreShade;
      coreG = bg * coreShade;
      coreB = bb * coreShade;
      baseAlpha = blockLum > 0.62 ? 0.76 : 0.72;
    } else {
      auraR = Math.min(1, br * 0.95 + 0.18);
      auraG = Math.min(1, bg * 0.95 + 0.18);
      auraB = Math.min(1, bb * 0.95 + 0.18);
      coreR = Math.min(1, br * 0.72 + 0.44);
      coreG = Math.min(1, bg * 0.72 + 0.44);
      coreB = Math.min(1, bb * 0.72 + 0.44);
      baseAlpha = highContrast ? 0.72 : 0.62;
    }

    const alpha = envelope * (tr.alphaScale ?? 1.0) * baseAlpha;
    gl.uniform1i(rctx.uTraceCount, win.pointCount);
    gl.uniform4fv(rctx.uTracePts, TRACE_UNIFORM_BUF);
    gl.uniform3f(rctx.uCapColor, coreR, coreG, coreB);
    rctx.drawMesh(
      gl,
      ENVIRONMENT_MESHES.overlayQuad,
      win.minX,
      win.minY,
      tr.z + 0.015,
      win.maxX - win.minX,
      win.maxY - win.minY,
      1,
      auraR,
      auraG,
      auraB,
      alpha,
      0,
      0,
      8
    );
  }
  gl.uniform1i(rctx.uTraceCount, 0);

  gl.enable(gl.CULL_FACE);
  gl.depthMask(true);
}

/**
 * Canvas2D fallback rendering (`R3D-05`) for Rocket aiming highlights, Mid-Drag Origin Ghost Footprint,
 * and fading Block Motion-Blur Path-Tracing polylines.
 */
export function renderCanvas2DDragAndTrailFx(
  rctx: RenderPassContext,
  ctx: CanvasRenderingContext2D,
  board: BoardState,
  options: RenderSceneOptions,
  project: (bx: number, by: number, bz: number) => { x: number; y: number },
  fillCellPad: (
    c: number,
    r: number,
    pad: number,
    z: number,
    fillStyle: string,
    strokeStyle?: string,
    lineWidth?: number
  ) => void,
  drawCenteredText: (
    text: string,
    bx: number,
    by: number,
    bz: number,
    color?: string,
    font?: string,
    borderless?: boolean
  ) => void
): void {
  const highContrast = Boolean(options.highContrast);
  const colorblind = Boolean(options.colorblindSymbols);

  // 1. Rocket Row/Col Aiming Highlight (only when hovered / press-aimed)
  if (options.inputMode === 'TARGET_ROCKET') {
    const axis = options.rocketAxis ?? 'ROW';
    const hRow = options.hoverRow ?? -1;
    const hCol = options.hoverCol ?? -1;
    if (axis === 'ROW' && hRow >= 0 && hRow < board.rows) {
      for (let c = 0; c < board.cols; c++) {
        if (board.occupancy[hRow * board.cols + c] === -1) continue;
        fillCellPad(c, hRow, 0.05, 0.02, 'rgba(251, 113, 133, 0.34)', '#FB7185', 2);
      }
    } else if (axis === 'COL' && hCol >= 0 && hCol < board.cols) {
      for (let r = 0; r < board.rows; r++) {
        if (board.occupancy[r * board.cols + hCol] === -1) continue;
        fillCellPad(hCol, r, 0.05, 0.02, 'rgba(251, 113, 133, 0.34)', '#FB7185', 2);
      }
    }
  }

  // 2. Origin Ghost Footprint during live displaced drag
  const draggedId = options.draggedBlockId ?? null;
  if (draggedId !== null) {
    const group = getMovedGroupBlocks(board, draggedId);
    const lead = group.find((b) => b.id === draggedId) ?? group[0];
    if (lead && (Boolean(options.isLiveDrag) || lead.liftAlpha > 0.1)) {
      let dRow =
        options.dragTargetRow !== undefined && options.dragTargetRow !== null
          ? options.dragTargetRow - lead.row
          : Math.round(lead.y - lead.row);
      let dCol =
        options.dragTargetCol !== undefined && options.dragTargetCol !== null
          ? options.dragTargetCol - lead.col
          : Math.round(lead.x - lead.col);
      if (!canGroupOccupyOffset(board, group, dRow, dCol)) {
        dRow = 0;
        dCol = 0;
      }
      if (dRow !== 0 || dCol !== 0) {
        ctx.save();
        ctx.setLineDash([5, 4]);
        for (const b of group) {
          const shape = getShape(b.shapeId);
          for (const [dr, dc] of shape.cells) {
            fillCellPad(
              b.col + dc,
              b.row + dr,
              0.08,
              0.012,
              'rgba(254, 243, 199, 0.14)',
              'rgba(254, 243, 199, 0.78)',
              2
            );
          }
          if (b.id === lead.id) {
            const anchor = getShapeAnchorCellOffset(shape);
            drawCenteredText(
              '↩',
              b.col + anchor.x,
              b.row + anchor.y,
              0.02,
              '#FEF3C7',
              'bold 14px sans-serif'
            );
          }
        }
        ctx.restore();
      }
    }
  }

  // 3. Single-stroke Block Motion-Blur polylines (zero segment-joint stacking; disabled in reducedMotion)
  if (!options.reducedMotion && (options.blueprintMix ?? 0) <= 0.45 && rctx.activePathTraces.length > 0) {
    const trayPalette = rctx.getEffectiveTrayPalette(
      options.equippedTray ?? 'industrial_slate',
      highContrast
    );
    const floorLum =
      0.299 * trayPalette.floorTileA[0] +
      0.587 * trayPalette.floorTileA[1] +
      0.114 * trayPalette.floorTileA[2];
    const isLightTray = floorLum >= 0.38;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const tr of rctx.activePathTraces) {
      const p = Math.min(1, Math.max(0, tr.age / tr.maxAge));
      const headDist = Math.min(1, p / 0.16) * tr.totalLength;
      const tailDist = Math.max(0, (p - 0.22) / 0.78) ** 1.32 * tr.totalLength;
      if (headDist - tailDist <= 0.04) continue;
      const env = Math.min(1, p * 16) * (1 - p) ** 1.15 * (tr.alphaScale ?? 1.0);
      const [br, bg, bb] = rctx.getColorRgb(tr.colorId, highContrast, colorblind);
      const blockLum = 0.299 * br + 0.587 * bg + 0.114 * bb;
      const shade = isLightTray ? (blockLum > 0.62 ? 0.64 : 0.78) : 0.9;
      const coreShade = isLightTray ? (blockLum > 0.62 ? 0.5 : 0.64) : 0.72;
      const lift = isLightTray ? 0 : 0.12;
      const coreLift = isLightTray ? 0 : 0.34;
      const ar = Math.min(255, Math.round((br * shade + lift) * 255));
      const ag = Math.min(255, Math.round((bg * shade + lift) * 255));
      const ab = Math.min(255, Math.round((bb * shade + lift) * 255));
      const cr = Math.min(255, Math.round((br * coreShade + coreLift) * 255));
      const cg = Math.min(255, Math.round((bg * coreShade + coreLift) * 255));
      const cb = Math.min(255, Math.round((bb * coreShade + coreLift) * 255));

      const span = headDist - tailDist;
      const taperLen = Math.min(span * 0.84, Math.max(0.42, Math.min(span * 0.68, 2.35)));
      const strokeSubSpan = (subStart: number, widthMul: number, rgbStr: string, alphaMul: number) => {
        if (headDist - subStart <= 0.03) return;
        let started = false;
        let widthSum = 0;
        let visCount = 0;
        ctx.beginPath();
        for (const seg of tr.segments) {
          if (seg.endDist <= subStart || seg.startDist >= headDist) continue;
          const vis0 = Math.max(seg.startDist, subStart);
          const vis1 = Math.min(seg.endDist, headDist);
          const t0 = (vis0 - seg.startDist) / seg.len;
          const t1 = (vis1 - seg.startDist) / seg.len;
          const p0 = project(seg.x0 + (seg.x1 - seg.x0) * t0, seg.y0 + (seg.y1 - seg.y0) * t0, tr.z + 0.015);
          const p1 = project(seg.x0 + (seg.x1 - seg.x0) * t1, seg.y0 + (seg.y1 - seg.y0) * t1, tr.z + 0.015);
          if (!started) {
            ctx.moveTo(p0.x, p0.y);
            started = true;
          }
          ctx.lineTo(p1.x, p1.y);
          widthSum += seg.width ?? 0.9;
          visCount++;
        }
        if (started && visCount > 0) {
          ctx.strokeStyle = `rgba(${rgbStr}, ${(env * alphaMul).toFixed(3)})`;
          ctx.lineWidth = Math.max(2, Math.round(22 * (widthSum / visCount) * widthMul));
          ctx.stroke();
        }
      };

      strokeSubSpan(tailDist, 0.38, `${ar}, ${ag}, ${ab}`, 0.13);
      strokeSubSpan(tailDist + taperLen * 0.36, 0.7, `${ar}, ${ag}, ${ab}`, 0.16);
      strokeSubSpan(tailDist + taperLen * 0.72, 1.0, `${ar}, ${ag}, ${ab}`, 0.18);
      strokeSubSpan(tailDist + taperLen * 0.52, 0.54, `${cr}, ${cg}, ${cb}`, 0.22);
    }
    ctx.restore();
  }
}

export async function executeBenchmarkFramesImpl(
  rctx: RenderPassContext & { render(board: BoardState, options?: RenderSceneOptions): void },
  lastBoard: BoardState | null,
  frames: number
): Promise<Benchmark120HzResult> {
  const count = Math.max(10, frames);
  const samples = new Float32Array(count);

  if (rctx.activeParticleCount < 60 && lastBoard) {
    rctx.spawnParticlesAt(lastBoard.cols * 0.5, lastBoard.rows * 0.5, 0.45, 1, 60, 0, -1);
  }
  if (lastBoard) {
    rctx.render(lastBoard, { ...rctx.lastOptions, dtSec: 1 / 120 });
    rctx.gl?.finish();
  }

  for (let i = 0; i < count; i++) {
    const t0 = performance.now();
    if (lastBoard) {
      rctx.render(lastBoard, { ...rctx.lastOptions, dtSec: 1 / 120 });
    }
    rctx.gl?.flush();
    samples[i] = Math.max(0.01, performance.now() - t0);
  }

  let sum = 0;
  let maxWorkMs = 0;
  for (let i = 0; i < count; i++) {
    sum += samples[i];
    if (samples[i] > maxWorkMs) maxWorkMs = samples[i];
  }
  samples.sort();
  const p95WorkMs = Number(samples[Math.min(count - 1, Math.floor(count * 0.95))].toFixed(3));
  const p99WorkMs = Number(samples[Math.min(count - 1, Math.floor(count * 0.99))].toFixed(3));
  const avgWorkMs = Number((sum / count).toFixed(3));

  return {
    framesExecuted: count,
    avgWorkMs,
    p95WorkMs,
    p99WorkMs,
    maxWorkMs: Number(maxWorkMs.toFixed(3)),
    passes120HzBudget: p95WorkMs <= 8.33,
    passes60HzBudget: p95WorkMs <= 16.67,
  };
}
