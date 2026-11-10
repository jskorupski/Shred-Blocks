import { cloneBoardState, commitBlockMove, isBoardFailed, isBoardWon } from '../core/board';
import { findEligibleGateForBlockAt, getGateActiveColor } from '../core/gate-clearance';
import { getMovedGroupBlocks, getReachableAnchors, isBlockMovable } from '../core/physics';
import { getActiveColor, getLayersRemaining, getShape } from '../core/polyomino';
import type { BlockState, BoardState, ColorId } from '../core/types';

export interface SolverMove {
  blockId: number;
  targetRow: number;
  targetCol: number;
  exitsGateIndex: number;
}

export interface SolverResult {
  solvable: boolean;
  minMoves: number;
  firstMove: SolverMove | null;
  solutionPath: SolverMove[];
  expandedNodes?: number;
}

const MASK_64 = (1n << 64n) - 1n;

function splitMix64(seed: bigint): bigint {
  let z = (seed + 0x9e3779b97f4a7c15n) & MASK_64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  return (z ^ (z >> 31n)) & MASK_64;
}

function hashTuple(tag: bigint, a: number, b = 0, c = 0, d = 0): bigint {
  const raw =
    (tag & MASK_64) ^
    (BigInt(a & 0xffff) << 48n) ^
    (BigInt(b & 0xffff) << 32n) ^
    (BigInt(c & 0xffff) << 16n) ^
    BigInt(d & 0xffff);
  return splitMix64(raw);
}

/**
 * F-03 Complete 64-Bit Zobrist State Signature:
 * Hashes every dynamic board attribute so the solver never suffers false transposition hits:
 * - Active blocks: (id, row, col, colorCursor, iceCount, chained, ropeColor, hasKey, scissorColor, shutterGemColor, groupId, bombCount)
 * - Gates: (index, colorCursor, iceCount, shutterLockColor, shutterOpen, spanStart, spanLength, slideDir, sizeDir)
 * - Crates: (id, hp, destroyed)
 * - Generators: (id, queueCursor, cooldown, state)
 * - Elevators: (id, row, col, atAlternatePos)
 */
export function computeStateHash(board: BoardState): bigint {
  let h = 0x517cc1b727220a95n;

  for (const b of board.blocks) {
    if (b.status !== 'ACTIVE') continue;
    const h1 = hashTuple(0x1001n, b.id, b.row, b.col, b.colorCursor);
    const flags =
      (b.chained ? 1 : 0) |
      ((b.ropeColor & 0xf) << 1) |
      ((b.hasKey & 0xf) << 5) |
      ((b.scissorColor & 0xf) << 9) |
      ((b.shutterGemColor & 0xf) << 13);
    const h2 = hashTuple(0x1002n, b.id, b.iceCount, flags, b.bombCount);
    const h3 = hashTuple(0x1003n, b.id, b.groupId, b.scissorColor, b.shutterGemColor);
    h = (h ^ splitMix64(h1 ^ h2 ^ h3)) & MASK_64;
  }

  for (const g of board.gates) {
    const gFlags =
      (g.shutterOpen ? 1 : 0) | ((g.shutterLockColor & 0xf) << 1) | ((g.sizeDir > 0 ? 1 : 0) << 5);
    const hg1 = hashTuple(0x2001n, g.index, g.colorCursor, g.iceCount, gFlags);
    const hg2 = hashTuple(
      0x2002n,
      g.index,
      g.spanStart,
      g.spanLength,
      ((g.slideDir + 2) & 0xff) | (((g.sizeDir + 2) & 0xff) << 8)
    );
    h = (h ^ splitMix64(hg1 ^ hg2)) & MASK_64;
  }

  for (const c of board.crates) {
    if (c.destroyed || c.hp <= 0) continue;
    const hc = hashTuple(0x3001n, c.id, c.row, c.col, c.hp);
    h = (h ^ hc) & MASK_64;
  }

  for (const gen of board.generators) {
    const stCode = gen.state === 'COUNTING' ? 1 : gen.state === 'READY_TO_SPAWN' ? 2 : 3;
    const hgen = hashTuple(0x4001n, gen.id, gen.queueCursor, gen.cooldown, stCode);
    h = (h ^ hgen) & MASK_64;
  }

  for (const elev of board.elevators) {
    const he = hashTuple(0x5001n, elev.id, elev.row, elev.col, elev.atAlternatePos ? 1 : 0);
    h = (h ^ he) & MASK_64;
  }

  if (board.barriers) {
    for (const bar of board.barriers) {
      const hbar = hashTuple(0x6001n, bar.id, bar.open ? 1 : 0, bar.shredsRemaining, bar.lockId);
      h = (h ^ hbar) & MASK_64;
    }
  }

  return h;
}

function getCandidateExitAnchorsForColor(
  board: BoardState,
  shapeRows: number,
  shapeCols: number,
  color: ColorId
): Set<number> {
  const anchors = new Set<number>();
  for (const g of board.gates) {
    if (!g.colorQueue.includes(color)) continue;
    const minSpan = g.slidesOnClear ? g.slideMin : g.spanStart;
    const maxLen = g.sizeChangesOnClear ? g.maxLength : g.spanLength;
    const maxSpanEnd = (g.slidesOnClear ? g.slideMax : g.spanStart) + maxLen;
    const edgeLine =
      g.edgeLine ??
      (g.edge === 'TOP' || g.edge === 'LEFT' ? 0 : g.edge === 'BOTTOM' ? board.rows - 1 : board.cols - 1);

    if (g.edge === 'TOP' || g.edge === 'BOTTOM') {
      const r = g.edge === 'TOP' ? edgeLine : edgeLine - shapeRows + 1;
      for (let c = minSpan; c <= maxSpanEnd - shapeCols; c++) {
        if (r >= 0 && r + shapeRows <= board.rows && c >= 0 && c + shapeCols <= board.cols) {
          anchors.add(r * board.cols + c);
        }
      }
    } else {
      const c = g.edge === 'LEFT' ? edgeLine : edgeLine - shapeCols + 1;
      for (let r = minSpan; r <= maxSpanEnd - shapeRows; r++) {
        if (r >= 0 && r + shapeRows <= board.rows && c >= 0 && c + shapeCols <= board.cols) {
          anchors.add(r * board.cols + c);
        }
      }
    }
  }
  return anchors;
}

/**
 * F-02 Strictly Admissible Heuristic:
 * Guarantees h_adm(S) <= h*(S) on all boards, including cascade boards where:
 * - A multi-layer block has identical adjacent layers `[c, c]` or shares a gate/corner exit cell
 * - A generator spawns directly on a gate lip and auto-clears in the same cascade
 */
export function computeAdmissibleHeuristic(board: BoardState): number {
  let extraLayers = 0;
  let hasActiveNonStone = false;

  for (const b of board.blocks) {
    if (b.status !== 'ACTIVE') continue;
    const activeColor = getActiveColor(b.colorStack, b.colorCursor);
    if (activeColor === 0) continue;
    hasActiveNonStone = true;

    const rem = getLayersRemaining(b.colorStack, b.colorCursor);
    if (rem > 1 && b.groupId === 0 && board.elevators.length === 0) {
      const shape = getShape(b.shapeId);
      for (let i = b.colorCursor; i + 1 < b.colorStack.length; i++) {
        const cA = b.colorStack[i];
        const cB = b.colorStack[i + 1];
        if (cA === cB) continue;
        const anchorsA = getCandidateExitAnchorsForColor(board, shape.rows, shape.cols, cA);
        const anchorsB = getCandidateExitAnchorsForColor(board, shape.rows, shape.cols, cB);
        let sharesExitAnchor = false;
        for (const a of anchorsA) {
          if (anchorsB.has(a)) {
            sharesExitAnchor = true;
            break;
          }
        }
        if (!sharesExitAnchor) {
          extraLayers++;
        }
      }
    }
  }

  let genRemaining = 0;
  if (board.elevators.length === 0) {
    for (const gen of board.generators) {
      if (gen.state === 'DEPLETED') continue;
      for (let q = gen.queueCursor; q < gen.queue.length; q++) {
        const spec = gen.queue[q];
        const sh = getShape(spec.shapeId);
        const touchesGateOrBorder =
          gen.spawnRow <= 0 ||
          gen.spawnRow + sh.rows >= board.rows ||
          gen.spawnCol <= 0 ||
          gen.spawnCol + sh.cols >= board.cols ||
          board.gates.some((g) => {
            const line =
              g.edgeLine ??
              (g.edge === 'TOP' || g.edge === 'LEFT'
                ? 0
                : g.edge === 'BOTTOM'
                  ? board.rows - 1
                  : board.cols - 1);
            return (
              (g.edge === 'TOP' && gen.spawnRow === line) ||
              (g.edge === 'BOTTOM' && gen.spawnRow + sh.rows - 1 === line) ||
              (g.edge === 'LEFT' && gen.spawnCol === line) ||
              (g.edge === 'RIGHT' && gen.spawnCol + sh.cols - 1 === line)
            );
          });
        if (!touchesGateOrBorder) {
          genRemaining++;
        }
      }
    }
  }

  if (!hasActiveNonStone && genRemaining === 0) {
    const anyPendingGen = board.generators.some(
      (g) => g.state !== 'DEPLETED' && g.queueCursor < g.queue.length
    );
    return anyPendingGen ? 1 : 0;
  }

  return extraLayers + (hasActiveNonStone ? 1 : 0) + genRemaining;
}

function computeRemainingLayersAndObstacles(board: BoardState): {
  totalLayers: number;
  restrictionScore: number;
} {
  let totalLayers = 0;
  let restrictionScore = 0;

  for (const b of board.blocks) {
    if (b.status !== 'ACTIVE') continue;
    const activeColor = getActiveColor(b.colorStack, b.colorCursor);
    if (activeColor === 0) continue;
    totalLayers += getLayersRemaining(b.colorStack, b.colorCursor);
    if (b.iceCount > 0) restrictionScore += b.iceCount;
    if (b.chained) restrictionScore += 2;
    if (b.ropeColor > 0) restrictionScore += 2;
  }

  for (const g of board.gates) {
    if (g.iceCount > 0) restrictionScore += g.iceCount;
    if (g.shutterLockColor > 0) restrictionScore += 2;
    if (!g.shutterOpen) restrictionScore += 1;
  }

  for (const c of board.crates) {
    if (!c.destroyed && c.hp > 0) restrictionScore += c.hp;
  }

  for (const gen of board.generators) {
    if (gen.state === 'DEPLETED') continue;
    for (let i = gen.queueCursor; i < gen.queue.length; i++) {
      totalLayers += gen.queue[i].colorStack.length;
    }
    restrictionScore += gen.cooldown;
  }

  if (board.barriers) {
    for (const bar of board.barriers) {
      if (!bar.open) {
        restrictionScore += Math.max(1, bar.shredsRemaining) + (bar.lockId > 0 ? 2 : 0);
      }
    }
  }

  return { totalLayers, restrictionScore };
}

/**
 * Checks whether a single immediate gate-exit move is a "Pure Safe Exit" that is strictly
 * dominant (cannot hurt any future move), allowing the solver to commit it without branching
 * on unnecessary permutations.
 */
function isPureSafeExit(board: BoardState, block: BlockState, gateIndex: number): boolean {
  if (gateIndex < 0 || gateIndex >= board.gates.length) return false;
  if (board.elevators.length > 0 || board.generators.length > 0) return false;
  if (board.crates.some((c) => !c.destroyed && c.hp > 0)) return false;
  if (board.barriers?.some((b) => !b.open)) return false;
  if (block.groupId > 0) return false;
  if (block.hasKey > 0 || block.scissorColor > 0 || block.shutterGemColor > 0) return false;
  if (getLayersRemaining(block.colorStack, block.colorCursor) > 1) return false;
  if (board.blocks.some((b) => b.status === 'ACTIVE' && b.bombCount > 0)) return false;
  if (board.gates.some((g) => g.togglesOnClear || g.slidesOnClear || g.sizeChangesOnClear)) {
    return false;
  }

  const gate = board.gates[gateIndex];
  if (gate.colorCursor + 1 < gate.colorQueue.length) {
    const curColor = getGateActiveColor(gate);
    const nextColor = gate.colorQueue[gate.colorCursor + 1];
    if (curColor !== nextColor) {
      return false;
    }
  }

  return true;
}

interface SearchNode {
  board: BoardState;
  g: number;
  hAdm: number;
  priority: number;
  firstMove: SolverMove | null;
  path: SolverMove[];
}

class MinPriorityQueue {
  private heap: SearchNode[] = [];

  get length(): number {
    return this.heap.length;
  }

  push(node: SearchNode): void {
    this.heap.push(node);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): SearchNode | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.heap[idx].priority < this.heap[parent].priority) {
        const tmp = this.heap[idx];
        this.heap[idx] = this.heap[parent];
        this.heap[parent] = tmp;
        idx = parent;
      } else {
        break;
      }
    }
  }

  private sinkDown(idx: number): void {
    const len = this.heap.length;
    while (true) {
      const left = (idx << 1) + 1;
      const right = left + 1;
      let smallest = idx;

      if (left < len && this.heap[left].priority < this.heap[smallest].priority) {
        smallest = left;
      }
      if (right < len && this.heap[right].priority < this.heap[smallest].priority) {
        smallest = right;
      }
      if (smallest !== idx) {
        const tmp = this.heap[idx];
        this.heap[idx] = this.heap[smallest];
        this.heap[smallest] = tmp;
        idx = smallest;
      } else {
        break;
      }
    }
  }
}

/**
 * Generates ordered macro-moves for a board state:
 * - Priority 1: Immediate Gate Exits (with Pure Safe Exit dominance pruning when applicable)
 * - Priority 2: Useful Repositioning Moves
 */
function generateMacroMoves(board: BoardState): SolverMove[] {
  const exitMoves: Array<SolverMove & { urgency: number; pureSafe: boolean }> = [];
  const repositionMoves: Array<SolverMove & { score: number }> = [];

  const seenGroups = new Set<number>();
  const hasCrates = board.crates.some((c) => !c.destroyed && c.hp > 0);

  for (const b of board.blocks) {
    if (b.status !== 'ACTIVE') continue;
    if (b.groupId > 0) {
      if (seenGroups.has(b.groupId)) continue;
      seenGroups.add(b.groupId);
    }
    if (!isBlockMovable(board, b.id)) continue;

    const group = getMovedGroupBlocks(board, b.id);
    const lead = group.find((m) => m.id === b.id) ?? group[0];
    const anchors = getReachableAnchors(board, lead.id);
    if (anchors.length === 0) continue;

    const seenGateExitsForGroup = new Set<number>();
    const blockRepos: Array<SolverMove & { score: number }> = [];

    for (const anchor of anchors) {
      const dRow = anchor.row - lead.row;
      const dCol = anchor.col - lead.col;

      // Check if any member of the moved group exits a gate at this offset
      let matchedGateIdx = -1;
      let exitingMember: BlockState = lead;
      for (const member of group) {
        const gIdx = findEligibleGateForBlockAt(board, member, member.row + dRow, member.col + dCol);
        if (gIdx >= 0) {
          matchedGateIdx = gIdx;
          exitingMember = member;
          break;
        }
      }

      if (matchedGateIdx >= 0) {
        const canDedupGateExit =
          !hasCrates &&
          group.length === 1 &&
          getLayersRemaining(exitingMember.colorStack, exitingMember.colorCursor) === 1;
        if (canDedupGateExit && seenGateExitsForGroup.has(matchedGateIdx)) {
          continue;
        }
        if (canDedupGateExit) {
          seenGateExitsForGroup.add(matchedGateIdx);
        }

        const pureSafe = isPureSafeExit(board, exitingMember, matchedGateIdx);
        let urgency = 0;
        if (exitingMember.bombMax > 0) urgency += 100 - exitingMember.bombCount;
        if (exitingMember.hasKey > 0 || exitingMember.scissorColor > 0 || exitingMember.shutterGemColor > 0) {
          urgency += 40;
        }
        if (getLayersRemaining(exitingMember.colorStack, exitingMember.colorCursor) > 1) {
          urgency += 15;
        }

        if (pureSafe) {
          return [
            {
              blockId: lead.id,
              targetRow: anchor.row,
              targetCol: anchor.col,
              exitsGateIndex: matchedGateIdx,
            },
          ];
        }

        exitMoves.push({
          blockId: lead.id,
          targetRow: anchor.row,
          targetCol: anchor.col,
          exitsGateIndex: matchedGateIdx,
          urgency,
          pureSafe,
        });
      } else if (dRow !== 0 || dCol !== 0) {
        let score = Math.min(anchor.dist, 4) * 2;
        const activeColor = getActiveColor(lead.colorStack, lead.colorCursor);

        const leadShape = getShape(lead.shapeId);
        for (const g of board.gates) {
          if (g.colorQueue.includes(activeColor)) {
            const edgeLine =
              g.edgeLine ??
              (g.edge === 'TOP' || g.edge === 'LEFT'
                ? 0
                : g.edge === 'BOTTOM'
                  ? board.rows - 1
                  : board.cols - 1);
            if (
              (g.edge === 'TOP' && anchor.row === edgeLine) ||
              (g.edge === 'BOTTOM' && anchor.row + leadShape.rows - 1 === edgeLine) ||
              (g.edge === 'LEFT' && anchor.col === edgeLine) ||
              (g.edge === 'RIGHT' && anchor.col + leadShape.cols - 1 === edgeLine)
            ) {
              score += 5;
            }
          }
        }

        for (const elev of board.elevators) {
          if (
            anchor.row >= elev.row &&
            anchor.row < elev.row + elev.height &&
            anchor.col >= elev.col &&
            anchor.col < elev.col + elev.width
          ) {
            score += 6;
          }
        }

        blockRepos.push({
          blockId: lead.id,
          targetRow: anchor.row,
          targetCol: anchor.col,
          exitsGateIndex: -1,
          score,
        });
      }
    }

    // Keep top 4 repositioning anchors per movable block to avoid open-board combinatorial blowup
    blockRepos.sort((a, b) => b.score - a.score);
    for (let i = 0; i < Math.min(blockRepos.length, 4); i++) {
      repositionMoves.push(blockRepos[i]);
    }
  }

  exitMoves.sort((a, b) => b.urgency - a.urgency || a.blockId - b.blockId);
  repositionMoves.sort((a, b) => b.score - a.score || a.blockId - b.blockId);

  const combined: SolverMove[] = [];
  for (const m of exitMoves) {
    combined.push({
      blockId: m.blockId,
      targetRow: m.targetRow,
      targetCol: m.targetCol,
      exitsGateIndex: m.exitsGateIndex,
    });
  }

  const maxRepos = exitMoves.length > 0 ? 6 : 16;
  for (let i = 0; i < Math.min(repositionMoves.length, maxRepos); i++) {
    const m = repositionMoves[i];
    combined.push({
      blockId: m.blockId,
      targetRow: m.targetRow,
      targetCol: m.targetCol,
      exitsGateIndex: -1,
    });
  }

  return combined;
}

/**
 * Solves `board` using A* / Best-First Macro-Move Search with 64-bit Zobrist transposition
 * table (`F-03`) and admissible heuristic (`F-02`).
 */
export function solveBoard(board: BoardState, maxExpandedNodes = 1200): SolverResult {
  if (isBoardWon(board)) {
    return {
      solvable: true,
      minMoves: 0,
      firstMove: null,
      solutionPath: [],
      expandedNodes: 0,
    };
  }

  const startBoard = cloneBoardState(board);
  const startHash = computeStateHash(startBoard);
  const startHAdm = computeAdmissibleHeuristic(startBoard);
  const startMetrics = computeRemainingLayersAndObstacles(startBoard);

  const visitedBestG = new Map<bigint, number>();
  visitedBestG.set(startHash, 0);

  const open = new MinPriorityQueue();
  open.push({
    board: startBoard,
    g: 0,
    hAdm: startHAdm,
    priority: startMetrics.totalLayers * 1.15 + startMetrics.restrictionScore * 0.1 + startHAdm * 0.01,
    firstMove: null,
    path: [],
  });

  let expandedNodes = 0;

  while (open.length > 0 && expandedNodes < maxExpandedNodes) {
    const current = open.pop()!;
    expandedNodes++;

    const moves = generateMacroMoves(current.board);
    for (const move of moves) {
      const nextBoard = cloneBoardState(current.board);
      const outcome = commitBlockMove(nextBoard, move.blockId, move.targetRow, move.targetCol, 'ZEN');

      if (!outcome.moved) continue;
      if (isBoardFailed(nextBoard, 'ZEN').failed) continue;

      const nextG = current.g + 1;
      const recordedMove: SolverMove = {
        blockId: move.blockId,
        targetRow: move.targetRow,
        targetCol: move.targetCol,
        exitsGateIndex: outcome.clearedGateIndex,
      };
      const nextFirstMove = current.firstMove ?? recordedMove;
      const nextPath = [...current.path, recordedMove];

      if (isBoardWon(nextBoard)) {
        return {
          solvable: true,
          minMoves: nextG,
          firstMove: nextFirstMove,
          solutionPath: nextPath,
          expandedNodes,
        };
      }

      const nextHash = computeStateHash(nextBoard);
      const prevBestG = visitedBestG.get(nextHash);
      if (prevBestG !== undefined && prevBestG <= nextG) {
        continue;
      }
      visitedBestG.set(nextHash, nextG);

      const nextHAdm = computeAdmissibleHeuristic(nextBoard);
      const metrics = computeRemainingLayersAndObstacles(nextBoard);
      const nextPriority =
        nextG + metrics.totalLayers * 1.15 + metrics.restrictionScore * 0.1 + nextHAdm * 0.01;

      open.push({
        board: nextBoard,
        g: nextG,
        hAdm: nextHAdm,
        priority: nextPriority,
        firstMove: nextFirstMove,
        path: nextPath,
      });
    }
  }

  return {
    solvable: false,
    minMoves: -1,
    firstMove: null,
    solutionPath: [],
    expandedNodes,
  };
}

/**
 * Finds the next hint move for the player (`findNextHintMove`).
 * Guarantees a valid move is returned if any legal move exists on the board,
 * falling back to any immediate gate clear or helpful unblock move if the solver node budget is exceeded.
 */
export function findNextHintMove(board: BoardState, maxExpandedNodes = 800): SolverMove | null {
  if (isBoardWon(board)) return null;

  const solved = solveBoard(board, maxExpandedNodes);
  if (solved.solvable && solved.firstMove) {
    return solved.firstMove;
  }

  const fallbackMoves = generateMacroMoves(board);
  for (const m of fallbackMoves) {
    const testBoard = cloneBoardState(board);
    const outcome = commitBlockMove(testBoard, m.blockId, m.targetRow, m.targetCol, 'ZEN');
    if (outcome.moved && !isBoardFailed(testBoard, 'ZEN').failed) {
      return {
        blockId: m.blockId,
        targetRow: m.targetRow,
        targetCol: m.targetCol,
        exitsGateIndex: outcome.clearedGateIndex,
      };
    }
  }

  return null;
}
