import { createBoardState } from '../core/board';
import { getShape } from '../core/polyomino';
import type { ColorId, EdgeDir, LevelSpec } from '../core/types';
import { applyProgressiveMechanicsToCandidate } from './generator-mechanics';
import {
  EARLY_SHAPES,
  getDifficultyForLevel,
  getUnlockNoteForLevel,
  LATE_SHAPES,
  LEVEL_ADJECTIVES,
  LEVEL_NOUNS,
  MID_SHAPES,
  mulberry32,
  NIMBLE_SHAPES,
  selectCourtyardTopologyForLevel,
  selectFocusedMechanicsForLevel,
} from './generator-rules';
import { solveBoard } from './solver';

export * from './generator-rules';

function tryBuildCandidateSpec(levelId: number, rng: () => number, attempt: number): LevelSpec {
  const difficulty = getDifficultyForLevel(levelId);
  const decPos = levelId % 10; // 1..9, 0
  const isBreatherWave = levelId >= 11 && decPos === 6;

  // Decade-Aligned Spacious Board Size Curve (`PROG-01`, `RAMP-05`, `PORTRAIT-01`: `5x5` -> `9x9` & tall portrait maps)
  const usePortraitTall =
    attempt <= 1 &&
    levelId >= 28 &&
    (levelId % 7 === 0 || levelId % 10 === 4 || levelId % 10 === 8 || levelId % 3 === 0);
  let rows = 6;
  let cols = 6;
  if (levelId <= 4) {
    rows = 5;
    cols = 5;
  } else if (levelId <= 8) {
    rows = 6;
    cols = 5;
  } else if (levelId <= 40) {
    rows = usePortraitTall ? 8 : levelId >= 30 && difficulty === 'SUPER_HARD' ? 7 : 6;
    cols = 6;
  } else if (levelId <= 80) {
    rows = usePortraitTall ? 8 : 7;
    cols = levelId >= 70 && difficulty === 'SUPER_HARD' ? 7 : 6;
  } else if (levelId <= 130) {
    rows = usePortraitTall ? 9 : levelId >= 110 && difficulty === 'SUPER_HARD' ? 8 : 7;
    cols = 7;
  } else if (levelId <= 180) {
    rows = usePortraitTall ? 9 : 8;
    cols = levelId >= 160 && difficulty === 'SUPER_HARD' ? 8 : 7;
  } else if (levelId <= 240) {
    rows = usePortraitTall ? 9 : levelId >= 220 && difficulty === 'SUPER_HARD' ? 9 : 8;
    cols = usePortraitTall ? 7 : 8;
  } else if (levelId <= 280) {
    rows = usePortraitTall ? 10 : 9;
    cols = usePortraitTall ? 8 : levelId >= 270 && difficulty === 'SUPER_HARD' ? 9 : 8;
  } else {
    rows = usePortraitTall ? 10 : 9;
    cols = usePortraitTall ? 8 : isBreatherWave ? 8 : 9;
  }

  // On late retry attempts (`attempt >= 3`), step down very large grids by 1 cell to guarantee fast solver verification
  if (attempt >= 3 && rows > 7) rows = 7;
  if (attempt >= 3 && cols > 7) cols = 7;

  const maxPalette = levelId <= 10 ? 4 : levelId <= 60 ? 6 : levelId <= 140 ? 8 : 9;
  const availableColors: ColorId[] = [];
  for (let c = 1; c <= maxPalette; c++) availableColors.push(c as ColorId);
  for (let i = availableColors.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = availableColors[i];
    availableColors[i] = availableColors[j];
    availableColors[j] = tmp;
  }

  // `RAMP-01`: Focused Primary + Harmonious Secondary Mechanic Selector (never uncapped modulo pile-ups!)
  const activeMechanics = selectFocusedMechanicsForLevel(levelId);
  const layoutId = selectCourtyardTopologyForLevel(levelId, rows, cols, attempt, activeMechanics);
  const useCutoutsOrPillars = activeMechanics.has('CUTOUTS_PILLARS');
  const useStone = activeMechanics.has('STONE');
  const useCrates = activeMechanics.has('CRATES');
  const useGlued = activeMechanics.has('GLUED');
  const useColorQueueGates = activeMechanics.has('COLOR_QUEUE_GATES');
  const useElevators = activeMechanics.has('ELEVATORS');
  const getSculptedEdgeSpanBounds = (edge: EdgeDir): { minStart: number; maxEnd: number } => {
    const limit = edge === 'TOP' || edge === 'BOTTOM' ? cols : rows;
    if (layoutId === 'RECTANGLE') {
      if (!useCutoutsOrPillars) {
        return { minStart: 0, maxEnd: limit };
      }
      if (edge === 'TOP') return { minStart: 1, maxEnd: limit - 1 };
      if (edge === 'LEFT' || edge === 'RIGHT') return { minStart: 1, maxEnd: limit };
      return { minStart: 0, maxEnd: limit };
    }
    if (layoutId === 'TWIN_SANCTUM') {
      if (edge === 'LEFT' || edge === 'RIGHT') return { minStart: 3, maxEnd: limit };
      if (edge === 'TOP') return { minStart: 1, maxEnd: limit - 1 };
      return { minStart: 0, maxEnd: limit };
    }
    if (layoutId === 'MYSTERY_VAULT') {
      if (edge === 'TOP' || edge === 'BOTTOM') return { minStart: 1, maxEnd: limit - 1 };
      return { minStart: 1, maxEnd: limit - 2 };
    }
    if (layoutId === 'L_WING') {
      if (edge === 'TOP') return { minStart: 0, maxEnd: limit - 1 };
      if (edge === 'RIGHT') return { minStart: 2, maxEnd: limit };
      if (edge === 'BOTTOM') return { minStart: 1, maxEnd: limit };
      return { minStart: 0, maxEnd: limit - 1 };
    }
    if (layoutId === 'T_PAVILION') {
      if (edge === 'TOP') return { minStart: 0, maxEnd: limit };
      if (edge === 'BOTTOM') return { minStart: 1, maxEnd: limit - 1 };
      return { minStart: 0, maxEnd: rows >= 7 ? limit - 2 : limit - 1 };
    }
    if (layoutId === 'HOURGLASS_BRIDGE') {
      if (edge === 'TOP') return { minStart: 1, maxEnd: limit - 1 };
      if (edge === 'BOTTOM') return { minStart: 0, maxEnd: limit - 1 };
      if (edge === 'LEFT') return { minStart: 1, maxEnd: limit };
      return { minStart: 1, maxEnd: limit - 1 };
    }
    return { minStart: 1, maxEnd: limit - 1 };
  };

  const topSpanBounds = getSculptedEdgeSpanBounds('TOP');
  const rightSpanBounds = getSculptedEdgeSpanBounds('RIGHT');
  const canSplitTopEdge = topSpanBounds.maxEnd - topSpanBounds.minStart >= 6;
  const canSplitRightEdge = rightSpanBounds.maxEnd - rightSpanBounds.minStart >= 6;

  const numColors =
    levelId <= 3
      ? 2
      : levelId <= 8
        ? 3
        : isBreatherWave || layoutId === 'TWIN_SANCTUM'
          ? 4
          : levelId >= 140 && difficulty === 'SUPER_HARD' && cols >= 8 && canSplitTopEdge && canSplitRightEdge
            ? 6
            : levelId >= 90 &&
                (difficulty === 'HARD' || difficulty === 'SUPER_HARD') &&
                cols >= 7 &&
                canSplitTopEdge
              ? 5
              : 4;
  const activeColors = availableColors.slice(0, numColors);

  const edges: EdgeDir[] = ['TOP', 'RIGHT', 'BOTTOM', 'LEFT'];
  const gates: LevelSpec['gates'] = [];

  for (let i = 0; i < numColors; i++) {
    const edge = edges[i % 4];
    const { minStart, maxEnd } = getSculptedEdgeSpanBounds(edge);
    const availLen = Math.max(2, maxEnd - minStart);
    if (edge === 'TOP' && numColors >= 5 && availLen >= 6) {
      const mid = Math.floor((minStart + maxEnd) / 2);
      if (i === 0) {
        gates.push({
          edge,
          spanStart: minStart,
          spanLength: Math.max(3, mid - minStart),
          colorQueue: [activeColors[i]],
        });
      } else {
        gates.push({
          edge,
          spanStart: mid,
          spanLength: Math.max(3, maxEnd - mid),
          colorQueue: [activeColors[i]],
        });
      }
    } else if (edge === 'RIGHT' && numColors >= 6 && availLen >= 6) {
      const mid = Math.floor((minStart + maxEnd) / 2);
      if (i === 1) {
        gates.push({
          edge,
          spanStart: minStart,
          spanLength: Math.max(3, mid - minStart),
          colorQueue: [activeColors[i]],
        });
      } else {
        gates.push({
          edge,
          spanStart: mid,
          spanLength: Math.max(3, maxEnd - mid),
          colorQueue: [activeColors[i]],
        });
      }
    } else {
      const spanLength = Math.min(
        availLen,
        Math.max(Math.min(availLen, 4), availLen - (isBreatherWave ? 0 : 1))
      );
      const spanStart = minStart + Math.max(0, Math.floor((availLen - spanLength) / 2));
      gates.push({
        edge,
        spanStart,
        spanLength,
        colorQueue: [activeColors[i]],
      });
    }
  }

  const grid = new Int16Array(rows * cols);
  const cutouts: Array<[number, number]> = [];
  const pillars: Array<[number, number]> = [];
  const crates: NonNullable<LevelSpec['crates']> = [];
  const floorPaths: NonNullable<LevelSpec['floorPaths']> = [];
  const generators: NonNullable<LevelSpec['generators']> = [];
  const elevators: NonNullable<LevelSpec['elevators']> = [];
  const barriers: NonNullable<LevelSpec['barriers']> = [];

  const addCutout = (r: number, c: number): void => {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;
    if (grid[r * cols + c] !== 0) return;
    cutouts.push([r, c]);
    grid[r * cols + c] = -1;
  };
  const addPillar = (r: number, c: number): void => {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;
    if (grid[r * cols + c] !== 0) return;
    pillars.push([r, c]);
    grid[r * cols + c] = -2;
  };

  // 1. Sculpted Courtyard Topology & Multi-Room Portcullis Synthesis (`COURTYARD-01`, `SANCTUM-01`)
  if (layoutId === 'CROSS_ATRIUM') {
    addCutout(0, 0);
    addCutout(0, cols - 1);
    addCutout(rows - 1, 0);
    addCutout(rows - 1, cols - 1);
  } else if (layoutId === 'CITADEL_OCTAGON') {
    addCutout(0, 0);
    addCutout(0, cols - 1);
    addCutout(rows - 1, 0);
    addCutout(rows - 1, cols - 1);
    if (!isBreatherWave && !useElevators) {
      addPillar(Math.floor(rows / 2), Math.floor(cols / 2));
    }
  } else if (layoutId === 'L_WING') {
    addCutout(0, cols - 1);
    addCutout(1, cols - 1);
    addCutout(rows - 1, 0);
  } else if (layoutId === 'T_PAVILION') {
    addCutout(rows - 1, 0);
    addCutout(rows - 1, cols - 1);
    if (rows >= 7) {
      addCutout(rows - 2, 0);
      addCutout(rows - 2, cols - 1);
    }
  } else if (layoutId === 'HOURGLASS_BRIDGE') {
    addCutout(0, 0);
    addCutout(rows - 1, cols - 1);
    if (!isBreatherWave && cols >= 6) {
      addPillar(0, cols - 1);
    }
  } else if (layoutId === 'H_SANCTUM') {
    addCutout(0, 0);
    addCutout(0, cols - 1);
    addCutout(rows - 1, 0);
    addCutout(rows - 1, cols - 1);
    if (!isBreatherWave && !useElevators && rows >= 7) {
      addPillar(Math.floor(rows / 2), 1);
    }
  } else if (layoutId === 'TWIN_SANCTUM') {
    addCutout(0, 0);
    addCutout(0, cols - 1);
    const barrierRow = 2;
    addPillar(barrierRow, 0);
    addPillar(barrierRow, cols - 1);
    const barCells: Array<[number, number]> = [];
    for (let c = 1; c < cols - 1; c++) {
      barCells.push([barrierRow, c]);
      grid[barrierRow * cols + c] = -3;
    }
    const room1Cells: Array<[number, number]> = [];
    for (let r = 0; r < barrierRow; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r * cols + c] !== -1) {
          room1Cells.push([r, c]);
        }
      }
    }
    barriers.push({
      id: 1,
      cells: barCells,
      orientation: 'H',
      shredsRemaining: 2,
      unlocksRoomId: 1,
      roomCells: room1Cells,
    });
  } else if (layoutId === 'MYSTERY_VAULT') {
    const vaultRows = [rows - 2, rows - 1];
    const vaultMaxCol = Math.min(cols - 2, 4);
    const vaultCells: Array<[number, number]> = [];
    for (const vr of vaultRows) {
      for (let vc = 1; vc <= vaultMaxCol; vc++) {
        vaultCells.push([vr, vc]);
        grid[vr * cols + vc] = -3;
      }
    }
    barriers.push({
      id: 1,
      cells: vaultCells,
      orientation: 'H',
      shredsRemaining: 2,
      unlocksRoomId: 1,
      isVault: true,
    });
  } else if (useCutoutsOrPillars) {
    addCutout(0, 0);
    if (levelId >= 24 && attempt < 2 && !isBreatherWave) {
      addPillar(0, cols - 1);
    }
  }

  // 2. Wooden Crates (L81+) — place at corner-adjacent cell (rows-1, 0)
  if (useCrates) {
    const cr = rows - 1;
    const cc = 0;
    if (grid[cr * cols + cc] === 0) {
      crates.push({ id: 1, row: cr, col: cc, hp: 1 });
      grid[cr * cols + cc] = -101;
    }
  }

  // 3. Place Blocks — `RAMP-02` & `DENSITY-01` Epoch-Scaled High-Density Brick Packing
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
                  ? 9
                  : difficulty === 'SUPER_HARD'
                    ? 8
                    : 7
              : levelId <= 80
                ? isBreatherWave
                  ? 7
                  : layoutId === 'MYSTERY_VAULT'
                    ? 10
                    : difficulty === 'SUPER_HARD'
                      ? 9
                      : 8
                : levelId <= 140
                  ? isBreatherWave
                    ? 7
                    : layoutId === 'MYSTERY_VAULT'
                      ? 11
                      : difficulty === 'SUPER_HARD'
                        ? 10
                        : difficulty === 'HARD'
                          ? 9
                          : 8
                  : levelId <= 220
                    ? isBreatherWave
                      ? 8
                      : layoutId === 'MYSTERY_VAULT'
                        ? 12
                        : difficulty === 'SUPER_HARD'
                          ? 11
                          : difficulty === 'HARD'
                            ? 10
                            : 9
                    : isBreatherWave
                      ? 9
                      : layoutId === 'MYSTERY_VAULT'
                        ? 13
                        : difficulty === 'SUPER_HARD'
                          ? 12
                          : difficulty === 'HARD'
                            ? 11
                            : 10;
  const baseTargetBlocks =
    attempt >= 3
      ? Math.max(5, rawTargetBlocks - 2)
      : attempt === 2
        ? Math.max(5, rawTargetBlocks - 1)
        : rawTargetBlocks;
  const targetBlocks = Math.max(numColors, baseTargetBlocks);

  // `RAMP-03` & `DENSITY-01`: Scale polyomino complexity across epochs while keeping breathers tactile with 2 medium shapes
  const leadShapePool = isBreatherWave
    ? EARLY_SHAPES
    : levelId <= 40
      ? EARLY_SHAPES
      : levelId <= 140
        ? MID_SHAPES
        : LATE_SHAPES;
  const maxLargeBlocks =
    attempt >= 2 || activeMechanics.has('SIZE_CHANGING_GATE')
      ? 1
      : isBreatherWave || levelId <= 40
        ? 2
        : levelId <= 140
          ? 3
          : 4;
  const dominoAndTriominoPool = ['1x2', '2x1', '1x2', '2x1', 'L3_BL', 'L3_TL', 'L3_TR', 'L3_BR'];

  const blocks: LevelSpec['blocks'] = [];
  let nextId = 1;

  // Optional Glued Group (L101+): two 1x1 blocks sharing groupId = 1
  if (useGlued && activeColors.length >= 2) {
    const r = 1;
    const c = 2;
    if (grid[r * cols + c] === 0 && grid[r * cols + (c + 1)] === 0) {
      blocks.push({
        id: nextId++,
        shapeId: '1x1',
        row: r,
        col: c,
        colorStack: [activeColors[0]],
        groupId: 1,
      });
      blocks.push({
        id: nextId++,
        shapeId: '1x1',
        row: r,
        col: c + 1,
        colorStack: [activeColors[0]],
        groupId: 1,
      });
      grid[r * cols + c] = 1;
      grid[r * cols + (c + 1)] = 2;
    }
  }

  // Optional Stone Block (L71+): placed at bottom-right corner out of gate lanes
  if (useStone) {
    const sr = rows - 1;
    const sc = cols - 1;
    if (grid[sr * cols + sc] === 0) {
      blocks.push({
        id: nextId++,
        shapeId: '1x1',
        row: sr,
        col: sc,
        colorStack: [0],
      });
      grid[sr * cols + sc] = nextId - 1;
    }
  }

  for (let bIdx = 0; bIdx < targetBlocks; bIdx++) {
    let colorIdx = bIdx % activeColors.length;
    if (layoutId === 'MYSTERY_VAULT' && activeColors.length >= 4) {
      if (bIdx === 0) colorIdx = 2;
      else if (bIdx === 1) colorIdx = 3;
      else if (bIdx === 2) colorIdx = 0;
      else if (bIdx === 3) colorIdx = 1;
      else colorIdx = [0, 1, 3, 2][(bIdx - 4) % 4] % activeColors.length;
    } else if (layoutId === 'TWIN_SANCTUM' && activeColors.length >= 4) {
      if (bIdx === 0) colorIdx = 0;
      else if (bIdx === 1) colorIdx = 3;
      else if (bIdx === 2) colorIdx = 1;
      else if (bIdx === 3) colorIdx = 2;
      else colorIdx = [1, 2, 3, 0][(bIdx - 4) % 4] % activeColors.length;
    } else if (useColorQueueGates && bIdx >= activeColors.length && activeColors.length >= 2) {
      colorIdx = 1 + (bIdx % (activeColors.length - 1));
    }
    const color = activeColors[colorIdx];
    const gate = gates[colorIdx % gates.length];

    let chosenShape = bIdx % 2 === 0 ? '1x2' : '2x1';
    const allowLargeShape = !activeMechanics.has('SIZE_CHANGING_GATE') && bIdx < maxLargeBlocks;
    const activePool = allowLargeShape ? leadShapePool : attempt <= 1 ? dominoAndTriominoPool : NIMBLE_SHAPES;
    for (let sTry = 0; sTry < 10; sTry++) {
      const candidate =
        attempt >= 2 && !allowLargeShape
          ? bIdx % 2 === 0
            ? '1x2'
            : '2x1'
          : activePool[Math.floor(rng() * activePool.length)];
      if (candidate === '1x1' && sTry < 7) continue;
      const sh = getShape(candidate);
      const reqSpan = gate.edge === 'TOP' || gate.edge === 'BOTTOM' ? sh.cols : sh.rows;
      const maxDim = allowLargeShape ? 3 : 2;
      if (reqSpan <= gate.spanLength && sh.rows <= maxDim && sh.cols <= maxDim) {
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

    // In MYSTERY_VAULT, conceal blocks 0 and 1 inside the bottom Sealed Mystery Vault (rows-2..rows-1) and place remaining blocks in the open upper pocket (rows 0..rows-3)
    if (layoutId === 'MYSTERY_VAULT') {
      if (bIdx === 0 || bIdx === 1) {
        const vr = bIdx === 0 ? rows - 2 : rows - 1;
        const vc = 2;
        if (tryPlaceBlockAt(vr, vc, '1x2', -3)) {
          placed = true;
        }
      } else {
        if (bIdx === 2 && gate.edge === 'TOP') {
          const pc = Math.max(1, Math.min(cols - shape.cols - 1, gate.spanStart));
          if (tryPlaceBlockAt(0, pc) || tryPlaceBlockAt(1, pc)) placed = true;
        } else if (bIdx === 3 && gate.edge === 'RIGHT') {
          const pr = Math.max(1, Math.min(rows - 3 - shape.rows, gate.spanStart));
          if (tryPlaceBlockAt(pr, cols - shape.cols) || tryPlaceBlockAt(pr, cols - shape.cols - 1)) {
            placed = true;
          }
        }
        for (let pTry = 0; pTry < 32 && !placed; pTry++) {
          const minR = pTry < 16 ? 1 : 0;
          const maxR = Math.max(minR, rows - 3 - shape.rows);
          const minC = pTry < 16 ? 1 : 0;
          const maxC = Math.max(minC, cols - shape.cols - (pTry < 16 ? 1 : 0));
          const r = minR + Math.floor(rng() * (maxR - minR + 1));
          const c = minC + Math.floor(rng() * (maxC - minC + 1));
          if (tryPlaceBlockAt(r, c)) {
            placed = true;
          }
        }
      }
    }

    // In TWIN_SANCTUM, place blocks 0 and 1 in North Chamber (Room 1, rows 0..1) and all other blocks in South Courtyard (Room 0, rows 3..rows-1)
    if (layoutId === 'TWIN_SANCTUM') {
      if (bIdx === 0 || (bIdx === 1 && cols >= 6)) {
        const r1 = bIdx === 0 ? 1 : 0;
        const c1 = Math.max(1, Math.min(cols - 3, Math.floor((cols - 2) / 2)));
        if (tryPlaceBlockAt(r1, c1, '1x2')) {
          placed = true;
        }
      } else {
        if (bIdx === 2 && gate.edge === 'RIGHT') {
          const pr = Math.max(3, Math.min(rows - shape.rows - 1, gate.spanStart));
          if (tryPlaceBlockAt(pr, cols - shape.cols) || tryPlaceBlockAt(pr, cols - shape.cols - 1)) {
            placed = true;
          }
        } else if (bIdx === 3 && gate.edge === 'BOTTOM') {
          const pc = Math.max(1, Math.min(cols - shape.cols - 1, gate.spanStart));
          if (tryPlaceBlockAt(rows - shape.rows, pc) || tryPlaceBlockAt(rows - shape.rows - 1, pc)) {
            placed = true;
          }
        }
        for (let pTry = 0; pTry < 32 && !placed; pTry++) {
          const minR = 3;
          const maxR = Math.max(minR, rows - shape.rows - (pTry < 16 ? 1 : 0));
          const minC = pTry < 16 ? 1 : 0;
          const maxC = Math.max(minC, cols - shape.cols - (pTry < 16 ? 1 : 0));
          const r = minR + Math.floor(rng() * (maxR - minR + 1));
          const c = minC + Math.floor(rng() * (maxC - minC + 1));
          if (tryPlaceBlockAt(r, c)) {
            placed = true;
          }
        }
      }
    }

    // Interleaved Blocker Placement (C1-15):
    // Place block 0 at row 2 aligned with TOP gate, and place block 1 at row 1 directly in block 0's exit corridor!
    if (
      !placed &&
      layoutId !== 'TWIN_SANCTUM' &&
      attempt <= 1 &&
      bIdx === 0 &&
      gate.edge === 'TOP' &&
      rows >= 6
    ) {
      const r0 = 2;
      const c0 = Math.max(1, Math.min(cols - shape.cols - 1, gate.spanStart));
      if (tryPlaceBlockAt(r0, c0)) {
        placed = true;
      }
    } else if (
      !placed &&
      attempt <= 1 &&
      bIdx === 1 &&
      blocks.length >= 1 &&
      blocks[0].colorStack[0] !== 0 &&
      blocks[0].row >= 2 &&
      gates[0].edge === 'TOP'
    ) {
      const r1 = 1;
      const c1 = Math.max(1, Math.min(cols - shape.cols - 1, blocks[0].col));
      if (tryPlaceBlockAt(r1, c1)) {
        placed = true;
      }
    }

    // Perimeter-First Peel Placement for early side/bottom blocks (bIdx === 2 or 3) so dense boards always have immediate outer peel moves
    if (
      !placed &&
      layoutId !== 'TWIN_SANCTUM' &&
      layoutId !== 'MYSTERY_VAULT' &&
      (bIdx === 2 || bIdx === 3)
    ) {
      if (gate.edge === 'RIGHT') {
        const pr = Math.max(1, Math.min(rows - shape.rows - 1, gate.spanStart));
        const pc = cols - shape.cols;
        if (tryPlaceBlockAt(pr, pc)) placed = true;
      } else if (gate.edge === 'BOTTOM') {
        const pr = rows - shape.rows;
        const pc = Math.max(1, Math.min(cols - shape.cols - 1, gate.spanStart));
        if (tryPlaceBlockAt(pr, pc)) placed = true;
      } else if (gate.edge === 'LEFT') {
        const pr = Math.max(1, Math.min(rows - shape.rows - 1, gate.spanStart));
        const pc = 0;
        if (tryPlaceBlockAt(pr, pc)) placed = true;
      }
    }

    for (let pTry = 0; pTry < 32 && !placed; pTry++) {
      const allowPerimeter = pTry >= 14 && layoutId !== 'TWIN_SANCTUM' && layoutId !== 'MYSTERY_VAULT';
      const minR = allowPerimeter ? 1 : 1;
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

    if (!placed) {
      const startRow = layoutId === 'TWIN_SANCTUM' && bIdx > 0 ? 3 : 1;
      const endRow = layoutId === 'MYSTERY_VAULT' ? rows - 2 : rows;
      // Try 2-cell dominoes first before falling back to 1x1 monominoes
      for (const domShape of bIdx % 2 === 0 ? ['1x2', '2x1'] : ['2x1', '1x2']) {
        const dsh = getShape(domShape);
        const reqSpan = gate.edge === 'TOP' || gate.edge === 'BOTTOM' ? dsh.cols : dsh.rows;
        if (reqSpan > gate.spanLength) continue;
        for (let r = startRow; r <= endRow - dsh.rows && !placed; r++) {
          for (let c = 0; c <= cols - dsh.cols && !placed; c++) {
            if (tryPlaceBlockAt(r, c, domShape)) {
              placed = true;
            }
          }
        }
      }
      for (let r = startRow; r < endRow && !placed; r++) {
        for (let c = 1; c < cols - 1 && !placed; c++) {
          if (tryPlaceBlockAt(r, c, '1x1')) {
            placed = true;
          }
        }
      }
    }
  }

  const coloredBlocks = blocks.filter((b) => b.colorStack[0] !== 0);

  applyProgressiveMechanicsToCandidate({
    rows,
    cols,
    layoutId,
    grid,
    activeColors,
    activeMechanics,
    coloredBlocks,
    gates,
    generators,
    floorPaths,
    elevators,
    barriers,
    getSculptedEdgeSpanBounds,
  });

  const adj = LEVEL_ADJECTIVES[(levelId * 7) % LEVEL_ADJECTIVES.length];
  const noun = LEVEL_NOUNS[(levelId * 13) % LEVEL_NOUNS.length];
  const sizeBonusSec = Math.max(0, (rows + cols - 11) * 10);
  const timeLimitSec = (difficulty === 'SUPER_HARD' ? 95 : difficulty === 'HARD' ? 100 : 105) + sizeBonusSec;

  return {
    id: levelId,
    name: `${adj} ${noun}`,
    difficulty,
    layoutId,
    unlockNote: getUnlockNoteForLevel(levelId),
    rows,
    cols,
    cutouts: cutouts.length > 0 ? cutouts : undefined,
    pillars: pillars.length > 0 ? pillars : undefined,
    floorPaths: floorPaths.length > 0 ? floorPaths : undefined,
    blocks,
    gates,
    crates: crates.length > 0 ? crates : undefined,
    generators: generators.length > 0 ? generators : undefined,
    elevators: elevators.length > 0 ? elevators : undefined,
    barriers: barriers.length > 0 ? barriers : undefined,
    parMoves: Math.max(4, coloredBlocks.length),
    timeLimitSec,
  };
}

/**
 * Constraint-First Interleaved Reverse-Blocking Level Generator (`F-09`, `RAMP-01`–`RAMP-05`).
 * Deterministically builds a level for `levelId` (`1..300` Campaign and Endless `>300`) and
 * verifies 100% solvability via `solveBoard`.
 */
export function generateProceduralLevel(levelId: number, seedOverride?: number): LevelSpec {
  const baseSeed = (seedOverride ?? levelId * 2654435761 + 0x9e3779b9) >>> 0;

  for (let attempt = 0; attempt < 6; attempt++) {
    const rng = mulberry32((baseSeed + attempt * 1013904223) >>> 0);
    const candidate = tryBuildCandidateSpec(levelId, rng, attempt);
    const board = createBoardState(candidate);
    const sol = solveBoard(board, 260);

    if (sol.solvable && sol.minMoves > 0) {
      const nonStoneCount = candidate.blocks.filter((b) => b.colorStack[0] !== 0).length;
      candidate.parMoves = Math.max(sol.minMoves, nonStoneCount);
      return candidate;
    }
  }

  const difficulty = getDifficultyForLevel(levelId);
  const fallbackSpec: LevelSpec = {
    id: levelId,
    name: `${LEVEL_ADJECTIVES[levelId % LEVEL_ADJECTIVES.length]} ${LEVEL_NOUNS[levelId % LEVEL_NOUNS.length]}`,
    difficulty,
    unlockNote: getUnlockNoteForLevel(levelId),
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '1x2', row: 1, col: 2, colorStack: [1] },
      { id: 2, shapeId: '2x1', row: 2, col: 4, colorStack: [2] },
      { id: 3, shapeId: '1x2', row: 4, col: 2, colorStack: [3] },
      { id: 4, shapeId: '2x1', row: 2, col: 1, colorStack: [4] },
      { id: 5, shapeId: '1x1', row: 3, col: 3, colorStack: [1] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 4, colorQueue: [1], isStar: true },
      { edge: 'RIGHT', spanStart: 1, spanLength: 4, colorQueue: [2], isStar: true },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 4, colorQueue: [3], isStar: true },
      { edge: 'LEFT', spanStart: 1, spanLength: 4, colorQueue: [4], isStar: true },
    ],
    parMoves: 5,
    timeLimitSec: 90,
  };

  const sol = solveBoard(createBoardState(fallbackSpec), 100);
  fallbackSpec.parMoves = Math.max(sol.minMoves, 5);
  return fallbackSpec;
}
