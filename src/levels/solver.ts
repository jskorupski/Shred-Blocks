import {
  cloneBoardState,
  commitBlockMove,
  isBoardDeadlocked,
  isBoardFailed,
  isBoardWon,
} from '../core/board';
import { findEligibleGateForBlockAt, getGateActiveColor } from '../core/gate-clearance';
import {
  getMovedGroupBlocks,
  getReachableAnchors,
  isBlockMovable,
  isGateInLockedRoom,
} from '../core/physics';
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

function mix32(h: number, k: number): number {
  let x = Math.imul(k ^ (k >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  let out = h ^ x;
  out = (out << 13) | (out >>> 19);
  return (Math.imul(out, 5) + 0xe6546b64) | 0;
}

/**
 * F-03 Complete 64-Bit Zobrist State Signature (dual-lane 32-bit Murmur3 mixing -> zero intermediate BigInt heap allocations):
 * Hashes every dynamic board attribute so the solver never suffers false transposition hits:
 * - Active blocks: (id, row, col, colorCursor, iceCount, chained, ropeColor, hasKey, scissorColor, shutterGemColor, groupId, bombCount)
 * - Gates: (index, colorCursor, iceCount, shutterLockColor, shutterOpen, spanStart, spanLength, slideDir, sizeDir)
 * - Crates: (id, hp, destroyed)
 * - Generators: (id, queueCursor, cooldown, state)
 * - Elevators: (id, row, col, atAlternatePos)
 */
export function computeStateHash(board: BoardState): bigint {
  let lo = 0x27220a95 | 0;
  let hi = 0x517cc1b7 | 0;

  for (const b of board.blocks) {
    if (b.status !== 'ACTIVE') continue;
    const w1 =
      ((b.id & 0xff) << 24) | ((b.row & 0xff) << 16) | ((b.col & 0xff) << 8) | (b.colorCursor & 0xff);
    const w2 =
      (b.chained ? 1 : 0) |
      ((b.ropeColor & 0xf) << 1) |
      ((b.hasKey & 0xf) << 5) |
      ((b.scissorColor & 0xf) << 9) |
      ((b.shutterGemColor & 0xf) << 13) |
      ((b.iceCount & 0xf) << 17) |
      ((b.groupId & 0xf) << 21) |
      ((b.bombCount & 0x7f) << 25);
    lo = mix32(lo, w1 ^ 0x1001);
    hi = mix32(hi, w2 ^ Math.imul(b.id, 0x9e3779b1));
    lo = mix32(lo, w2);
    hi = mix32(hi, w1);
  }

  for (const g of board.gates) {
    const gw1 =
      ((g.index & 0x3f) << 26) |
      ((g.colorCursor & 0x3f) << 20) |
      ((g.iceCount & 0xf) << 16) |
      ((g.shutterLockColor & 0xf) << 12) |
      (g.shutterOpen ? 0x800 : 0) |
      ((g.spanStart & 0x1f) << 6) |
      (g.spanLength & 0x3f);
    const gw2 = (((g.slideDir + 2) & 0xf) << 8) | ((g.sizeDir + 2) & 0xf) | ((g.index & 0xff) << 16);
    lo = mix32(lo, gw1 ^ 0x2001);
    hi = mix32(hi, gw2 ^ gw1);
  }

  for (const c of board.crates) {
    if (c.destroyed || c.hp <= 0) continue;
    const cw = ((c.id & 0xff) << 24) | ((c.row & 0xff) << 16) | ((c.col & 0xff) << 8) | (c.hp & 0xff);
    lo = mix32(lo, cw ^ 0x3001);
    hi = mix32(hi, cw ^ 0x3002);
  }

  for (const gen of board.generators) {
    const stCode = gen.state === 'COUNTING' ? 1 : gen.state === 'READY_TO_SPAWN' ? 2 : 3;
    const gnw =
      ((gen.id & 0xff) << 24) | ((gen.queueCursor & 0xff) << 16) | ((gen.cooldown & 0xff) << 8) | stCode;
    lo = mix32(lo, gnw ^ 0x4001);
    hi = mix32(hi, gnw ^ 0x4002);
  }

  for (const elev of board.elevators) {
    const ew =
      ((elev.id & 0xff) << 24) |
      ((elev.row & 0xff) << 16) |
      ((elev.col & 0xff) << 8) |
      (elev.atAlternatePos ? 1 : 0);
    lo = mix32(lo, ew ^ 0x5001);
    hi = mix32(hi, ew ^ 0x5002);
  }

  if (board.barriers) {
    for (const bar of board.barriers) {
      const bw =
        ((bar.id & 0xff) << 24) |
        ((bar.open ? 1 : 0) << 20) |
        ((bar.shredsRemaining & 0xff) << 8) |
        (bar.lockId & 0xff);
      lo = mix32(lo, bw ^ 0x6001);
      hi = mix32(hi, bw ^ 0x6002);
    }
  }

  return (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
}

function gateAnchorBounds(
  board: BoardState,
  g: BoardState['gates'][number],
  shapeRows: number,
  shapeCols: number
): [number, number, number, number] {
  const minS = g.slidesOnClear ? g.slideMin : g.spanStart;
  const maxE =
    (g.slidesOnClear ? g.slideMax : g.spanStart) + (g.sizeChangesOnClear ? g.maxLength : g.spanLength);
  const line =
    g.edgeLine ??
    (g.edge === 'TOP' || g.edge === 'LEFT' ? 0 : g.edge === 'BOTTOM' ? board.rows - 1 : board.cols - 1);
  if (g.edge === 'TOP' || g.edge === 'BOTTOM') {
    const r = g.edge === 'TOP' ? line : line - shapeRows + 1;
    return [r, r, minS, maxE - shapeCols];
  }
  const c = g.edge === 'LEFT' ? line : line - shapeCols + 1;
  return [minS, maxE - shapeRows, c, c];
}

function colorsShareExitAnchor(
  board: BoardState,
  shapeRows: number,
  shapeCols: number,
  cA: ColorId,
  cB: ColorId
): boolean {
  for (let i = 0; i < board.gates.length; i++) {
    const gA = board.gates[i];
    if (!gA.colorQueue.includes(cA)) continue;
    if (gA.colorQueue.includes(cB)) return true;
    const [r0A, r1A, c0A, c1A] = gateAnchorBounds(board, gA, shapeRows, shapeCols);
    if (r0A > r1A || c0A > c1A) continue;
    for (let j = 0; j < board.gates.length; j++) {
      if (i === j || !board.gates[j].colorQueue.includes(cB)) continue;
      const [r0B, r1B, c0B, c1B] = gateAnchorBounds(board, board.gates[j], shapeRows, shapeCols);
      if (Math.max(r0A, r0B) <= Math.min(r1A, r1B) && Math.max(c0A, c0B) <= Math.min(c1A, c1B)) {
        return true;
      }
    }
  }
  return false;
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
        if (!colorsShareExitAnchor(board, shape.rows, shape.cols, cA, cB)) {
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
  if (board.elevators.length > 0 || board.generators.some((g) => g.state !== 'DEPLETED')) return false;
  if (board.crates.some((c) => !c.destroyed && c.hp > 0)) return false;
  if (block.groupId > 0) return false;
  if (block.hasKey > 0 || block.scissorColor > 0 || block.shutterGemColor > 0) return false;
  if (getLayersRemaining(block.colorStack, block.colorCursor) > 1) return false;
  if (board.blocks.some((b) => b.status === 'ACTIVE' && b.bombCount > 0)) return false;
  if (board.gates.some((g) => g.togglesOnClear || g.slidesOnClear || g.sizeChangesOnClear)) {
    return false;
  }

  const gate = board.gates[gateIndex];
  const curColor = getGateActiveColor(gate);
  if (gate.colorCursor + 1 < gate.colorQueue.length) {
    const nextColor = gate.colorQueue[gate.colorCursor + 1];
    if (curColor !== nextColor) {
      return false;
    }
  }

  // If another multi-slot queued gate currently demands `curColor`, shredding at this decoy gate
  // could starve that queued gate on `L26+` (where autoAdvanceColorQueues does not bail out mistakes).
  for (let gi = 0; gi < board.gates.length; gi++) {
    if (gi === gateIndex) continue;
    const other = board.gates[gi];
    if (other.colorCursor + 1 < other.colorQueue.length && getGateActiveColor(other) === curColor) {
      return false;
    }
  }

  return true;
}

interface PathNode {
  move: SolverMove;
  prev: PathNode | null;
}

interface SearchNode {
  board: BoardState;
  g: number;
  hAdm: number;
  priority: number;
  firstMove: SolverMove | null;
  pathTail: PathNode | null;
}

function reconstructPath(tail: PathNode | null): SolverMove[] {
  const out: SolverMove[] = [];
  let cur = tail;
  while (cur) {
    out.push(cur.move);
    cur = cur.prev;
  }
  out.reverse();
  return out;
}

/**
 * Fast solver-specialized board cloner: shares read-only typed arrays & spec arrays
 * (`floorColor`, `roomMap`, `b.colorStack`, `gen.queue`, `bar.cells`) that never mutate
 * during `commitBlockMove`.
 */
function cloneBoardForSolver(board: BoardState): BoardState {
  const copyQueues = board.levelId <= 25 && board.barriers.length > 0;
  return {
    ...board,
    occupancy: new Int16Array(board.occupancy),
    blocks: board.blocks.map((b) => ({ ...b })),
    gates: board.gates.map((g) =>
      copyQueues && g.colorQueue.length > 1 ? { ...g, colorQueue: [...g.colorQueue] } : { ...g }
    ),
    crates: board.crates.length > 0 ? board.crates.map((c) => ({ ...c })) : board.crates,
    generators: board.generators.length > 0 ? board.generators.map((gen) => ({ ...gen })) : board.generators,
    elevators: board.elevators.length > 0 ? board.elevators.map((e) => ({ ...e })) : board.elevators,
    barriers: board.barriers.length > 0 ? board.barriers.map((bar) => ({ ...bar })) : board.barriers,
    hintMove: null,
  };
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
    const last = this.heap.pop();
    if (last !== undefined && this.heap.length > 0) {
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
 * Builds a lightweight per-cell corridor demand heatmap (`rows * cols`) so `generateMacroMoves`
 * prioritizes 1–3 cell pocket shifts that pull blockers OFF active exit-gate lanes and generator pads.
 */
function buildCorridorDemandMap(board: BoardState): Uint8Array {
  const { rows, cols, occupancy } = board;
  const demand = new Uint8Array(rows * cols);

  for (const g of board.gates) {
    if (isGateInLockedRoom(board, g)) continue;
    const w = g.shutterOpen && g.shutterLockColor === 0 && g.iceCount === 0 ? 3 : 1;
    const edgeLine =
      g.edgeLine ?? (g.edge === 'TOP' || g.edge === 'LEFT' ? 0 : g.edge === 'BOTTOM' ? rows - 1 : cols - 1);
    const maxDepth = Math.min(4, Math.max(rows, cols));

    for (let s = g.spanStart; s < g.spanStart + g.spanLength; s++) {
      for (let d = 0; d < maxDepth; d++) {
        const r = g.edge === 'TOP' ? edgeLine + d : g.edge === 'BOTTOM' ? edgeLine - d : s;
        const c = g.edge === 'LEFT' ? edgeLine + d : g.edge === 'RIGHT' ? edgeLine - d : s;
        if (r < 0 || r >= rows || c < 0 || c >= cols) break;
        const occ = occupancy[r * cols + c];
        if (occ === -1 || occ === -2 || occ === -3) break;
        demand[r * cols + c] = Math.min(255, demand[r * cols + c] + Math.max(1, w - (d >= 2 ? 1 : 0)));
      }
    }
  }

  for (const gen of board.generators) {
    if (gen.state === 'DEPLETED' || gen.queueCursor >= gen.queue.length) continue;
    const sr = gen.spawnRow;
    const sc = gen.spawnCol;
    if (sr >= 0 && sr < rows && sc >= 0 && sc < cols) {
      demand[sr * cols + sc] = Math.min(255, demand[sr * cols + sc] + 5);
    }
  }

  return demand;
}

/**
 * Generates ordered macro-moves for a board state:
 * - Priority 1: Immediate Gate Exits (with Pure Safe Exit dominance pruning when applicable)
 * - Priority 2: Corridor-clearing & alcove-parking Repositioning Moves
 */
export function generateMacroMoves(board: BoardState): SolverMove[] {
  const exitMoves: Array<SolverMove & { urgency: number; pureSafe: boolean }> = [];
  const repositionMoves: Array<SolverMove & { score: number }> = [];

  const seenGroups = new Set<number>();
  const hasCrates = board.crates.some((c) => !c.destroyed && c.hp > 0);
  const laneDemand = buildCorridorDemandMap(board);
  const { rows, cols, occupancy } = board;

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

    let currentLaneLoad = 0;
    for (const member of group) {
      const mShape = getShape(member.shapeId);
      for (const [dr, dc] of mShape.cells) {
        currentLaneLoad += laneDemand[(member.row + dr) * cols + (member.col + dc)];
      }
    }

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
        let targetLaneLoad = 0;
        let alcoveTouches = 0;
        for (const member of group) {
          const mShape = getShape(member.shapeId);
          for (const [dr, dc] of mShape.cells) {
            const nr = member.row + dRow + dr;
            const nc = member.col + dCol + dc;
            targetLaneLoad += laneDemand[nr * cols + nc];
            if (nr === 0 || occupancy[(nr - 1) * cols + nc] < 0) alcoveTouches++;
            if (nr === rows - 1 || occupancy[(nr + 1) * cols + nc] < 0) alcoveTouches++;
            if (nc === 0 || occupancy[nr * cols + (nc - 1)] < 0) alcoveTouches++;
            if (nc === cols - 1 || occupancy[nr * cols + (nc + 1)] < 0) alcoveTouches++;
          }
        }

        const laneRelief = currentLaneLoad - targetLaneLoad;
        let score = laneRelief * 4 + Math.min(alcoveTouches, 4) * 2 + Math.min(anchor.dist, 3);

        for (const elev of board.elevators) {
          if (
            anchor.row >= elev.row &&
            anchor.row < elev.row + elev.height &&
            anchor.col >= elev.col &&
            anchor.col < elev.col + elev.width
          ) {
            score += 7;
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

    // Keep top 3 corridor-clearing / alcove-parking anchors per movable block
    blockRepos.sort((a, b) => b.score - a.score);
    for (let i = 0; i < Math.min(blockRepos.length, 3); i++) {
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

  const maxRepos = exitMoves.length > 0 ? 6 : 12;
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
 * table (`F-03`), corridor-relief move ordering, deadlock pruning, and admissible heuristic (`F-02`).
 */
export function solveBoard(board: BoardState, maxExpandedNodes = 2400): SolverResult {
  if (isBoardWon(board)) {
    return { solvable: true, minMoves: 0, firstMove: null, solutionPath: [], expandedNodes: 0 };
  }
  if (isBoardDeadlocked(board)) {
    return { solvable: false, minMoves: -1, firstMove: null, solutionPath: [], expandedNodes: 0 };
  }

  const startBoard = cloneBoardForSolver(board);
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
    pathTail: null,
  });

  let expandedNodes = 0;

  while (open.length > 0 && expandedNodes < maxExpandedNodes) {
    const current = open.pop();
    if (!current) break;
    expandedNodes++;

    const moves = generateMacroMoves(current.board);
    for (const move of moves) {
      const nextBoard = cloneBoardForSolver(current.board);
      const outcome = commitBlockMove(
        nextBoard,
        move.blockId,
        move.targetRow,
        move.targetCol,
        'ZEN',
        0,
        0,
        false,
        true
      );

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
      const nextTail: PathNode = { move: recordedMove, prev: current.pathTail };

      if (isBoardWon(nextBoard)) {
        return {
          solvable: true,
          minMoves: nextG,
          firstMove: nextFirstMove,
          solutionPath: reconstructPath(nextTail),
          expandedNodes,
        };
      }

      const nextHash = computeStateHash(nextBoard);
      const prevBestG = visitedBestG.get(nextHash);
      if (prevBestG !== undefined && prevBestG <= nextG) {
        continue;
      }
      visitedBestG.set(nextHash, nextG);

      if (isBoardDeadlocked(nextBoard)) continue;

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
        pathTail: nextTail,
      });
    }
  }

  return { solvable: false, minMoves: -1, firstMove: null, solutionPath: [], expandedNodes };
}

/**
 * Finds the next hint move for the player (`findNextHintMove`).
 * Guarantees a valid move is returned if any legal move exists on the board,
 * falling back to any immediate gate clear or helpful unblock move if the solver node budget is exceeded.
 */
export function findNextHintMove(board: BoardState, maxExpandedNodes = 1400): SolverMove | null {
  if (isBoardWon(board)) return null;

  const solved = solveBoard(board, maxExpandedNodes);
  if (solved.solvable && solved.firstMove) {
    return solved.firstMove;
  }

  const fallbackMoves = generateMacroMoves(board);
  for (const m of fallbackMoves) {
    const testBoard = cloneBoardState(board);
    const outcome = commitBlockMove(testBoard, m.blockId, m.targetRow, m.targetCol, 'ZEN', 0, 0, false, true);
    if (outcome.moved && !isBoardFailed(testBoard, 'ZEN').failed && !isBoardDeadlocked(testBoard)) {
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
