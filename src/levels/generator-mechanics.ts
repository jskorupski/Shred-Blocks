import { getShape } from '../core/polyomino';
import type { AxisLock, ColorId, CourtyardLayoutId, EdgeDir, LevelSpec } from '../core/types';
import { canAddBlockModifier, getDifficultyForLevel, type MechanicId } from './generator-rules';

export interface CandidateMechanicsContext {
  levelId: number;
  attempt: number;
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
  } = ctx;
  const difficulty = getDifficultyForLevel(levelId);
  const isBreather = levelId >= 11 && levelId % 10 === 6;

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

  // 1. Axis Lock (L11+): lock 1..3 blocks whose locked rail aligns with a matching gate (even if movable blockers currently sit in that lane!)
  if (useAxisLock && coloredBlocks.length > 0) {
    const maxAxisLocks = isBreather || levelId <= 30 ? 1 : levelId >= 121 && difficulty !== 'NORMAL' ? 3 : 2;
    let lockedCount = 0;
    for (const b of coloredBlocks) {
      if (lockedCount >= maxAxisLocks) break;
      if (!canAddBlockModifier(b, 'OTHER') || b.groupId) continue;
      const sh = getShape(b.shapeId);
      const gate = gates.find((g) => g.colorQueue[0] === b.colorStack[0]);
      if (!gate) continue;
      if (
        (gate.edge === 'TOP' || gate.edge === 'BOTTOM') &&
        b.col >= gate.spanStart &&
        b.col + sh.cols <= gate.spanStart + gate.spanLength
      ) {
        let hardBlocked = false;
        const rStart = gate.edge === 'TOP' ? 0 : b.row + sh.rows;
        const rEnd = gate.edge === 'TOP' ? b.row : rows;
        for (let r = rStart; r < rEnd; r++) {
          for (let c = b.col; c < b.col + sh.cols; c++) {
            const occ = grid[r * cols + c];
            if (occ === -1 || occ === -2 || occ < -100) hardBlocked = true;
          }
        }
        if (!hardBlocked) {
          b.axisLock = 'V' as AxisLock;
          lockedCount++;
        }
      } else if (
        (gate.edge === 'LEFT' || gate.edge === 'RIGHT') &&
        b.row >= gate.spanStart &&
        b.row + sh.rows <= gate.spanStart + gate.spanLength
      ) {
        let hardBlocked = false;
        const cStart = gate.edge === 'LEFT' ? 0 : b.col + sh.cols;
        const cEnd = gate.edge === 'LEFT' ? b.col : cols;
        for (let r = b.row; r < b.row + sh.rows; r++) {
          for (let c = cStart; c < cEnd; c++) {
            const occ = grid[r * cols + c];
            if (occ === -1 || occ === -2 || occ < -100) hardBlocked = true;
          }
        }
        if (!hardBlocked) {
          b.axisLock = 'H' as AxisLock;
          lockedCount++;
        }
      }
    }
  }

  const fitsGateForColor = (shapeId: string, color: ColorId): boolean => {
    const sh = getShape(shapeId);
    return gates.some((g) => {
      if (!g.colorQueue.includes(color)) return false;
      const req = g.edge === 'TOP' || g.edge === 'BOTTOM' ? sh.cols : sh.rows;
      const effLen = g.sizeChangesOnClear ? (g.maxLength ?? g.spanLength) : g.spanLength;
      return req <= effLen;
    });
  };

  // 2. Multi-Layer Blocks (L31+): 1..3 layered blocks (up to 3 layers on L150+ SUPER_HARD)
  if (useMultiLayer && coloredBlocks.length >= 2 && activeColors.length >= 2) {
    const maxLayered = isBreather || levelId <= 55 ? 1 : levelId >= 141 && difficulty !== 'NORMAL' ? 3 : 2;
    let layeredCount = 0;
    for (let i = 0; i < coloredBlocks.length && layeredCount < maxLayered; i++) {
      const target = coloredBlocks[i];
      if (!isInStartingRoom(target) || !canAddBlockModifier(target, 'OTHER') || target.axisLock) continue;
      const cOuter = target.colorStack[0];
      const innerCandidates = activeColors.filter((c) => c !== cOuter && fitsGateForColor(target.shapeId, c));
      if (innerCandidates.length === 0) continue;
      const inner1 = innerCandidates[layeredCount % innerCandidates.length];
      if (
        layeredCount === 0 &&
        levelId >= 150 &&
        difficulty === 'SUPER_HARD' &&
        innerCandidates.length >= 2
      ) {
        const inner2 = innerCandidates[(layeredCount + 1) % innerCandidates.length];
        target.colorStack = [cOuter, inner1, inner2];
      } else {
        target.colorStack = [cOuter, inner1];
      }
      layeredCount++;
    }
  }

  // 3. Ice Blocks (L41+): staggered iceCount 2..4 across 1..3 blocks
  if (useIceBlocks && coloredBlocks.length >= 4) {
    const roomBlocks = coloredBlocks.filter(isInStartingRoom);
    const maxFrozen = isBreather || levelId <= 60 ? 1 : levelId >= 151 && difficulty !== 'NORMAL' ? 3 : 2;
    let frozenApplied = 0;
    for (let i = roomBlocks.length - 1; i >= 0 && frozenApplied < maxFrozen; i--) {
      const target = roomBlocks[i];
      if (!canAddBlockModifier(target, 'IMMOBILIZER')) continue;
      const safeMaxIce = Math.max(1, roomBlocks.length - maxFrozen - 2);
      const desiredIce = isBreather ? 1 : Math.min(4, 2 + frozenApplied);
      target.iceCount = Math.min(safeMaxIce, desiredIce);
      frozenApplied++;
    }
  }

  // 4. Star Blocks & Star Gates (L51+): 1..2 Star blocks
  if (useStar && coloredBlocks.length >= 2) {
    const maxStars = !isBreather && levelId >= 95 && difficulty !== 'NORMAL' ? 2 : 1;
    let starsApplied = 0;
    for (const b of coloredBlocks) {
      if (starsApplied >= maxStars) break;
      if (!isInStartingRoom(b) || !canAddBlockModifier(b, 'PAYLOAD')) continue;
      for (const layerColor of b.colorStack) {
        const gate = gates.find((g) => g.colorQueue.includes(layerColor));
        if (gate) gate.isStar = true;
      }
      b.isStar = true;
      starsApplied++;
    }
  }

  // 5. Key & Lock (Chained) Blocks (L61+): 1..2 lock pairs
  if (useKeyLock && coloredBlocks.length >= 4) {
    const maxPairs =
      !isBreather && levelId >= 135 && difficulty !== 'NORMAL' && coloredBlocks.length >= 8 ? 2 : 1;
    for (let lockId = 1; lockId <= maxPairs; lockId++) {
      const keyCarrier = coloredBlocks.find(
        (b) =>
          isInStartingRoom(b) &&
          !b.iceCount &&
          !b.chained &&
          !b.ropeColor &&
          !b.hasKey &&
          canAddBlockModifier(b, 'PAYLOAD')
      );
      const lockedTarget = [...coloredBlocks]
        .reverse()
        .find(
          (b) =>
            isInStartingRoom(b) &&
            b.id !== keyCarrier?.id &&
            !b.hasKey &&
            canAddBlockModifier(b, 'IMMOBILIZER')
        );
      if (keyCarrier && lockedTarget) {
        keyCarrier.hasKey = lockId;
        lockedTarget.chained = true;
        lockedTarget.lockId = lockId;
      }
    }
  }

  // 6. Bomb Blocks (L91+): calibrated tactical fuse (1..2 bombs on late SUPER_HARD)
  if (useBombs && coloredBlocks.length >= 2) {
    const maxBombs = !isBreather && levelId >= 160 && difficulty === 'SUPER_HARD' ? 2 : 1;
    const fuseMult = difficulty === 'SUPER_HARD' ? 1.35 : difficulty === 'HARD' ? 1.5 : 1.75;
    let bombsPlaced = 0;
    for (const b of coloredBlocks) {
      if (bombsPlaced >= maxBombs) break;
      if (
        isInStartingRoom(b) &&
        !b.iceCount &&
        !b.chained &&
        !b.ropeColor &&
        canAddBlockModifier(b, 'PAYLOAD')
      ) {
        b.bombCount = Math.max(9, Math.round(coloredBlocks.length * fuseMult) + 2 + bombsPlaced * 3);
        bombsPlaced++;
      }
    }
  }

  // 7. Colored Ropes & Scissors (L111+): 1..2 pairs
  if (useRopes && coloredBlocks.length >= 4) {
    const maxPairs =
      !isBreather && levelId >= 165 && difficulty !== 'NORMAL' && activeColors.length >= 2 ? 2 : 1;
    for (let p = 0; p < maxPairs; p++) {
      const scissorHolder = coloredBlocks.find(
        (b) =>
          isInStartingRoom(b) &&
          !b.iceCount &&
          !b.chained &&
          !b.ropeColor &&
          !b.scissorColor &&
          canAddBlockModifier(b, 'PAYLOAD')
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
        const ropeCol = activeColors[p % activeColors.length];
        scissorHolder.scissorColor = ropeCol;
        ropedTarget.ropeColor = ropeCol;
      }
    }
  }

  // 8. Frozen Gates (L131+ or synchronized MYSTERY_VAULT gate countdowns `GATE-ICE-01`)
  if ((useFrozenGates || layoutId === 'MYSTERY_VAULT') && gates.length >= 3) {
    const freezeGateCount =
      !isBreather && useFrozenGates && levelId >= 155 && difficulty !== 'NORMAL' && gates.length >= 4 ? 2 : 1;
    for (let fg = 0; fg < freezeGateCount; fg++) {
      const gTarget = gates[gates.length - 1 - fg];
      const gColor = gTarget.colorQueue[0];
      const unlockedOtherBlocks = coloredBlocks.filter(
        (b) => isInStartingRoom(b) && b.colorStack[0] !== gColor && !b.iceCount && !b.chained && !b.ropeColor
      );
      if (unlockedOtherBlocks.length >= 3 + fg) {
        const desired = layoutId === 'MYSTERY_VAULT' ? 2 + fg : isBreather ? 1 : 2 + fg;
        gTarget.iceCount = Math.min(unlockedOtherBlocks.length - 1, desired);
      }
    }
  }

  // 9. Locked Shutter Gates & Shutter Gems (L141+)
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

  // 10. Toggling Shutter Gates (L145+)
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

  // 11. Sliding Gates (L151+)
  if (useSlidingGate && singleEdgeGates.length >= 1) {
    const gSlide = singleEdgeGates[0];
    const { minStart, maxEnd } = getSculptedEdgeSpanBounds(gSlide.edge);
    const availLen = Math.max(3, maxEnd - minStart);
    let maxReqSpan = 2;
    for (const b of coloredBlocks) {
      if (!b.colorStack.some((c) => gSlide.colorQueue.includes(c))) continue;
      const sh = getShape(b.shapeId);
      const req = gSlide.edge === 'TOP' || gSlide.edge === 'BOTTOM' ? sh.cols : sh.rows;
      if (req > maxReqSpan) maxReqSpan = req;
    }
    gSlide.slidesOnClear = true;
    gSlide.spanLength = Math.max(maxReqSpan, Math.min(3, availLen - 1));
    gSlide.spanStart = Math.max(minStart, Math.min(gSlide.spanStart, maxEnd - gSlide.spanLength));
    gSlide.slideMin = minStart;
    gSlide.slideMax = Math.max(minStart, maxEnd - gSlide.spanLength);
    gSlide.slideDir = 1;
  }

  // 12. Size-Changing Gates (L155+)
  if (useSizeChangingGate && singleEdgeGates.length >= 1) {
    const gSize = singleEdgeGates[1] ?? singleEdgeGates[0];
    const { minStart, maxEnd } = getSculptedEdgeSpanBounds(gSize.edge);
    const availLen = Math.max(3, maxEnd - minStart);
    gSize.sizeChangesOnClear = true;
    gSize.maxLength = Math.max(3, Math.min(4, availLen));
    gSize.minLength = 2;
    gSize.spanLength = gSize.maxLength;
    gSize.spanStart = Math.max(minStart, Math.min(gSize.spanStart, maxEnd - gSize.maxLength));
  }

  // 13. Block Generators (L161+): 1..2 queued spawns
  if (useGenerators) {
    const minGenRow = layoutId === 'TWIN_SANCTUM' ? 3 : 1;
    let genR = -1;
    let genC = -1;
    let spawnR = -1;
    let spawnC = -1;
    for (let c = 1; c < cols - 1; c++) {
      for (let r = minGenRow; r < rows - 1; r++) {
        if (grid[r * cols + c] === 0) {
          if (genR < 0) {
            genR = r;
            genC = c;
          } else if (spawnR < 0 && Math.abs(r - genR) + Math.abs(c - genC) === 1) {
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
      const spawnQueue: NonNullable<LevelSpec['generators']>[number]['queue'] = [
        { shapeId: '1x1', colorStack: [activeColors[0]] },
      ];
      if (!isBreather && levelId >= 175 && difficulty !== 'NORMAL' && activeColors.length >= 2) {
        spawnQueue.push({ shapeId: '1x1', colorStack: [activeColors[1]] });
      }
      generators.push({
        id: 1,
        row: genR,
        col: genC,
        spawnRow: spawnR,
        spawnCol: spawnC,
        cooldown: 1,
        queue: spawnQueue,
      });
    }
  }

  // 14. Color-Changing Gates (L121+): true queue sequencing without decoy-gate starvation
  if (useColorQueueGates && gates.length >= 2 && coloredBlocks.length >= 4) {
    const g0 = gates[0];
    const c0 = g0.colorQueue[0];
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
    // Pick a dedicated queue-tail color not active on any other gate so every c0 layer MUST shred first!
    const usedGateColors = new Set<ColorId>();
    for (const g of gates) {
      for (const c of g.colorQueue) usedGateColors.add(c);
    }
    let tailColor: ColorId | null = null;
    for (let c = 1; c <= 9; c++) {
      if (!usedGateColors.has(c as ColorId)) {
        tailColor = c as ColorId;
        break;
      }
    }
    const recolorTarget =
      tailColor !== null
        ? [...coloredBlocks].reverse().find((b) => {
            if (
              !isInStartingRoom(b) ||
              b.colorStack.length !== 1 ||
              b.colorStack[0] === c0 ||
              b.axisLock ||
              b.isStar ||
              b.shutterGemColor
            ) {
              return false;
            }
            const sh = getShape(b.shapeId);
            const req = g0.edge === 'TOP' || g0.edge === 'BOTTOM' ? sh.cols : sh.rows;
            const effLen = g0.sizeChangesOnClear ? (g0.maxLength ?? g0.spanLength) : g0.spanLength;
            return req <= effLen;
          })
        : undefined;
    if (tailColor !== null && recolorTarget && c0Supply >= 1) {
      recolorTarget.colorStack = [tailColor];
      g0.colorQueue = [...Array(c0Supply).fill(c0), tailColor];
    } else {
      const cSecond = activeColors[1] ?? activeColors[0];
      g0.colorQueue = [...Array(Math.max(1, c0Supply)).fill(c0), cSecond];
    }
  }

  // 15. Colorful Floor Paths (L171+): 1..2 corridor tiles (1 on retry attempts so corridors never seal off)
  if (useFloorPaths && coloredBlocks.length > 0) {
    const maxTiles = isBreather || attempt >= 3 || rows < 8 ? 1 : 2;
    const seen = new Set<number>();
    for (const b of coloredBlocks) {
      if (floorPaths.length >= maxTiles) break;
      if (!isInStartingRoom(b)) continue;
      const key = b.row * cols + b.col;
      if (seen.has(key)) continue;
      seen.add(key);
      floorPaths.push({
        row: b.row,
        col: b.col,
        color: b.colorStack[0],
      });
    }
  }

  // 16. Moving Elevators (L181+)
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
