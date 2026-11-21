import { findEligibleGateForBlockAt, getGateOutwardNormal } from '../core/gate-clearance';
import { canGroupOccupyOffset, getMovedGroupBlocks } from '../core/physics';
import { getActiveColor, getShape, type PolyominoShape } from '../core/polyomino';
import type { Benchmark120HzResult, BoardState, ColorId } from '../core/types';
import { getCellFloorTopZ } from './block-pose-and-clearance';
import { ENVIRONMENT_MESHES } from './mesh-generator';
import {
  buildTraceSegments,
  fillTraceUniformWindow,
  MAX_TRACE_UNIFORM_PTS,
  type OriginGhostStyle,
  type PathTraceHost,
  type PathTraceSegment,
  type PathWaypoint,
  type ReturnHomeStyle,
  resolveOriginGhostStyle,
  resolveReturnHomeStyle,
  spawnPathTraceImpl,
  stepPathTracesImpl,
  type VisualPathTrace,
} from './path-trace-ribbon';
import type { RenderPassContext, RenderSceneOptions } from './render-types';

export {
  buildTraceSegments,
  type OriginGhostStyle,
  type PathTraceHost,
  type PathTraceSegment,
  type PathWaypoint,
  type ReturnHomeStyle,
  resolveOriginGhostStyle,
  resolveReturnHomeStyle,
  spawnPathTraceImpl,
  stepPathTracesImpl,
  type VisualPathTrace,
};

const TRACE_UNIFORM_BUF = new Float32Array(MAX_TRACE_UNIFORM_PTS * 4);
const CORNER_OCC_SCRATCH = new Set<number>();

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
  alpha: number,
  inset = 0.07,
  expand = 0
): void {
  CORNER_OCC_SCRATCH.clear();
  for (const [dr, dc] of shape.cells) {
    CORNER_OCC_SCRATCH.add((dr + 1) * 16 + (dc + 1));
  }
  const has = (dr: number, dc: number) => CORNER_OCC_SCRATCH.has((dr + 1) * 16 + (dc + 1));

  const arm = 0.25;
  const thick = 0.058;
  const vLen = Math.max(0, arm - thick);
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
      quad(cx + inset - expand, cy + inset - expand, arm + expand * 2, thick + expand * 2);
      quad(cx + inset - expand, cy + inset + thick + expand, thick + expand * 2, vLen);
    }
    if (freeT && freeR) {
      quad(cx + 1 - inset - arm - expand, cy + inset - expand, arm + expand * 2, thick + expand * 2);
      quad(cx + 1 - inset - thick - expand, cy + inset + thick + expand, thick + expand * 2, vLen);
    }
    if (freeB && freeL) {
      quad(cx + inset - expand, cy + 1 - inset - thick - expand, arm + expand * 2, thick + expand * 2);
      quad(cx + inset - expand, cy + 1 - inset - arm - expand, thick + expand * 2, vLen);
    }
    if (freeB && freeR) {
      quad(
        cx + 1 - inset - arm - expand,
        cy + 1 - inset - thick - expand,
        arm + expand * 2,
        thick + expand * 2
      );
      quad(cx + 1 - inset - thick - expand, cy + 1 - inset - arm - expand, thick + expand * 2, vLen);
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

  const colorblind = Boolean(options.colorblindSymbols);
  const trayId = options.equippedTray ?? 'industrial_slate';
  const trayPalette = rctx.getEffectiveTrayPalette(trayId, highContrast);
  const floorLum =
    0.2126 * trayPalette.floorTileA[0] +
    0.7152 * trayPalette.floorTileA[1] +
    0.0722 * trayPalette.floorTileA[2];
  const isLightTray = !highContrast && floorLum >= 0.42;

  for (const b of group) {
    const shape = getShape(b.shapeId);
    const activeColor: ColorId = getActiveColor(b.colorStack, b.colorCursor);
    const [cr, cg, cb] = rctx.getColorRgb(activeColor, highContrast, colorblind);
    const roomVis = rctx.getRoomVisualState(board, board.roomMap[b.row * board.cols + b.col] ?? 0);
    const snapRow = b.row + dRow;
    const snapCol = b.col + dCol;
    let origFloorZ = -Infinity;
    let snapFloorZ = -Infinity;
    for (const [dr, dc] of shape.cells) {
      const ofz = getCellFloorTopZ(board, rctx, b.row + dr, b.col + dc);
      if (ofz > origFloorZ) origFloorZ = ofz;
      const sfz = getCellFloorTopZ(board, rctx, snapRow + dr, snapCol + dc);
      if (sfz > snapFloorZ) snapFloorZ = sfz;
    }
    if (!Number.isFinite(origFloorZ)) origFloorZ = roomVis.zOffset;
    if (!Number.isFinite(snapFloorZ)) snapFloorZ = roomVis.zOffset;

    // Origin Ghost Footprint when dragged >= 1 cell away from starting spot
    if (isDisplacedFromOrigin) {
      const ghostStyle = resolveOriginGhostStyle(trayId, trayPalette, [cr, cg, cb], highContrast, effPulse);
      const origZ = origFloorZ + 0.015;

      for (const [dr, dc] of shape.cells) {
        drawFlatPad(
          b.col + dc + 0.08,
          b.row + dr + 0.08,
          origZ,
          0.84,
          0.84,
          ghostStyle.padRgb[0],
          ghostStyle.padRgb[1],
          ghostStyle.padRgb[2],
          ghostStyle.padAlpha
        );
      }
      drawCellOuterCornerBrackets3D(
        rctx,
        gl,
        shape,
        b.col,
        b.row,
        origZ + 0.002,
        ghostStyle.haloRgb[0],
        ghostStyle.haloRgb[1],
        ghostStyle.haloRgb[2],
        ghostStyle.haloAlpha,
        ghostStyle.bracketInset,
        0.016
      );
      drawCellOuterCornerBrackets3D(
        rctx,
        gl,
        shape,
        b.col,
        b.row,
        origZ + 0.0035,
        ghostStyle.bracketRgb[0],
        ghostStyle.bracketRgb[1],
        ghostStyle.bracketRgb[2],
        ghostStyle.bracketAlpha,
        ghostStyle.bracketInset
      );

      if (b.id === lead.id) {
        const anchor = getShapeAnchorCellOffset(shape);
        rctx.drawAtlasBadge(
          gl,
          'BADGE_RETURN',
          b.col + anchor.x,
          b.row + anchor.y,
          origZ + 0.006,
          0.45,
          ghostStyle.badgeRgb[0],
          ghostStyle.badgeRgb[1],
          ghostStyle.badgeRgb[2],
          ghostStyle.badgeAlpha
        );
      }
    }

    // Live Snapped Landing Reticle (shifts to calm cancel frame when returned home!)
    if (isReturnedHomeConfirm) {
      const homeStyle = resolveReturnHomeStyle(trayId, trayPalette, highContrast, effPulse);
      const homeZ = origFloorZ + 0.015;
      for (const [dr, dc] of shape.cells) {
        drawFlatPad(
          snapCol + dc + 0.06,
          snapRow + dr + 0.06,
          homeZ,
          0.88,
          0.88,
          homeStyle.padRgb[0],
          homeStyle.padRgb[1],
          homeStyle.padRgb[2],
          homeStyle.padAlpha
        );
      }
      drawCellOuterCornerBrackets3D(
        rctx,
        gl,
        shape,
        snapCol,
        snapRow,
        homeZ + 0.002,
        homeStyle.haloRgb[0],
        homeStyle.haloRgb[1],
        homeStyle.haloRgb[2],
        homeStyle.haloAlpha,
        homeStyle.bracketInset,
        0.016
      );
      drawCellOuterCornerBrackets3D(
        rctx,
        gl,
        shape,
        snapCol,
        snapRow,
        homeZ + 0.004,
        homeStyle.bracketRgb[0],
        homeStyle.bracketRgb[1],
        homeStyle.bracketRgb[2],
        homeStyle.bracketAlpha,
        homeStyle.bracketInset
      );
    } else {
      const blockLum = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
      const shade = isLightTray ? (blockLum > 0.55 ? 0.78 : 0.88) : 1.0;
      const padAlpha = (isLightTray ? 0.32 : 0.28) + 0.16 * effPulse;
      for (const [dr, dc] of shape.cells) {
        drawFlatPad(
          snapCol + dc + 0.05,
          snapRow + dr + 0.05,
          snapFloorZ + 0.015,
          0.9,
          0.9,
          cr * shade,
          cg * shade,
          cb * shade,
          padAlpha
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
        Math.max(snapFloorZ, 0) + 0.02,
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
    const headDist = tr.totalLength;
    const tailFrac = Math.max(0, (p - 0.08) / 0.92) ** 1.28;
    const tailDist = tailFrac * tr.totalLength;
    const win = fillTraceUniformWindow(tr, tailDist, headDist, TRACE_UNIFORM_BUF);
    if (win.pointCount < 2) continue;

    const fadeIn = Math.min(1, p * 22.0);
    const fadeOut = (1 - p) ** 1.02;
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
    rctx.useMainProgram?.(gl);
    gl.uniform1i(rctx.uTraceCount, win.pointCount);
    gl.uniform4fv(rctx.uTracePts, TRACE_UNIFORM_BUF, 0, win.pointCount * 4);
    gl.uniform3f(rctx.uCapColor, coreR, coreG, coreB);
    gl.uniform4f(
      rctx.uClipPlane,
      tr.headOriginX ?? 0,
      tr.headOriginY ?? 0,
      tr.spanCols ?? 1,
      tr.spanRows ?? 1
    );
    if (rctx.setBlockSeed) {
      rctx.setBlockSeed(tr.headCellMask ?? 0);
    } else {
      gl.uniform1f(rctx.uBlockSeed, tr.headCellMask ?? 0);
    }
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
  rctx.useMainProgram?.(gl);
  gl.uniform1i(rctx.uTraceCount, 0);
  if (rctx.setBlockSeed) {
    rctx.setBlockSeed(0);
  } else {
    gl.uniform1f(rctx.uBlockSeed, 0);
  }

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

  // 2. Origin Ghost Footprint + Snapped Landing Reticle during drag (tray-luminance adaptive)
  let draggedId = options.draggedBlockId ?? null;
  let liftedDetected = false;
  if (draggedId === null) {
    const lifted = board.blocks.find((b) => b.status === 'ACTIVE' && b.liftAlpha > 0.1);
    if (lifted) {
      draggedId = lifted.id;
      liftedDetected = true;
    }
  }
  if (draggedId !== null) {
    const trayId = options.equippedTray ?? 'industrial_slate';
    const trayPalette = rctx.getEffectiveTrayPalette(trayId, highContrast);
    const floorLum =
      0.2126 * trayPalette.floorTileA[0] +
      0.7152 * trayPalette.floorTileA[1] +
      0.0722 * trayPalette.floorTileA[2];
    const isLightTray = !highContrast && floorLum >= 0.42;

    const group = getMovedGroupBlocks(board, draggedId);
    const lead = group.find((b) => b.id === draggedId) ?? group[0];
    if (lead) {
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
      const toCssRgba = (rgb: readonly [number, number, number], a: number): string =>
        `rgba(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)}, ${a.toFixed(3)})`;

      for (const b of group) {
        const shape = getShape(b.shapeId);
        const activeColor: ColorId = getActiveColor(b.colorStack, b.colorCursor);
        const rgb = rctx.getColorRgb(activeColor, highContrast, colorblind);
        const snapRow = b.row + dRow;
        const snapCol = b.col + dCol;

        if (isDisplacedFromOrigin) {
          const ghostStyle = resolveOriginGhostStyle(trayId, trayPalette, rgb, highContrast, 0.5);
          ctx.save();
          ctx.setLineDash([5, 4]);
          for (const [dr, dc] of shape.cells) {
            fillCellPad(
              b.col + dc,
              b.row + dr,
              0.08,
              0.016,
              toCssRgba(ghostStyle.padRgb, ghostStyle.padAlpha),
              toCssRgba(ghostStyle.bracketRgb, ghostStyle.bracketAlpha),
              2
            );
          }
          ctx.restore();
          if (b.id === lead.id) {
            const anchor = getShapeAnchorCellOffset(shape);
            drawCenteredText(
              '↩',
              b.col + anchor.x,
              b.row + anchor.y,
              0.022,
              isLightTray ? '#FFFDF9' : '#FEF3C7',
              'bold 14px sans-serif',
              false
            );
          }
        }

        const homeStyle = isReturnedHomeConfirm
          ? resolveReturnHomeStyle(trayId, trayPalette, highContrast, 0.5)
          : null;
        for (const [dr, dc] of shape.cells) {
          fillCellPad(
            snapCol + dc,
            snapRow + dr,
            0.06,
            0.016,
            homeStyle
              ? toCssRgba(homeStyle.padRgb, homeStyle.padAlpha)
              : isLightTray
                ? toCssRgba(rgb, 0.34)
                : 'rgba(255, 255, 255, 0.25)',
            homeStyle
              ? toCssRgba(homeStyle.bracketRgb, homeStyle.bracketAlpha)
              : isLightTray
                ? 'rgba(15, 23, 42, 0.65)'
                : '#FFFFFF',
            homeStyle ? 2.5 : undefined
          );
        }
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
      const headDist = tr.totalLength;
      const tailDist = Math.max(0, (p - 0.08) / 0.92) ** 1.28 * tr.totalLength;
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

  const spawnedSynthetic = rctx.activeParticleCount < 60 && Boolean(lastBoard);
  if (spawnedSynthetic && lastBoard) {
    rctx.spawnParticlesAt(lastBoard.cols * 0.5, lastBoard.rows * 0.5, 0.45, 1, 60, 0, -1);
  }
  if (lastBoard) {
    for (let w = 0; w < 4; w++) {
      rctx.render(lastBoard, { ...rctx.lastOptions, dtSec: 1 / 120 });
    }
    rctx.gl?.finish();
    rctx.qualityGovernor.resetWorkSamples();
  }

  for (let i = 0; i < count; i++) {
    if (i > 0 && i % 12 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const t0 = performance.now();
    if (lastBoard) {
      rctx.render(lastBoard, { ...rctx.lastOptions, dtSec: 1 / 120 });
    }
    rctx.gl?.flush();
    samples[i] = Math.max(0.01, performance.now() - t0);
  }
  if (spawnedSynthetic) {
    rctx.resetTransientFx?.();
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
