import { getShape } from '../core/polyomino';
import type { ColorId, CourtyardLayoutId, LevelSpec } from '../core/types';
import {
  EARLY_SHAPES,
  getDifficultyForLevel,
  LATE_SHAPES,
  type MechanicId,
  MID_SHAPES,
  NIMBLE_SHAPES,
} from './generator-rules';

export interface BlockPlacementContext {
  levelId: number;
  attempt: number;
  rows: number;
  cols: number;
  layoutId: CourtyardLayoutId;
  isBreatherWave: boolean;
  grid: Int16Array;
  activeColors: ColorId[];
  activeMechanics: Set<MechanicId>;
  gates: LevelSpec['gates'];
  crates: NonNullable<LevelSpec['crates']>;
  rng: () => number;
}

export function populateCandidateBlocks(ctx: BlockPlacementContext): LevelSpec['blocks'] {
  const {
    levelId,
    attempt,
    rows,
    cols,
    layoutId,
    isBreatherWave,
    grid,
    activeColors,
    activeMechanics,
    gates,
    crates,
    rng,
  } = ctx;
  const difficulty = getDifficultyForLevel(levelId);
  const numColors = activeColors.length;
  const useCrates = activeMechanics.has('CRATES');
  const useGlued = activeMechanics.has('GLUED');
  const useStone = activeMechanics.has('STONE');
  const useColorQueueGates = activeMechanics.has('COLOR_QUEUE_GATES');

  // 1. Interior Choke-Lane Wooden Crates (L81+)
  if (useCrates) {
    const maxCrates = !isBreatherWave && levelId >= 115 && difficulty !== 'NORMAL' && attempt <= 3 ? 2 : 1;
    const crateHp = !isBreatherWave && levelId >= 135 && difficulty !== 'NORMAL' && attempt <= 2 ? 2 : 1;
    const minR = layoutId === 'TWIN_SANCTUM' ? 3 : 1;
    const maxR = layoutId === 'MYSTERY_VAULT' ? rows - 3 : rows - 2;
    const candidateCells: Array<[number, number]> = [
      [minR, Math.floor(cols / 2)],
      [Math.min(maxR, Math.floor(rows / 2)), Math.max(1, cols - 2)],
      [Math.min(maxR, minR + 1), 1],
      [rows - 1, 0],
    ];
    let placedCrates = 0;
    for (const [cr, cc] of candidateCells) {
      if (placedCrates >= maxCrates) break;
      if (cr >= 0 && cr < rows && cc >= 0 && cc < cols && grid[cr * cols + cc] === 0) {
        const id = placedCrates + 1;
        crates.push({ id, row: cr, col: cc, hp: crateHp });
        grid[cr * cols + cc] = -(100 + id);
        placedCrates++;
      }
    }
  }

  // 2. Epoch-Scaled High-Density Courtyard Target Block Count
  const rawTargetBlocks =
    levelId <= 3
      ? 3
      : levelId <= 4
        ? 4
        : levelId <= 10
          ? 5
          : levelId <= 20
            ? isBreatherWave
              ? 5
              : difficulty === 'SUPER_HARD'
                ? 7
                : 6
            : levelId <= 40
              ? isBreatherWave
                ? 6
                : layoutId === 'MYSTERY_VAULT'
                  ? 10
                  : difficulty === 'SUPER_HARD'
                    ? 9
                    : 8
              : levelId <= 80
                ? isBreatherWave
                  ? 7
                  : layoutId === 'MYSTERY_VAULT'
                    ? 11
                    : difficulty === 'SUPER_HARD'
                      ? 10
                      : 9
                : levelId <= 140
                  ? isBreatherWave
                    ? 7
                    : layoutId === 'MYSTERY_VAULT'
                      ? 12
                      : difficulty === 'SUPER_HARD'
                        ? 12
                        : difficulty === 'HARD'
                          ? 11
                          : 9
                  : levelId <= 220
                    ? isBreatherWave
                      ? 8
                      : layoutId === 'MYSTERY_VAULT'
                        ? 13
                        : difficulty === 'SUPER_HARD'
                          ? 13
                          : difficulty === 'HARD'
                            ? 12
                            : 10
                    : isBreatherWave
                      ? 9
                      : layoutId === 'MYSTERY_VAULT'
                        ? 14
                        : difficulty === 'SUPER_HARD'
                          ? 14
                          : difficulty === 'HARD'
                            ? 13
                            : 11;

  const baseTargetBlocks = isBreatherWave
    ? rawTargetBlocks
    : layoutId === 'TWIN_SANCTUM'
      ? Math.max(6, rawTargetBlocks - (attempt >= 2 ? 2 : 1))
      : attempt >= 6
        ? Math.max(5, rawTargetBlocks - 3)
        : attempt >= 4
          ? Math.max(5, rawTargetBlocks - 2)
          : attempt >= 2
            ? Math.max(5, rawTargetBlocks - 1)
            : rawTargetBlocks;
  const targetBlocks = Math.max(numColors, baseTargetBlocks);

  const leadShapePool = isBreatherWave
    ? EARLY_SHAPES
    : levelId <= 35 || layoutId === 'TWIN_SANCTUM'
      ? EARLY_SHAPES
      : levelId <= 125
        ? MID_SHAPES
        : LATE_SHAPES;
  const maxLargeBlocks =
    attempt >= 5 || activeMechanics.has('SIZE_CHANGING_GATE') || layoutId === 'TWIN_SANCTUM'
      ? 1
      : isBreatherWave || levelId <= 35
        ? 2
        : levelId <= 120
          ? 3
          : 4;
  const dominoAndTriominoPool = ['1x2', '2x1', '1x3', '3x1', 'L3_BL', 'L3_TL', 'L3_TR', 'L3_BR', '2x2'];

  const blocks: LevelSpec['blocks'] = [];
  let nextId = 1;

  // 3. Multi-Color Glued Assembly (L101+): two distinct-color blocks linked as groupId = 1
  if (useGlued && activeColors.length >= 2) {
    const r = layoutId === 'TWIN_SANCTUM' ? 4 : Math.max(1, Math.floor(rows / 2) - 1);
    const c = Math.max(1, Math.floor(cols / 2) - 1);
    const secondShape = levelId >= 130 && c + 2 < cols && grid[r * cols + c + 2] === 0 ? '1x2' : '1x1';
    const sh2 = getShape(secondShape);
    let canGlue = grid[r * cols + c] === 0;
    for (const [dr, dc] of sh2.cells) {
      if (r + dr >= rows || c + 1 + dc >= cols || grid[(r + dr) * cols + (c + 1 + dc)] !== 0) {
        canGlue = false;
      }
    }
    if (canGlue) {
      const id1 = nextId++;
      const id2 = nextId++;
      blocks.push({ id: id1, shapeId: '1x1', row: r, col: c, colorStack: [activeColors[0]], groupId: 1 });
      blocks.push({
        id: id2,
        shapeId: secondShape,
        row: r,
        col: c + 1,
        colorStack: [activeColors[1]],
        groupId: 1,
      });
      grid[r * cols + c] = id1;
      for (const [dr, dc] of sh2.cells) {
        grid[(r + dr) * cols + (c + 1 + dc)] = id2;
      }
    }
  }

  // 4. Interior Movable Stone Blockers (L71+): placed in central traffic lanes so players must park them cleanly!
  if (useStone) {
    const stoneCount =
      !isBreatherWave && levelId >= 130 && difficulty !== 'NORMAL' && rows >= 7 && cols >= 7 && attempt <= 3
        ? 2
        : 1;
    const minSR = layoutId === 'TWIN_SANCTUM' ? 4 : 1;
    const maxSR = layoutId === 'MYSTERY_VAULT' ? rows - 3 : rows - 2;
    const stoneAnchors: Array<[number, number, string]> = [
      [
        Math.min(maxSR, Math.max(minSR, Math.floor(rows / 2))),
        Math.floor(cols / 2),
        cols >= 7 && attempt <= 2 ? '1x2' : '1x1',
      ],
      [minSR, Math.max(1, cols - 2), '1x1'],
      [rows - 1, cols - 1, '1x1'],
    ];
    let stonesPlaced = 0;
    for (const [sr, sc, sShape] of stoneAnchors) {
      if (stonesPlaced >= stoneCount) break;
      const sh = getShape(sShape);
      if (sr < 0 || sc < 0 || sr + sh.rows > rows || sc + sh.cols > cols) continue;
      let fits = true;
      for (const [dr, dc] of sh.cells) {
        if (grid[(sr + dr) * cols + (sc + dc)] !== 0) fits = false;
      }
      if (fits) {
        const id = nextId++;
        blocks.push({ id, shapeId: sShape, row: sr, col: sc, colorStack: [0] });
        for (const [dr, dc] of sh.cells) {
          grid[(sr + dr) * cols + (sc + dc)] = id;
        }
        stonesPlaced++;
      }
    }
  }

  // How many perimeter gate lanes should be deliberately cross-blocked by wrong-color blocks
  const crossBlockBudget =
    attempt >= 6
      ? 0
      : levelId <= 10 || isBreatherWave
        ? 1
        : attempt >= 4
          ? 1
          : attempt >= 2
            ? 2
            : difficulty === 'SUPER_HARD'
              ? 3
              : 2;

  for (let bIdx = 0; bIdx < targetBlocks; bIdx++) {
    let colorIdx = bIdx % activeColors.length;
    if (layoutId === 'MYSTERY_VAULT' && activeColors.length >= 4) {
      if (bIdx === 0) colorIdx = 2;
      else if (bIdx === 1) colorIdx = 3;
      else if (bIdx === 2) colorIdx = 0;
      else if (bIdx === 3) colorIdx = 1;
      else colorIdx = [1, 2, 0, 3][(bIdx - 4) % 4] % activeColors.length;
    } else if (layoutId === 'TWIN_SANCTUM' && activeColors.length >= 4) {
      if (bIdx === 0) colorIdx = 0;
      else if (bIdx === 1) colorIdx = 3;
      else if (bIdx === 2) colorIdx = 1;
      else if (bIdx === 3) colorIdx = 2;
      else colorIdx = [2, 3, 1, 0][(bIdx - 4) % 4] % activeColors.length;
    } else if (useColorQueueGates && bIdx >= activeColors.length && activeColors.length >= 2) {
      colorIdx = 1 + (bIdx % (activeColors.length - 1));
    }
    const color = activeColors[colorIdx];
    const matchingGate = gates.find((g) => g.colorQueue[0] === color) ?? gates[colorIdx % gates.length];

    let chosenShape = bIdx % 2 === 0 ? '1x2' : '2x1';
    const allowLargeShape = !activeMechanics.has('SIZE_CHANGING_GATE') && bIdx < maxLargeBlocks;
    const activePool = allowLargeShape ? leadShapePool : attempt <= 4 ? dominoAndTriominoPool : NIMBLE_SHAPES;
    for (let sTry = 0; sTry < 14; sTry++) {
      const candidate =
        attempt >= 7 && !allowLargeShape
          ? bIdx % 2 === 0
            ? '1x2'
            : '2x1'
          : activePool[Math.floor(rng() * activePool.length)];
      if (candidate === '1x1' && sTry < 10) continue;
      const sh = getShape(candidate);
      const reqSpan = matchingGate.edge === 'TOP' || matchingGate.edge === 'BOTTOM' ? sh.cols : sh.rows;
      const maxDim = allowLargeShape ? (rows >= 7 && cols >= 7 ? 4 : 3) : 3;
      if (reqSpan <= matchingGate.spanLength && sh.rows <= maxDim && sh.cols <= maxDim) {
        chosenShape = candidate;
        break;
      }
    }

    const shape = getShape(chosenShape);
    let placed = false;

    const tryPlaceBlockAt = (r: number, c: number, overrideShapeId?: string, cellTarget = 0): boolean => {
      const sh = overrideShapeId ? getShape(overrideShapeId) : shape;
      if (r < 0 || c < 0 || r + sh.rows > rows || c + sh.cols > cols) return false;
      for (const [dr, dc] of sh.cells) {
        if (grid[(r + dr) * cols + (c + dc)] !== cellTarget) return false;
      }
      const id = nextId++;
      for (const [dr, dc] of sh.cells) {
        grid[(r + dr) * cols + (c + dc)] = id;
      }
      blocks.push({
        id,
        shapeId: overrideShapeId ?? chosenShape,
        row: r,
        col: c,
        colorStack: [color],
      });
      return true;
    };

    // A. MYSTERY_VAULT concealed blocks + cross-blocked upper courtyard
    if (layoutId === 'MYSTERY_VAULT') {
      if (bIdx === 0 || bIdx === 1) {
        const vr = bIdx === 0 ? rows - 2 : rows - 1;
        if (tryPlaceBlockAt(vr, 2, '1x2', -3) || tryPlaceBlockAt(vr, 1, '1x2', -3)) {
          placed = true;
        }
      } else {
        // Place wrong-color blockers across upper/side gates first!
        const rivalGate = gates.find((g) => g.colorQueue[0] !== color && g.edge !== 'BOTTOM');
        if (bIdx <= 4 && rivalGate && attempt <= 5) {
          if (rivalGate.edge === 'TOP') {
            const pc = Math.max(0, Math.min(cols - shape.cols, rivalGate.spanStart));
            if (tryPlaceBlockAt(0, pc) || tryPlaceBlockAt(1, pc)) placed = true;
          } else if (rivalGate.edge === 'RIGHT') {
            const pr = Math.max(0, Math.min(rows - 3 - shape.rows, rivalGate.spanStart));
            if (tryPlaceBlockAt(pr, cols - shape.cols) || tryPlaceBlockAt(pr, cols - shape.cols - 1)) {
              placed = true;
            }
          }
        }
        for (let pTry = 0; pTry < 36 && !placed; pTry++) {
          const minR = pTry < 18 ? 1 : 0;
          const maxR = Math.max(minR, rows - 3 - shape.rows);
          const minC = pTry < 18 ? 1 : 0;
          const maxC = Math.max(minC, cols - shape.cols - (pTry < 18 ? 1 : 0));
          const r = minR + Math.floor(rng() * (maxR - minR + 1));
          const c = minC + Math.floor(rng() * (maxC - minC + 1));
          if (tryPlaceBlockAt(r, c)) placed = true;
        }
      }
    }

    // B. TWIN_SANCTUM North Chamber + cross-blocked South Courtyard
    if (layoutId === 'TWIN_SANCTUM') {
      if (bIdx === 0 || (bIdx === 1 && cols >= 6)) {
        const r1 = bIdx === 0 ? 1 : 0;
        const c1 = Math.max(1, Math.min(cols - 3, Math.floor((cols - 2) / 2)));
        if (tryPlaceBlockAt(r1, c1, '1x2')) placed = true;
      } else {
        const southRivalGate = gates.find((g) => g.colorQueue[0] !== color && g.edge !== 'TOP');
        if (bIdx <= 4 && southRivalGate && attempt <= 5) {
          if (southRivalGate.edge === 'BOTTOM') {
            const pc = Math.max(0, Math.min(cols - shape.cols, southRivalGate.spanStart));
            if (tryPlaceBlockAt(rows - shape.rows, pc) || tryPlaceBlockAt(rows - shape.rows - 1, pc)) {
              placed = true;
            }
          } else if (southRivalGate.edge === 'RIGHT') {
            const pr = Math.max(3, Math.min(rows - shape.rows, southRivalGate.spanStart));
            if (tryPlaceBlockAt(pr, cols - shape.cols)) placed = true;
          }
        }
        for (let pTry = 0; pTry < 36 && !placed; pTry++) {
          const minR = 3;
          const maxR = Math.max(minR, rows - shape.rows - (pTry < 18 ? 1 : 0));
          const minC = pTry < 18 ? 1 : 0;
          const maxC = Math.max(minC, cols - shape.cols - (pTry < 18 ? 1 : 0));
          const r = minR + Math.floor(rng() * (maxR - minR + 1));
          const c = minC + Math.floor(rng() * (maxC - minC + 1));
          if (tryPlaceBlockAt(r, c)) placed = true;
        }
      }
    }

    // C. Standard & Sculpted Courtyards: Cross-Corridor Blocker Ring!
    // Block 0 sits in interior aligned with gates[0]; Blocks 1..crossBlockBudget sit directly in front of WRONG-COLOR gates!
    if (!placed && layoutId !== 'TWIN_SANCTUM' && layoutId !== 'MYSTERY_VAULT') {
      if (bIdx === 0 && matchingGate.edge === 'TOP' && rows >= 5) {
        const r0 = Math.min(rows - shape.rows - 1, 2 + (rows >= 8 ? 1 : 0));
        const c0 = Math.max(1, Math.min(cols - shape.cols - 1, matchingGate.spanStart));
        if (tryPlaceBlockAt(r0, c0)) placed = true;
      } else if (bIdx >= 1 && bIdx <= crossBlockBudget) {
        // Pick a gate that does NOT match `color` and park this block across its exit threshold!
        const rivalGates = gates.filter((g) => !g.colorQueue.includes(color));
        const targetRival = rivalGates[(bIdx - 1) % Math.max(1, rivalGates.length)];
        if (targetRival) {
          if (targetRival.edge === 'TOP') {
            const pc = Math.max(0, Math.min(cols - shape.cols, targetRival.spanStart));
            if (tryPlaceBlockAt(1, pc) || tryPlaceBlockAt(0, pc)) placed = true;
          } else if (targetRival.edge === 'RIGHT') {
            const pr = Math.max(0, Math.min(rows - shape.rows, targetRival.spanStart));
            if (tryPlaceBlockAt(pr, cols - shape.cols - 1) || tryPlaceBlockAt(pr, cols - shape.cols)) {
              placed = true;
            }
          } else if (targetRival.edge === 'BOTTOM') {
            const pc = Math.max(0, Math.min(cols - shape.cols, targetRival.spanStart));
            if (tryPlaceBlockAt(rows - shape.rows - 1, pc) || tryPlaceBlockAt(rows - shape.rows, pc)) {
              placed = true;
            }
          } else if (targetRival.edge === 'LEFT') {
            const pr = Math.max(0, Math.min(rows - shape.rows, targetRival.spanStart));
            if (tryPlaceBlockAt(pr, 1) || tryPlaceBlockAt(pr, 0)) placed = true;
          }
        }
      }
    }

    // D. Interior-first stochastic packing
    for (let pTry = 0; pTry < 36 && !placed; pTry++) {
      const allowPerimeter = pTry >= 18 && layoutId !== 'TWIN_SANCTUM' && layoutId !== 'MYSTERY_VAULT';
      const minR = allowPerimeter ? 0 : 1;
      const maxR = Math.max(minR, rows - shape.rows - (allowPerimeter ? 0 : 1));
      const minC = allowPerimeter ? 0 : 1;
      const maxC = Math.max(minC, cols - shape.cols - (allowPerimeter ? 0 : 1));
      const r = minR + Math.floor(rng() * (maxR - minR + 1));
      const c = minC + Math.floor(rng() * (maxC - minC + 1));
      if (tryPlaceBlockAt(r, c)) {
        placed = true;
        break;
      }
    }

    // E. Domino / Monomino fallback scan if courtyard is tightly packed
    if (!placed) {
      const startRow = layoutId === 'TWIN_SANCTUM' && bIdx > 0 ? 3 : 0;
      const endRow = layoutId === 'MYSTERY_VAULT' ? rows - 2 : rows;
      for (const domShape of bIdx % 2 === 0 ? ['1x2', '2x1'] : ['2x1', '1x2']) {
        const dsh = getShape(domShape);
        const reqSpan = matchingGate.edge === 'TOP' || matchingGate.edge === 'BOTTOM' ? dsh.cols : dsh.rows;
        if (reqSpan > matchingGate.spanLength) continue;
        for (let r = startRow; r <= endRow - dsh.rows && !placed; r++) {
          for (let c = 0; c <= cols - dsh.cols && !placed; c++) {
            if (tryPlaceBlockAt(r, c, domShape)) placed = true;
          }
        }
      }
      for (let r = startRow; r < endRow && !placed; r++) {
        for (let c = 0; c < cols && !placed; c++) {
          if (tryPlaceBlockAt(r, c, '1x1')) placed = true;
        }
      }
    }
  }

  return blocks;
}
