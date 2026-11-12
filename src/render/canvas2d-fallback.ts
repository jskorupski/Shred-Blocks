import { getGateActiveColor, getGateOutwardNormal } from '../core/gate-clearance';
import {
  canGroupOccupyOffset,
  getBlockRoomId,
  getMovedGroupBlocks,
  isBlockInSealedVault,
} from '../core/physics';
import { getActiveColor, getLayersRemaining, getShape } from '../core/polyomino';
import { type BoardState, COLOR_PALETTE, type ColorId } from '../core/types';
import { BLOCK_LIFT_DELTA_Z, BLOCK_TOP_Z } from './camera-3d';
import { renderCanvas2DDragAndTrailFx } from './pass2-drag-fx';
import {
  INSTANCE_STRIDE,
  RELIC_EMBER_SCALE_OFFSET,
  type RenderPassContext,
  type RenderSceneOptions,
} from './render-types';
import { renderGateBurstsCanvas2D } from './shred-style-fx';

/**
 * Complete `Canvas2D` fallback renderer (`R3D-05`) using `Camera3D.boardToScreen` so all 18 obstacles,
 * reticles, visual shred animations, multi-modifier badges, and 3D particles remain 100% visible
 * even in environments without WebGL2.
 */
export function renderCanvas2DFallbackImpl(
  rctx: RenderPassContext,
  board: BoardState,
  options: RenderSceneOptions,
  dtSec = 1 / 60
): void {
  const ctx = rctx.ctx2d;
  if (!ctx) return;

  const w = rctx.canvas.width;
  const h = rctx.canvas.height;
  const trayId = options.equippedTray ?? 'industrial_slate';
  const highContrast = Boolean(options.highContrast);
  const colorblind = Boolean(options.colorblindSymbols);
  const palette = rctx.getEffectiveTrayPalette(trayId, highContrast);
  const pickPrimaryHex = (e: (typeof COLOR_PALETTE)[ColorId]): string =>
    colorblind
      ? highContrast
        ? e.cbHighContrastPrimaryHex
        : e.cbPrimaryHex
      : highContrast
        ? e.highContrastPrimaryHex
        : e.primaryHex;
  const pickLipHex = (e: (typeof COLOR_PALETTE)[ColorId]): string => (colorblind ? e.cbLipHex : e.lipHex);
  const toCssRgb = (rgb: [number, number, number], mul = 1.0): string =>
    `rgb(${Math.round(Math.min(1, rgb[0] * mul) * 255)}, ${Math.round(Math.min(1, rgb[1] * mul) * 255)}, ${Math.round(Math.min(1, rgb[2] * mul) * 255)})`;
  const dtMs = dtSec * 1000;

  ctx.clearRect(0, 0, w, h);

  const blueprintMix = Math.max(0, Math.min(1, options.blueprintMix ?? 0));
  const zRelief = 1.0 - 0.78 * blueprintMix;
  const project = (bx: number, by: number, bz: number) =>
    rctx.camera.projectToRect(bx, by, bz * zRelief, 0, 0, w, h);

  const fillProjectedQuad = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    z: number,
    fillStyle: string,
    strokeStyle?: string,
    lineWidth = 1.5
  ) => {
    const p0 = project(x0, y0, z);
    const p1 = project(x1, y0, z);
    const p2 = project(x1, y1, z);
    const p3 = project(x0, y1, z);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
    if (strokeStyle) {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  };

  const drawCenteredText = (
    text: string,
    bx: number,
    by: number,
    bz: number,
    color = '#FFFFFF',
    font = 'bold 12px sans-serif',
    borderless = false
  ) => {
    const pt = project(bx, by, bz);
    ctx.save();
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (!borderless) {
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 3;
      ctx.strokeText(text, pt.x, pt.y);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, pt.x, pt.y);
    ctx.restore();
  };

  const fillCellPad = (
    c: number,
    r: number,
    pad: number,
    z: number,
    fillStyle: string,
    strokeStyle?: string,
    lineWidth = 1.5
  ) => fillProjectedQuad(c + pad, r + pad, c + 1 - pad, r + 1 - pad, z, fillStyle, strokeStyle, lineWidth);
  // 1. Draw Floor Tiles, Cutouts, Colorful Floor Paths & Stone Pillars (`occ === -2`)
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      const idx = r * board.cols + c;
      const occ = board.occupancy[idx];
      if (occ === -1) continue;
      const roomId = board.roomMap[idx] ?? 0;
      const roomVis = rctx.getRoomVisualState(board, roomId);
      const zOff = roomVis.zOffset;
      const fc = (board.floorColor[idx] ?? 0) as ColorId;
      const fill =
        fc > 0
          ? pickPrimaryHex(COLOR_PALETTE[fc])
          : (r + c) % 2 === 0
            ? toCssRgb(palette.floorTileA, roomVis.luminanceMul)
            : toCssRgb(palette.floorTileB, roomVis.luminanceMul);
      fillCellPad(c, r, 0.04, zOff, fill);
      if (fc > 0 && colorblind) {
        const fE = COLOR_PALETTE[fc];
        drawCenteredText(
          fE.symbol,
          c + 0.5,
          r + 0.5,
          zOff + 0.02,
          fE.cbGlyphHex,
          'bold 13px sans-serif',
          true
        );
      }
      if (occ === -2) {
        fillCellPad(c, r, 0.08, zOff + 0.62, COLOR_PALETTE[0].primaryHex, COLOR_PALETTE[0].lipHex, 2);
        drawCenteredText('▨', c + 0.5, r + 0.5, zOff + 0.65, '#E2E8F0', 'bold 14px sans-serif');
      }
    }
  }

  // 2. Draw Moving Elevator Platforms (`board.elevators`)
  for (const elev of board.elevators) {
    const dir = elev.atAlternatePos ? -1 : 1;
    const targetR = elev.row + elev.deltaRow * dir;
    const targetC = elev.col + elev.deltaCol * dir;
    const minR = Math.min(elev.row, targetR);
    const minC = Math.min(elev.col, targetC);
    const spanR = Math.abs(targetR - elev.row) + elev.height;
    const spanC = Math.abs(targetC - elev.col) + elev.width;
    fillProjectedQuad(
      minC + 0.15,
      minR + 0.15,
      minC + spanC - 0.15,
      minR + spanR - 0.15,
      0.01,
      'rgba(56, 189, 248, 0.22)',
      'rgba(56, 189, 248, 0.55)',
      1
    );
    fillProjectedQuad(
      elev.col + 0.04,
      elev.row + 0.04,
      elev.col + elev.width - 0.04,
      elev.row + elev.height - 0.04,
      0.05,
      '#38BDF8',
      '#0284C7',
      2
    );
    const arrow = Math.abs(elev.deltaCol) >= Math.abs(elev.deltaRow) ? '↔' : '↕';
    drawCenteredText(arrow, elev.col + elev.width * 0.5, elev.row + elev.height * 0.5, 0.08, '#FFFFFF');
  }

  // 3. Draw Wooden Crates (`board.crates`)
  for (const crate of board.crates) {
    if (crate.destroyed || crate.hp <= 0) continue;
    fillCellPad(crate.col, crate.row, 0.06, 0.58, '#B45309', '#78350F', 2);
    drawCenteredText(
      String(crate.hp),
      crate.col + 0.5,
      crate.row + 0.5,
      0.62,
      '#FEF3C7',
      'bold 14px sans-serif'
    );
  }

  // 4. Draw Block Generators & Spawn Pads (`board.generators`)
  for (const gen of board.generators) {
    const depleted = gen.state === 'DEPLETED' || gen.queueCursor >= gen.queue.length;
    fillCellPad(gen.col, gen.row, 0.05, 0.68, depleted ? '#334155' : '#475569', '#1E293B', 2);
    if (!depleted) {
      const nextSpec = gen.queue[gen.queueCursor];
      if (nextSpec && nextSpec.colorStack.length > 0) {
        const nextCol = nextSpec.colorStack[0];
        const nextEntry = COLOR_PALETTE[nextCol] ?? COLOR_PALETTE[1];
        const spawnShape = getShape(nextSpec.shapeId);
        for (const [dr, dc] of spawnShape.cells) {
          const sc = gen.spawnCol + dc;
          const sr = gen.spawnRow + dr;
          if (sc >= 0 && sc < board.cols && sr >= 0 && sr < board.rows) {
            fillCellPad(sc, sr, 0.08, 0.02, 'rgba(250, 204, 21, 0.24)', pickPrimaryHex(nextEntry), 1.5);
          }
        }
        fillProjectedQuad(
          gen.col + 0.2,
          gen.row + 0.16,
          gen.col + 0.8,
          gen.row + 0.52,
          0.7,
          pickPrimaryHex(nextEntry)
        );
        if (colorblind) {
          drawCenteredText(
            nextEntry.symbol,
            gen.col + 0.5,
            gen.row + 0.34,
            0.72,
            nextEntry.cbGlyphHex,
            'bold 12px sans-serif',
            true
          );
        }
      }
      drawCenteredText(
        `⚡${gen.cooldown}`,
        gen.col + 0.5,
        gen.row + 0.72,
        0.72,
        '#FDE047',
        'bold 12px sans-serif'
      );
    }
  }

  // 5. Draw Target Reticles, Origin Ghost Footprint, Mystic Path Traces & Hint Ghost Outline
  renderCanvas2DDragAndTrailFx(rctx, ctx, board, options, project, fillCellPad, drawCenteredText);
  let draggedId = options.draggedBlockId ?? null;
  if (draggedId === null) {
    const lifted = board.blocks.find((b) => b.status === 'ACTIVE' && b.liftAlpha > 0.1);
    if (lifted) draggedId = lifted.id;
  }
  if (draggedId !== null) {
    const group = getMovedGroupBlocks(board, draggedId);
    const lead = group.find((b) => b.id === draggedId) ?? group[0];
    if (lead) {
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
      const isReturnedHomeConfirm = Boolean(options.dragLeftOrigin) && dRow === 0 && dCol === 0;
      for (const b of group) {
        const shape = getShape(b.shapeId);
        const snapRow = b.row + dRow;
        const snapCol = b.col + dCol;
        for (const [dr, dc] of shape.cells) {
          fillCellPad(
            snapCol + dc,
            snapRow + dr,
            0.06,
            0.015,
            isReturnedHomeConfirm ? 'rgba(254, 243, 199, 0.28)' : 'rgba(255, 255, 255, 0.25)',
            isReturnedHomeConfirm ? '#FEF3C7' : '#FFFFFF',
            isReturnedHomeConfirm ? 2.5 : undefined
          );
        }
      }
    }
  }
  const fallbackGuideMove = board.hintMove ?? options.autoGuideMove ?? null;
  if (fallbackGuideMove) {
    const hintBlock = board.blocks.find((b) => b.id === fallbackGuideMove.blockId && b.status === 'ACTIVE');
    if (hintBlock) {
      const shape = getShape(hintBlock.shapeId);
      for (const [dr, dc] of shape.cells) {
        fillCellPad(
          fallbackGuideMove.targetCol + dc,
          fallbackGuideMove.targetRow + dr,
          0.06,
          0.02,
          'rgba(250, 204, 21, 0.35)',
          '#FACC15',
          2
        );
      }
    }
  }

  // 6. Draw Gates, Shutters, Ice Counters, Star Emblems, Queue Pips & Portcullis Barriers
  for (const gate of board.gates) {
    const cId = getGateActiveColor(gate);
    const entry = COLOR_PALETTE[cId] ?? COLOR_PALETTE[1];
    const isHorizEdge = gate.edge === 'TOP' || gate.edge === 'BOTTOM';
    let gx0 = gate.spanStart;
    let gy0 = 0;
    let gx1 = gate.spanStart + gate.spanLength;
    let gy1 = 0;
    if (gate.edge === 'TOP') {
      gy0 = gate.edgeLine - 0.38;
      gy1 = gate.edgeLine;
    } else if (gate.edge === 'BOTTOM') {
      gy0 = gate.edgeLine + 1;
      gy1 = gate.edgeLine + 1 + 0.38;
    } else if (gate.edge === 'LEFT') {
      gx0 = gate.edgeLine - 0.38;
      gx1 = gate.edgeLine;
      gy0 = gate.spanStart;
      gy1 = gate.spanStart + gate.spanLength;
    } else {
      gx0 = gate.edgeLine + 1;
      gx1 = gate.edgeLine + 1 + 0.38;
      gy0 = gate.spanStart;
      gy1 = gate.spanStart + gate.spanLength;
    }

    fillProjectedQuad(gx0, gy0, gx1, gy1, 0.35, pickPrimaryHex(entry), pickLipHex(entry), 2);

    const gcx = (gx0 + gx1) * 0.5;
    const gcy = (gy0 + gy1) * 0.5;
    const spanAxisX = isHorizEdge ? 1 : 0;
    const spanAxisY = isHorizEdge ? 0 : 1;

    if (!gate.shutterOpen || gate.shutterLockColor > 0) {
      const lockHex =
        gate.shutterLockColor > 0 ? pickPrimaryHex(COLOR_PALETTE[gate.shutterLockColor]) : '#64748B';
      fillProjectedQuad(gx0 + 0.05, gy0 + 0.05, gx1 - 0.05, gy1 - 0.05, 0.48, lockHex, '#0F172A');
      if (gate.shutterLockColor > 0) {
        const lockSym = COLOR_PALETTE[gate.shutterLockColor].symbol;
        drawCenteredText(colorblind ? `💎${lockSym}` : '💎', gcx, gcy, 0.56, '#FFFFFF');
      }
    } else if (gate.togglesOnClear) {
      fillProjectedQuad(gx0, gy0, gx0 + 0.1, gy0 + 0.1, 0.45, '#22C55E');
    }

    if (gate.iceCount > 0) {
      fillProjectedQuad(gx0, gy0, gx1, gy1, 0.52, 'rgba(125, 211, 252, 0.55)', '#BAE6FD', 1.5);
      drawCenteredText(`❄${gate.iceCount}`, gcx, gcy, 0.6, '#FFFFFF');
    }

    if (gate.isStar) {
      const starOff = gate.iceCount > 0 || gate.shutterLockColor > 0 ? 0.28 : 0;
      drawCenteredText('★', gcx + spanAxisX * starOff, gcy + spanAxisY * starOff, 0.6, '#FDE047');
    }

    if (colorblind) {
      drawCenteredText(
        entry.symbol,
        gcx - spanAxisX * 0.28,
        gcy - spanAxisY * 0.28,
        0.6,
        entry.cbGlyphHex,
        'bold 12px sans-serif',
        true
      );
    }

    const remainingQueue = gate.colorQueue.length - (gate.colorCursor + 1);
    for (let q = 0; q < Math.min(3, remainingQueue); q++) {
      const nextCol = gate.colorQueue[gate.colorCursor + 1 + q];
      const qEntry = COLOR_PALETTE[nextCol] ?? COLOR_PALETTE[1];
      const pipOffset = (q - (Math.min(3, remainingQueue) - 1) * 0.5) * 0.26;
      const px = isHorizEdge ? gcx + pipOffset : gcx + (gate.edge === 'LEFT' ? -0.18 : 0.18);
      const py = !isHorizEdge ? gcy + pipOffset : gcy + (gate.edge === 'TOP' ? -0.18 : 0.18);
      fillProjectedQuad(
        px - 0.08,
        py - 0.08,
        px + 0.08,
        py + 0.08,
        0.64,
        pickPrimaryHex(qEntry),
        '#0F172A',
        1
      );
      if (colorblind) {
        drawCenteredText(qEntry.symbol, px, py, 0.68, qEntry.cbGlyphHex, 'bold 9px sans-serif', true);
      }
    }
  }

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
    const spanW = maxC - minC + 1;
    const spanH = maxR - minR + 1;
    if (bar.open) {
      fillProjectedQuad(
        minC + 0.12,
        minR + 0.12,
        minC + spanW - 0.12,
        minR + spanH - 0.12,
        0.02,
        'rgba(234, 179, 8, 0.18)',
        '#CA8A04',
        1
      );
    } else {
      fillProjectedQuad(
        minC + 0.08,
        minR + 0.08,
        minC + spanW - 0.08,
        minR + spanH - 0.08,
        0.56,
        bar.isVault ? '#312E81' : '#B45309',
        '#FDE047',
        2
      );
      const label =
        bar.lockId && bar.lockId > 0 && bar.shredsRemaining <= 0
          ? '🔑'
          : `${bar.isVault ? '🔒' : '⛩'}${bar.shredsRemaining}`;
      drawCenteredText(
        label,
        minC + spanW * 0.5,
        minR + spanH * 0.5,
        0.64,
        '#FEF08A',
        'bold 13px sans-serif'
      );
    }
  }

  // 7. Advance & Draw Active Visual Shreds (`rctx.activeVisualShreds`)
  for (let i = rctx.activeVisualShreds.length - 1; i >= 0; i--) {
    const anim = rctx.activeVisualShreds[i];
    anim.progress += dtSec / 0.22;
    const gate = board.gates[anim.gateIndex];
    if (anim.progress >= 1 || !gate) {
      rctx.activeVisualShreds.splice(i, 1);
      continue;
    }
    const shape = getShape(anim.shapeId);
    const entry = COLOR_PALETTE[anim.colorId] ?? COLOR_PALETTE[1];
    const [nx, ny] = getGateOutwardNormal(gate.edge);
    const span = nx !== 0 ? shape.cols : shape.rows;
    const sx = anim.x + nx * anim.progress * (span + 0.35);
    const sy = anim.y + ny * anim.progress * (span + 0.35);
    for (const [dr, dc] of shape.cells) {
      const cx = sx + dc;
      const cy = sy + dr;
      if (gate.edge === 'TOP' && cy < gate.edgeLine - 0.25) continue;
      if (gate.edge === 'BOTTOM' && cy > gate.edgeLine + 0.25) continue;
      if (gate.edge === 'LEFT' && cx < gate.edgeLine - 0.25) continue;
      if (gate.edge === 'RIGHT' && cx > gate.edgeLine + 0.25) continue;
      if (cx < -0.25 || cx > board.cols - 0.75 || cy < -0.25 || cy > board.rows - 0.75) continue;
      fillCellPad(cx, cy, 0.05, BLOCK_TOP_Z, pickPrimaryHex(entry), pickLipHex(entry));
    }
  }

  // 8. Draw Blocks, Multi-Layer Inner Cores, Ropes, Chains, Ice & All Badges
  const fallbackTimeSec = options.timeSec ?? (performance.now() - rctx.startTimeMs) * 0.001;
  const fallbackReducedMotion = Boolean(options.reducedMotion);
  for (const block of board.blocks) {
    if (block.status === 'CLEARED' || isBlockInSealedVault(board, block)) continue;
    const shape = getShape(block.shapeId);
    const cId: ColorId = getActiveColor(block.colorStack, block.colorCursor);
    const entry = COLOR_PALETTE[cId] ?? COLOR_PALETTE[1];
    const layersLeft = getLayersRemaining(block.colorStack, block.colorCursor);
    const blockRoomId = getBlockRoomId(board, block);
    const blockRoomVis = rctx.getRoomVisualState(board, blockRoomId);
    const isIdleMovable =
      !fallbackReducedMotion &&
      !blockRoomVis.isLocked &&
      block.liftAlpha <= 0.05 &&
      block.iceCount === 0 &&
      !block.chained &&
      block.ropeColor === 0;
    const wave01 = isIdleMovable
      ? 0.5 + 0.5 * Math.sin(fallbackTimeSec * 2.1 - (block.col * 0.68 + block.row * 0.54) + block.id * 0.55)
      : 0;
    const z = BLOCK_TOP_Z + blockRoomVis.zOffset + block.liftAlpha * BLOCK_LIFT_DELTA_Z + wave01 * 0.038;

    let drawX =
      block.x +
      (isIdleMovable && block.axisLock === 'H'
        ? Math.sin(fallbackTimeSec * 2.0 + block.id * 1.3) * 0.008
        : 0);
    let drawY =
      block.y +
      (isIdleMovable && block.axisLock === 'V'
        ? Math.sin(fallbackTimeSec * 2.0 + block.id * 1.3) * 0.008
        : 0);
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

    for (const [dr, dc] of shape.cells) {
      fillCellPad(drawX + dc, drawY + dr, 0.04, z, pickPrimaryHex(entry), pickLipHex(entry), 2);
      if (layersLeft > 1) {
        const innerEntry = COLOR_PALETTE[block.colorStack[block.colorCursor + 1] ?? cId] ?? entry;
        fillCellPad(
          drawX + dc,
          drawY + dr,
          0.18,
          z + 0.02,
          pickPrimaryHex(innerEntry),
          pickLipHex(innerEntry)
        );
      }
      if (block.iceCount > 0) {
        fillCellPad(drawX + dc, drawY + dr, 0.03, z + 0.025, 'rgba(125, 211, 252, 0.45)', '#E0F2FE');
      }
    }

    const first = shape.cells[0];
    const anchor = shape.cells[shape.anchorCellIndex] ?? first;
    const anchorCx = drawX + anchor[1] + 0.5;
    const anchorCy = drawY + anchor[0] + 0.5;
    const lockCx = drawX + shape.cols * 0.5;
    const lockCy = drawY + shape.rows * 0.5;
    const hasImmobilizer = block.iceCount > 0 || block.chained;
    const hasPayload =
      (block.bombMax > 0 && block.bombCount > 0) ||
      block.hasKey > 0 ||
      block.scissorColor > 0 ||
      block.shutterGemColor > 0 ||
      block.isStar;

    let immCx = anchorCx;
    let immCy = anchorCy;
    let payCx = anchorCx;
    let payCy = anchorCy;
    if (hasImmobilizer && hasPayload) {
      if (shape.cells.length >= 2) {
        const sec = shape.cells[(shape.anchorCellIndex + 1) % shape.cells.length];
        payCx = drawX + sec[1] + 0.5;
        payCy = drawY + sec[0] + 0.5;
      } else {
        immCx = anchorCx - 0.16;
        immCy = anchorCy - 0.14;
        payCx = anchorCx + 0.16;
        payCy = anchorCy + 0.14;
      }
    }

    const drawCap2D = (cx: number, cy: number, half: number, colEntry: typeof entry, zCap: number): void => {
      fillProjectedQuad(
        cx - half,
        cy - half,
        cx + half,
        cy + half,
        zCap,
        pickPrimaryHex(colEntry),
        pickLipHex(colEntry),
        1
      );
    };

    if (colorblind) {
      const freeCells = shape.cells.filter(([cr, cc], ci) => {
        const cx = drawX + cc + 0.5;
        const cy = drawY + cr + 0.5;
        return (
          (!hasImmobilizer || Math.hypot(cx - immCx, cy - immCy) >= 0.36) &&
          (!hasPayload || Math.hypot(cx - payCx, cy - payCy) >= 0.36) &&
          (block.axisLock === 'NONE' || Math.hypot(cx - lockCx, cy - lockCy) >= 0.36) &&
          !(block.ropeColor > 0 && ci === shape.anchorCellIndex)
        );
      });
      const outerCell = freeCells[0];
      const sx = outerCell ? drawX + outerCell[1] + 0.5 : drawX + first[1] + 0.24;
      const sy = outerCell ? drawY + outerCell[0] + 0.5 : drawY + first[0] + 0.24;
      if (layersLeft > 1 || block.iceCount > 0 || !outerCell) {
        drawCap2D(sx, sy, outerCell ? 0.26 : 0.17, entry, z + 0.028);
      }
      drawCenteredText(entry.symbol, sx, sy, z + 0.032, entry.cbGlyphHex, 'bold 13px sans-serif', true);
      if (layersLeft > 1) {
        const innerId = block.colorStack[block.colorCursor + 1] ?? cId;
        const innerEntry = COLOR_PALETTE[innerId] ?? entry;
        const innerCell = freeCells[1];
        const ix = innerCell ? drawX + innerCell[1] + 0.5 : drawX + first[1] + 0.76;
        const iy = innerCell ? drawY + innerCell[0] + 0.5 : drawY + first[0] + 0.76;
        if (!innerCell || block.iceCount > 0) {
          drawCap2D(ix, iy, innerCell ? 0.24 : 0.17, innerEntry, z + 0.028);
        }
        drawCenteredText(
          innerEntry.symbol,
          ix,
          iy,
          z + 0.032,
          innerEntry.cbGlyphHex,
          'bold 11px sans-serif',
          true
        );
      }
    } else if (cId === 0) {
      drawCenteredText(entry.symbol, drawX + first[1] + 0.22, drawY + first[0] + 0.22, z + 0.03, '#FFFFFF');
    }

    if (block.ropeColor > 0) {
      const rE = COLOR_PALETTE[block.ropeColor];
      const rx0 = drawX + anchor[1] + 0.06;
      const ry0 = drawY + anchor[0] + 0.36;
      fillProjectedQuad(rx0, ry0, rx0 + 0.88, ry0 + 0.28, z + 0.028, pickPrimaryHex(rE), pickLipHex(rE), 1.5);
      if (colorblind) {
        drawCenteredText(
          rE.symbol,
          anchorCx,
          anchorCy,
          z + 0.034,
          rE.cbGlyphHex,
          'bold 11px sans-serif',
          true
        );
      }
    }
    if (block.chained) {
      const cx0 = drawX + anchor[1] + 0.08;
      const cy0 = drawY + anchor[0] + 0.4;
      fillProjectedQuad(cx0, cy0, cx0 + 0.84, cy0 + 0.2, z + 0.028, '#475569', '#0F172A', 1.5);
    }
    if (block.axisLock === 'H') {
      fillProjectedQuad(
        drawX + 0.22,
        lockCy - 0.16,
        drawX + shape.cols - 0.22,
        lockCy + 0.16,
        z + 0.025,
        pickLipHex(entry),
        entry.highlightHex,
        1.5
      );
      drawCenteredText('↔', lockCx, lockCy, z + 0.032, '#FFFDF9', 'bold 15px sans-serif');
    } else if (block.axisLock === 'V') {
      fillProjectedQuad(
        lockCx - 0.16,
        drawY + 0.22,
        lockCx + 0.16,
        drawY + shape.rows - 0.22,
        z + 0.025,
        pickLipHex(entry),
        entry.highlightHex,
        1.5
      );
      drawCenteredText('↕', lockCx, lockCy, z + 0.032, '#FFFDF9', 'bold 15px sans-serif');
    }

    if (block.iceCount > 0) drawCenteredText(`❄${block.iceCount}`, immCx, immCy, z + 0.04, '#E0F2FE');
    else if (block.chained) drawCenteredText('🔒', immCx, immCy, z + 0.04, '#FDE047');

    if (block.bombMax > 0 && block.bombCount > 0) {
      drawCenteredText(`💣${block.bombCount}`, payCx, payCy, z + 0.04, '#FCA5A5');
    } else if (block.hasKey > 0) {
      drawCenteredText('🔑', payCx, payCy, z + 0.04, '#FDE047');
    } else if (block.scissorColor > 0 || block.shutterGemColor > 0) {
      const pE = COLOR_PALETTE[block.scissorColor > 0 ? block.scissorColor : block.shutterGemColor];
      const pIcon = block.scissorColor > 0 ? '✂' : '💎';
      if (colorblind) {
        fillProjectedQuad(
          payCx - 0.31,
          payCy - 0.21,
          payCx + 0.31,
          payCy + 0.21,
          z + 0.036,
          pickPrimaryHex(pE),
          pickLipHex(pE),
          1.5
        );
        drawCenteredText(
          `${pIcon}${pE.symbol}`,
          payCx,
          payCy,
          z + 0.042,
          pE.cbGlyphHex,
          'bold 11px sans-serif',
          true
        );
      } else {
        drawCenteredText(pIcon, payCx, payCy, z + 0.04, pickPrimaryHex(pE));
      }
    } else if (block.isStar) {
      drawCenteredText('★', payCx, payCy, z + 0.04, '#FDE047');
    }
  }

  // 9. Draw Weld Clamps between adjacent blocks sharing `groupId > 0`
  for (let i = 0; i < board.blocks.length; i++) {
    const a = board.blocks[i];
    if (a.status !== 'ACTIVE' || a.groupId <= 0 || isBlockInSealedVault(board, a)) continue;
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
            fillProjectedQuad(
              mx - 0.16,
              my - 0.16,
              mx + 0.16,
              my + 0.16,
              BLOCK_TOP_Z + 0.03,
              '#CBD5E1',
              '#475569',
              1.5
            );
            clamped = true;
            break;
          }
        }
      }
    }
  }

  // 10. Draw Active 3D Particles
  for (let i = 0; i < rctx.activeParticleCount; i++) {
    const base = i * INSTANCE_STRIDE;
    const px = rctx.particleInstanceData[base + 0];
    const py = rctx.particleInstanceData[base + 1];
    const pz = rctx.particleInstanceData[base + 2];
    const pScale = rctx.particleInstanceData[base + 3];
    const pr = Math.round(rctx.particleInstanceData[base + 4] * 255);
    const pg = Math.round(rctx.particleInstanceData[base + 5] * 255);
    const pb = Math.round(rctx.particleInstanceData[base + 6] * 255);
    const pt = project(px, py, pz);
    const isGameplay = pScale > 0;
    const effScale = isGameplay
      ? pScale - Math.floor(pScale)
      : pScale <= -RELIC_EMBER_SCALE_OFFSET
        ? -pScale - RELIC_EMBER_SCALE_OFFSET
        : Math.abs(pScale);
    const alpha = isGameplay ? Math.min(1, Math.floor(pScale) / 1023 / 0.42) : 1;
    const rad = Math.max(2, effScale * 28);
    ctx.fillStyle = `rgba(${pr}, ${pg}, ${pb}, ${alpha.toFixed(3)})`;
    ctx.fillRect(pt.x - rad * 0.5, pt.y - rad * 0.5, rad, rad);
  }
  renderGateBurstsCanvas2D(rctx, ctx, project);
}
