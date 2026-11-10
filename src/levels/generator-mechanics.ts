import { getShape } from '../core/polyomino';
import type { AxisLock, ColorId, CourtyardLayoutId, EdgeDir, LevelSpec } from '../core/types';
import { canAddBlockModifier, type MechanicId } from './generator-rules';

export interface CandidateMechanicsContext {
  rows: number;
  cols: number;
  layoutId: CourtyardLayoutId;
  grid: Int16Array;
  activeColors: ColorId[];
  activeMechanics: Set<MechanicId>;
  coloredBlocks: LevelSpec['blocks'];
  gates: LevelSpec['gates'];
  generators: NonNullable<LevelSpec['generators']>;
  floorPaths: NonNullable<LevelSpec['floorPaths']>;
  elevators: NonNullable<LevelSpec['elevators']>;
  barriers: NonNullable<LevelSpec['barriers']>;
  getSculptedEdgeSpanBounds: (edge: EdgeDir) => { minStart: number; maxEnd: number };
}

export function applyProgressiveMechanicsToCandidate(ctx: CandidateMechanicsContext): void {
  const {
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
  } = ctx;
  const lockedCellKeys = new Set<number>();
  for (const bar of barriers) {
    const cells = bar.roomCells ?? bar.cells;
    for (const [r, c] of cells) {
      lockedCellKeys.add(r * cols + c);
    }
  }
  const isInStartingRoom = (b: LevelSpec['blocks'][number]): boolean => {
    if (layoutId === 'TWIN_SANCTUM' && b.row <= 2) return false;
    const sh = getShape(b.shapeId);
    for (const [dr, dc] of sh.cells) {
      if (lockedCellKeys.has((b.row + dr) * cols + (b.col + dc))) return false;
    }
    return true;
  };
  const useAxisLock = activeMechanics.has('AXIS_LOCK');
  const useMultiLayer = activeMechanics.has('MULTI_LAYER');
  const useIceBlocks = activeMechanics.has('ICE_BLOCKS');
  const useStar = activeMechanics.has('STAR');
  const useKeyLock = activeMechanics.has('KEY_LOCK');
  const useBombs = activeMechanics.has('BOMBS');
  const useRopes = activeMechanics.has('ROPES');
  const useColorQueueGates = activeMechanics.has('COLOR_QUEUE_GATES');
  const useFrozenGates = activeMechanics.has('FROZEN_GATES');
  const useShutterLock = activeMechanics.has('SHUTTER_LOCK');
  const useTogglingGate = activeMechanics.has('TOGGLING_GATE');
  const useSlidingGate = activeMechanics.has('SLIDING_GATE');
  const useSizeChangingGate = activeMechanics.has('SIZE_CHANGING_GATE');
  const useGenerators = activeMechanics.has('GENERATORS');
  const useFloorPaths = activeMechanics.has('FLOOR_PATHS');
  const useElevators = activeMechanics.has('ELEVATORS');
  // 4. Apply Progressive Modifiers (strictly respecting UX-03 mutual exclusivity & MAX_MODIFIERS_PER_BLOCK)
  // Axis Lock (L11+): only lock a block whose lane to its matching gate is completely clear
  if (useAxisLock && coloredBlocks.length > 0) {
    for (const b of coloredBlocks) {
      if (!canAddBlockModifier(b, 'OTHER')) continue;
      const sh = getShape(b.shapeId);
      const gate = gates.find((g) => g.colorQueue[0] === b.colorStack[0]);
      if (!gate) continue;
      if (
        gate.edge === 'TOP' &&
        b.col >= gate.spanStart &&
        b.col + sh.cols <= gate.spanStart + gate.spanLength
      ) {
        let clearToTop = true;
        for (let r = 0; r < b.row; r++) {
          for (let c = b.col; c < b.col + sh.cols; c++) {
            if (grid[r * cols + c] !== 0 && grid[r * cols + c] !== b.id) clearToTop = false;
          }
        }
        if (clearToTop) {
          b.axisLock = 'V' as AxisLock;
          break;
        }
      } else if (
        gate.edge === 'RIGHT' &&
        b.row >= gate.spanStart &&
        b.row + sh.rows <= gate.spanStart + gate.spanLength
      ) {
        let clearToRight = true;
        for (let r = b.row; r < b.row + sh.rows; r++) {
          for (let c = b.col + sh.cols; c < cols; c++) {
            if (grid[r * cols + c] !== 0 && grid[r * cols + c] !== b.id) clearToRight = false;
          }
        }
        if (clearToRight) {
          b.axisLock = 'H' as AxisLock;
          break;
        }
      }
    }
  }

  // Multi-Layer Blocks (L31+)
  if (useMultiLayer && coloredBlocks.length >= 2 && activeColors.length >= 2) {
    const target = coloredBlocks.find(
      (b) => isInStartingRoom(b) && canAddBlockModifier(b, 'OTHER') && !b.axisLock
    );
    if (target) {
      const innerColor = activeColors.find((c) => c !== target.colorStack[0]) ?? activeColors[0];
      target.colorStack = [target.colorStack[0], innerColor];
    }
  }

  // Ice Blocks (L41+)
  if (useIceBlocks && coloredBlocks.length >= 3) {
    const target = [...coloredBlocks]
      .reverse()
      .find((b) => isInStartingRoom(b) && canAddBlockModifier(b, 'IMMOBILIZER'));
    if (target) {
      target.iceCount = 1;
    }
  }

  // Star Blocks & Star Gates (L51+)
  if (useStar && coloredBlocks.length >= 2) {
    const starCandidate =
      coloredBlocks.find(
        (b) => isInStartingRoom(b) && b.colorStack.length === 1 && canAddBlockModifier(b, 'PAYLOAD')
      ) ?? coloredBlocks.find((b) => isInStartingRoom(b) && canAddBlockModifier(b, 'PAYLOAD'));
    if (starCandidate) {
      for (const layerColor of starCandidate.colorStack) {
        const gate = gates.find((g) => g.colorQueue.includes(layerColor));
        if (gate) gate.isStar = true;
      }
      starCandidate.isStar = true;
    }
  }

  // Key & Lock (Chained) Blocks (L61+)
  if (useKeyLock && coloredBlocks.length >= 3) {
    const keyCarrier = coloredBlocks.find(
      (b) =>
        isInStartingRoom(b) && !b.iceCount && !b.chained && !b.ropeColor && canAddBlockModifier(b, 'PAYLOAD')
    );
    const lockedTarget = [...coloredBlocks]
      .reverse()
      .find(
        (b) =>
          isInStartingRoom(b) && b.id !== keyCarrier?.id && !b.hasKey && canAddBlockModifier(b, 'IMMOBILIZER')
      );
    if (keyCarrier && lockedTarget) {
      keyCarrier.hasKey = 1;
      lockedTarget.chained = true;
      lockedTarget.lockId = 1;
    }
  }

  // Bomb Blocks (L91+, `RAMP-04`: generous countdown so players never feel cheated)
  if (useBombs && coloredBlocks.length >= 2) {
    const bombCandidate = coloredBlocks.find(
      (b) =>
        isInStartingRoom(b) && !b.iceCount && !b.chained && !b.ropeColor && canAddBlockModifier(b, 'PAYLOAD')
    );
    if (bombCandidate) {
      bombCandidate.bombCount = Math.max(16, coloredBlocks.length * 3 + 2);
    }
  }

  // Colored Ropes & Scissors (L111+)
  if (useRopes && coloredBlocks.length >= 3) {
    const scissorHolder = coloredBlocks.find(
      (b) =>
        isInStartingRoom(b) && !b.iceCount && !b.chained && !b.ropeColor && canAddBlockModifier(b, 'PAYLOAD')
    );
    const ropedTarget = [...coloredBlocks]
      .reverse()
      .find(
        (b) =>
          isInStartingRoom(b) &&
          b.id !== scissorHolder?.id &&
          !b.hasKey &&
          !b.scissorColor &&
          canAddBlockModifier(b, 'IMMOBILIZER')
      );
    if (scissorHolder && ropedTarget) {
      const ropeCol = activeColors[0];
      scissorHolder.scissorColor = ropeCol;
      ropedTarget.ropeColor = ropeCol;
    }
  }

  // Frozen Gates (L131+ or synchronized MYSTERY_VAULT gate countdowns `GATE-ICE-01`)
  if ((useFrozenGates || layoutId === 'MYSTERY_VAULT') && gates.length >= 3) {
    const lastGate = gates[gates.length - 1];
    const lastColor = lastGate.colorQueue[0];
    const unlockedOtherBlocks = coloredBlocks.filter(
      (b) => isInStartingRoom(b) && b.colorStack[0] !== lastColor && !b.iceCount && !b.chained && !b.ropeColor
    );
    if (unlockedOtherBlocks.length >= 2) {
      lastGate.iceCount = layoutId === 'MYSTERY_VAULT' ? 2 : 1;
    }
  }

  // Locked Shutter Gates & Shutter Gems (L141+)
  if (useShutterLock && gates.length >= 3 && coloredBlocks.length >= 3) {
    const lockedGate = gates[gates.length - 1];
    const lockedGateColor = lockedGate.colorQueue[0];
    const gemCarrier = coloredBlocks.find(
      (b) =>
        isInStartingRoom(b) &&
        b.colorStack[0] !== lockedGateColor &&
        !b.iceCount &&
        !b.chained &&
        !b.ropeColor &&
        canAddBlockModifier(b, 'PAYLOAD')
    );
    if (gemCarrier && !lockedGate.iceCount) {
      const gemColor = gemCarrier.colorStack[0];
      gemCarrier.shutterGemColor = gemColor;
      lockedGate.shutterLockColor = gemColor;
      lockedGate.shutterOpen = false;
    }
  }

  // Toggling Shutter Gates (L145+, `RAMP-01` & `DRAG-06`: no duplicate TOP gate overlap)
  if (useTogglingGate && gates.length >= 3) {
    const toggleGate = gates[gates.length - 1];
    if (!toggleGate.shutterLockColor) {
      toggleGate.togglesOnClear = true;
      toggleGate.shutterOpen = true;
    }
  }

  const singleEdgeGates = gates.filter(
    (g) => gates.filter((o) => o.edge === g.edge && (o.edgeLine ?? 0) === (g.edgeLine ?? 0)).length === 1
  );

  // Sliding Gates (L151+)
  if (useSlidingGate && singleEdgeGates.length >= 1) {
    const gSlide = singleEdgeGates[0];
    const { minStart, maxEnd } = getSculptedEdgeSpanBounds(gSlide.edge);
    const availLen = Math.max(3, maxEnd - minStart);
    gSlide.slidesOnClear = true;
    gSlide.spanLength = Math.max(3, Math.min(4, availLen - 1));
    gSlide.spanStart = Math.max(minStart, Math.min(gSlide.spanStart, maxEnd - gSlide.spanLength));
    gSlide.slideMin = minStart;
    gSlide.slideMax = Math.max(minStart, maxEnd - gSlide.spanLength);
    gSlide.slideDir = 1;
  }

  // Size-Changing Gates (L155+)
  if (useSizeChangingGate && singleEdgeGates.length >= 1) {
    const gSize = singleEdgeGates[1] ?? singleEdgeGates[0];
    const { minStart, maxEnd } = getSculptedEdgeSpanBounds(gSize.edge);
    const availLen = Math.max(3, maxEnd - minStart);
    gSize.sizeChangesOnClear = true;
    gSize.maxLength = Math.max(3, Math.min(4, availLen));
    gSize.minLength = Math.max(2, Math.min(3, gSize.maxLength - 1));
    gSize.spanLength = gSize.maxLength;
    gSize.spanStart = Math.max(minStart, Math.min(gSize.spanStart, maxEnd - gSize.maxLength));
  }

  // Block Generators (L161+)
  if (useGenerators) {
    const minGenRow = layoutId === 'TWIN_SANCTUM' ? 3 : 0;
    let genR = -1;
    let genC = -1;
    let spawnR = -1;
    let spawnC = -1;
    for (let c = 1; c < cols - 1; c++) {
      for (let r = minGenRow; r < rows; r++) {
        if (grid[r * cols + c] === 0) {
          if (genR < 0) {
            genR = r;
            genC = c;
          } else if (spawnR < 0) {
            spawnR = r;
            spawnC = c;
            break;
          }
        }
      }
      if (genR >= 0 && spawnR >= 0) break;
    }
    if (genR >= 0 && spawnR >= 0) {
      grid[genR * cols + genC] = -2;
      generators.push({
        id: 1,
        row: genR,
        col: genC,
        spawnRow: spawnR,
        spawnCol: spawnC,
        cooldown: 1,
        queue: [
          {
            shapeId: '1x1',
            colorStack: [activeColors[0]],
          },
        ],
      });
    }
  }

  // Color-Changing Gates (L121+, C1-04):
  // Ensure g0.colorQueue accounts for all c0 layers that depend on g0 before transitioning to cSecond!
  if (useColorQueueGates && gates.length >= 2 && coloredBlocks.length >= 2) {
    const g0 = gates[0];
    const c0 = g0.colorQueue[0];
    const cSecond = activeColors[1] ?? activeColors[0];
    let c0Supply = 0;
    for (const b of coloredBlocks) {
      for (const c of b.colorStack) {
        if (c === c0) c0Supply++;
      }
    }
    for (const gen of generators) {
      for (const q of gen.queue) {
        for (const c of q.colorStack) {
          if (c === c0) c0Supply++;
        }
      }
    }
    const copies = Math.max(1, c0Supply);
    g0.colorQueue = [...Array(copies).fill(c0), cSecond];
  }

  // Colorful Floor Paths (L171+)
  if (useFloorPaths && coloredBlocks.length > 0) {
    const b0 = coloredBlocks.find(isInStartingRoom) ?? coloredBlocks[0];
    floorPaths.push({
      row: b0.row,
      col: b0.col,
      color: b0.colorStack[0],
    });
  }

  // Moving Elevators (L181+)
  if (useElevators) {
    const midR = Math.floor(rows / 2);
    const candidateRows = [midR, midR + 1, midR - 1, rows - 2];
    for (const er of candidateRows) {
      if (er < 1 || er >= rows - 1) continue;
      if (layoutId === 'TWIN_SANCTUM' && er <= 2) continue;
      if (cols >= 5 && grid[er * cols + 1] >= 0 && grid[er * cols + 2] >= 0 && grid[er * cols + 3] >= 0) {
        elevators.push({
          id: 1,
          row: er,
          col: 1,
          width: 2,
          height: 1,
          deltaRow: 0,
          deltaCol: 1,
        });
        break;
      }
    }
  }
}
