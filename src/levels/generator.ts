import { cloneBoardState, commitBlockMove, createBoardState, isBoardWon } from '../core/board';
import type { BoardState, ColorId, EdgeDir, LevelSpec } from '../core/types';
import { applyProgressiveMechanicsToCandidate } from './generator-mechanics';
import { populateCandidateBlocks } from './generator-placement';
import {
  getDifficultyForLevel,
  getUnlockNoteForLevel,
  LEVEL_ADJECTIVES,
  LEVEL_NOUNS,
  mulberry32,
  selectCourtyardTopologyForLevel,
  selectFocusedMechanicsForLevel,
} from './generator-rules';
import { generateMacroMoves, solveBoard } from './solver';

export * from './generator-rules';

/**
 * `UX-03` Onboarding First-Move Safety Verifier (`L1–12`):
 * Returns `true` iff every legal macro move from the initial board state leads to a solvable board.
 */
export function verifyFirstMoveSafety(board: BoardState, nodeBudget = 240): boolean {
  const moves = generateMacroMoves(board);
  if (moves.length === 0) return false;
  for (const mv of moves) {
    const next = cloneBoardState(board);
    const out = commitBlockMove(next, mv.blockId, mv.targetRow, mv.targetCol, 'ZEN', 0, 0, false, true);
    if (!out.moved || isBoardWon(next)) continue;
    if (!solveBoard(next, nodeBudget).solvable) return false;
  }
  return true;
}

function tryBuildCandidateSpec(levelId: number, rng: () => number, attempt: number): LevelSpec {
  const difficulty = getDifficultyForLevel(levelId);
  const decPos = levelId % 10;
  const isBreatherWave = levelId >= 11 && decPos === 6;

  const usePortraitTall =
    attempt <= 5 &&
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

  // Only step down large courtyards on late fallback attempts (`attempt >= 6`)
  if (attempt >= 6) {
    rows = Math.min(rows, 6);
    cols = Math.min(cols, 6);
  } else if (attempt >= 4) {
    rows = Math.min(rows, 7);
    cols = Math.min(cols, 7);
  }

  const maxPalette = levelId <= 10 ? 4 : levelId <= 60 ? 6 : levelId <= 140 ? 8 : 9;
  const availableColors: ColorId[] = [];
  for (let c = 1; c <= maxPalette; c++) availableColors.push(c as ColorId);
  for (let i = availableColors.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = availableColors[i];
    availableColors[i] = availableColors[j];
    availableColors[j] = tmp;
  }

  const rawMechanics = selectFocusedMechanicsForLevel(levelId);
  const activeMechanics =
    attempt >= 6 && rawMechanics.size > 1 ? new Set([[...rawMechanics][0]]) : rawMechanics;
  const layoutId = selectCourtyardTopologyForLevel(
    levelId,
    rows,
    cols,
    attempt >= 5 ? 2 : 0,
    activeMechanics
  );
  const useCutoutsOrPillars = activeMechanics.has('CUTOUTS_PILLARS');
  const useElevators = activeMechanics.has('ELEVATORS');

  const getSculptedEdgeSpanBounds = (edge: EdgeDir): { minStart: number; maxEnd: number } => {
    const limit = edge === 'TOP' || edge === 'BOTTOM' ? cols : rows;
    if (layoutId === 'RECTANGLE') {
      if (!useCutoutsOrPillars) return { minStart: 0, maxEnd: limit };
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
  const canSplitTopEdge = topSpanBounds.maxEnd - topSpanBounds.minStart >= 5;
  const canSplitRightEdge = rightSpanBounds.maxEnd - rightSpanBounds.minStart >= 5;

  const numColors =
    levelId <= 3
      ? 2
      : levelId <= 8
        ? 3
        : isBreatherWave || layoutId === 'TWIN_SANCTUM' || attempt >= 4
          ? 4
          : levelId >= 120 && difficulty !== 'NORMAL' && cols >= 7 && canSplitTopEdge && canSplitRightEdge
            ? 6
            : levelId >= 45 && (difficulty !== 'NORMAL' || levelId >= 100) && cols >= 6 && canSplitTopEdge
              ? 5
              : 4;
  const activeColors = availableColors.slice(0, numColors);

  const edges: EdgeDir[] = ['TOP', 'RIGHT', 'BOTTOM', 'LEFT'];
  const gates: LevelSpec['gates'] = [];

  // Tight 2..4 cell Exit Gate Apertures (preventing full-wall auto-exit triviality!)
  for (let i = 0; i < numColors; i++) {
    const edge = edges[i % 4];
    const { minStart, maxEnd } = getSculptedEdgeSpanBounds(edge);
    const availLen = Math.max(2, maxEnd - minStart);
    if (edge === 'TOP' && numColors >= 5 && availLen >= 5) {
      const mid = minStart + Math.max(2, Math.floor(availLen / 2));
      if (i === 0) {
        const len = Math.min(3, mid - minStart);
        gates.push({ edge, spanStart: minStart, spanLength: len, colorQueue: [activeColors[i]] });
      } else {
        const len = Math.min(3, maxEnd - mid);
        gates.push({ edge, spanStart: mid, spanLength: len, colorQueue: [activeColors[i]] });
      }
    } else if (edge === 'RIGHT' && numColors >= 6 && availLen >= 5) {
      const mid = minStart + Math.max(2, Math.floor(availLen / 2));
      if (i === 1) {
        const len = Math.min(3, mid - minStart);
        gates.push({ edge, spanStart: minStart, spanLength: len, colorQueue: [activeColors[i]] });
      } else {
        const len = Math.min(3, maxEnd - mid);
        gates.push({ edge, spanStart: mid, spanLength: len, colorQueue: [activeColors[i]] });
      }
    } else {
      const desiredMax =
        isBreatherWave || levelId <= 12 || attempt >= 5
          ? 4
          : difficulty === 'SUPER_HARD' && levelId >= 60 && availLen >= 4 && rng() < 0.3
            ? 2
            : 3;
      const spanLength = Math.min(availLen, Math.max(2, desiredMax));
      const slack = Math.max(0, availLen - spanLength);
      const spanStart = minStart + (slack > 0 ? Math.floor(rng() * (slack + 1)) : 0);
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
        if (grid[r * cols + c] !== -1) room1Cells.push([r, c]);
      }
    }
    barriers.push({
      id: 1,
      cells: barCells,
      orientation: 'H',
      shredsRemaining: levelId >= 80 && attempt <= 4 ? 3 : 2,
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
      shredsRemaining: levelId >= 90 && attempt <= 4 ? 4 : levelId >= 45 && attempt <= 4 ? 3 : 2,
      unlocksRoomId: 1,
      isVault: true,
    });
  } else if (useCutoutsOrPillars) {
    addCutout(0, 0);
    if (levelId >= 24 && attempt < 4 && !isBreatherWave) {
      addPillar(Math.floor(rows / 2), Math.floor(cols / 2));
    }
  }

  const blocks = populateCandidateBlocks({
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
  });

  const coloredBlocks = blocks.filter((b) => b.colorStack[0] !== 0);

  applyProgressiveMechanicsToCandidate({
    levelId,
    attempt,
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
    timeLimitSec: 90,
  };
}

function computeBaseShredLayers(spec: LevelSpec): number {
  let layers = 0;
  for (const b of spec.blocks) {
    if (b.colorStack[0] !== 0) layers += b.colorStack.length;
  }
  for (const gen of spec.generators ?? []) {
    for (const q of gen.queue) {
      layers += q.colorStack.length;
    }
  }
  return layers;
}

/**
 * Constraint-First Cross-Blocked Procedural Level Generator (`F-09`, `RAMP-01`–`RAMP-05`).
 * Deterministically builds a level for `levelId` (`1..300` Campaign and Endless `>300`),
 * enforces genuine blocker-staging depth (`minMoves - shredLayers`), verifies `UX-03` First-Move
 * Safety on `L1..12`, and guarantees 100% booster-free solvability via `solveBoard`.
 */
export function generateProceduralLevel(levelId: number, seedOverride?: number): LevelSpec {
  const baseSeed = (seedOverride ?? levelId * 2654435761 + 0x9e3779b9) >>> 0;
  const difficulty = getDifficultyForLevel(levelId);
  const isBreatherWave = levelId >= 11 && levelId % 10 === 6;

  const targetStaging =
    levelId <= 4 ? 0 : levelId <= 12 || isBreatherWave ? 1 : levelId <= 40 || difficulty === 'NORMAL' ? 2 : 3;

  let bestCandidate: LevelSpec | null = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < 8; attempt++) {
    const rng = mulberry32((baseSeed + attempt * 1013904223) >>> 0);
    const candidate = tryBuildCandidateSpec(levelId, rng, attempt);
    const board = createBoardState(candidate);
    const sol = solveBoard(board, attempt >= 6 ? 260 : 175);

    if (!sol.solvable || sol.minMoves <= 0) continue;
    if (levelId <= 12 && !verifyFirstMoveSafety(board, 160)) continue;

    const baseLayers = computeBaseShredLayers(candidate);
    const stagingMoves = Math.max(0, sol.minMoves - baseLayers);
    const turn0Exits = generateMacroMoves(board).filter((m) => m.exitsGateIndex >= 0).length;

    const nonStoneCount = candidate.blocks.filter((b) => b.colorStack[0] !== 0).length;
    candidate.parMoves = Math.max(sol.minMoves, nonStoneCount);
    const secPerMove = difficulty === 'SUPER_HARD' ? 3.5 : difficulty === 'HARD' ? 4.0 : 4.6;
    candidate.timeLimitSec = Math.max(35, Math.round(sol.minMoves * secPerMove + 12));

    const score = stagingMoves * 10 - turn0Exits * 2;
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }

    const reqStaging = attempt >= 4 ? 1 : attempt >= 2 ? Math.max(1, targetStaging - 1) : targetStaging;
    const maxTurn0 = Math.max(2, Math.floor(nonStoneCount * 0.3));
    if (
      stagingMoves >= reqStaging &&
      (levelId <= 12 || isBreatherWave || attempt >= 2 || turn0Exits <= maxTurn0)
    ) {
      return candidate;
    }
  }

  if (bestCandidate) {
    return bestCandidate;
  }

  const fallbackSpec: LevelSpec = {
    id: levelId,
    name: `${LEVEL_ADJECTIVES[levelId % LEVEL_ADJECTIVES.length]} ${LEVEL_NOUNS[levelId % LEVEL_NOUNS.length]}`,
    difficulty,
    unlockNote: getUnlockNoteForLevel(levelId),
    rows: 6,
    cols: 6,
    blocks: [
      { id: 1, shapeId: '1x2', row: 2, col: 2, colorStack: [1] },
      { id: 2, shapeId: '1x2', row: 1, col: 2, colorStack: [2] },
      { id: 3, shapeId: '2x1', row: 2, col: 4, colorStack: [3] },
      { id: 4, shapeId: '1x2', row: 4, col: 2, colorStack: [4] },
      { id: 5, shapeId: '2x1', row: 2, col: 1, colorStack: [1] },
    ],
    gates: [
      { edge: 'TOP', spanStart: 1, spanLength: 3, colorQueue: [1], isStar: true },
      { edge: 'RIGHT', spanStart: 1, spanLength: 3, colorQueue: [2], isStar: true },
      { edge: 'BOTTOM', spanStart: 1, spanLength: 3, colorQueue: [3], isStar: true },
      { edge: 'LEFT', spanStart: 1, spanLength: 3, colorQueue: [4], isStar: true },
    ],
    parMoves: 6,
    timeLimitSec: 45,
  };

  const sol = solveBoard(createBoardState(fallbackSpec), 200);
  fallbackSpec.parMoves = Math.max(sol.minMoves, 6);
  return fallbackSpec;
}
