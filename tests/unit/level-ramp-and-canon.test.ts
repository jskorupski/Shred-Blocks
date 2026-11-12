import { describe, expect, it } from 'vitest';
import {
  commitBlockMove,
  computeDefaultMoveLimit,
  computeEarnedStars,
  createBoardState,
  isBoardFailed,
  isBoardWon,
} from '../../src/core/board';
import type { LevelSpec } from '../../src/core/types';
import { getLevelRoadmapMeta, getLevelSpec } from '../../src/levels/catalog';
import { generateProceduralLevel } from '../../src/levels/generator';
import { findNextHintMove, solveBoard } from '../../src/levels/solver';
import { computeEndlessTierChips } from '../../src/ui/roadmap-and-themes-view';

function computeCanonicalLevelFingerprint(spec: LevelSpec): string {
  const json = JSON.stringify({
    id: spec.id,
    diff: spec.difficulty,
    layout: spec.layoutId ?? 'RECTANGLE',
    r: spec.rows,
    c: spec.cols,
    par: spec.parMoves,
    time: spec.timeLimitSec,
    cut: spec.cutouts ?? [],
    pil: spec.pillars ?? [],
    gates: spec.gates,
    blocks: spec.blocks,
    crates: spec.crates ?? [],
    bar: spec.barriers ?? [],
    gen: spec.generators ?? [],
    elev: spec.elevators ?? [],
    fp: spec.floorPaths ?? [],
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `0x${(h >>> 0).toString(16).padStart(8, '0')}`;
}

const CANONICAL_LEVEL_FINGERPRINTS: Record<number, string> = {
  1: '0x2bd37529',
  25: '0xd7ad2905',
  50: '0x3dcbdd0f',
  85: '0xf5b482fa',
  125: '0x4d45baf9',
  175: '0x984138d3',
  200: '0x0788b8a8',
  209: '0x20d2b7b6',
  225: '0x244c835b',
  250: '0xe2f04c8a',
  275: '0x20c111bc',
  300: '0xba85e267',
  340: '0xeb74565e',
  370: '0x5be072ff',
  400: '0x6597bed6',
  409: '0xee2c7629',
  425: '0xf4413faa',
  500: '0x13f25ab9',
  1000: '0xfeec502d',
};

describe('Unified Level Ramp, Challenge Replay Solvability & Canonical Determinism (LEVEL-CANON-01)', () => {
  it('LEVEL-CANON-01: locks deterministic cross-build layouts so Level X is identical for every player', () => {
    const coldCheckIds = [30, 34, 112, 175, 250, 287, 338, 478];
    const coldMetas = new Map(coldCheckIds.map((id) => [id, getLevelRoadmapMeta(id)]));

    for (const [idStr, expectedHash] of Object.entries(CANONICAL_LEVEL_FINGERPRINTS)) {
      const id = Number(idStr);
      const spec = getLevelSpec(id);
      expect(
        computeCanonicalLevelFingerprint(spec),
        `Canonical layout fingerprint drifted for Level ${id}; shared level numbers must stay deterministic!`
      ).toBe(expectedHash);

      if (id >= 82 && ![91, 101, 111, 121, 131, 141, 145, 151, 155, 161, 171, 181].includes(id)) {
        const freshA = generateProceduralLevel(id);
        const freshB = generateProceduralLevel(id);
        expect(freshA).toEqual(freshB);
      }
    }

    for (const checkId of coldCheckIds) {
      getLevelSpec(checkId);
      expect(getLevelRoadmapMeta(checkId)).toEqual(coldMetas.get(checkId));
    }
  }, 30_000);

  it('SOLVABILITY-01: proves late Campaign & Endless stages (301..450 + milestones up to 2500) win live in CHALLENGE mode with 0 boosters and 0 fallback collapses', () => {
    // Calibrated late-game move slack (`L181+` Normal `+3`, `L241+` Hard `+2`, Breather `+5`)
    expect(computeDefaultMoveLimit(15, 'NORMAL', 185)).toBe(18);
    expect(computeDefaultMoveLimit(15, 'NORMAL', 226)).toBe(20);
    expect(computeDefaultMoveLimit(15, 'HARD', 245)).toBe(17);
    expect(computeDefaultMoveLimit(15, 'SUPER_HARD', 300)).toBe(17);

    const highAltitudeIds = [500, 600, 750, 1000, 2500];
    const idsToVerify: number[] = [200, 250, 300];
    for (let id = 301; id <= 450; id++) idsToVerify.push(id);
    for (const id of highAltitudeIds) idsToVerify.push(id);

    let causalChainCount = 0;

    for (const id of idsToVerify) {
      const spec = getLevelSpec(id);
      const allStarGates = spec.gates.length === 4 && spec.gates.every((g) => g.isStar === true);
      expect(allStarGates, `Level ${id} must never collapse to fallbackSpec`).toBe(false);

      if (spec.blocks.some((b) => Boolean(b.hasKey && b.ropeColor) || Boolean(b.groupId && b.hasKey))) {
        causalChainCount++;
      }

      const board = createBoardState(spec);
      const solved = solveBoard(board, 600);
      expect(solved.solvable, `Level ${id} must be booster-free solvable`).toBe(true);
      expect(solved.solutionPath.length).toBe(solved.minMoves);
      expect(findNextHintMove(board)).not.toBeNull();

      // Replay the exact solver solution move-by-move in live CHALLENGE mode (move budget + live bomb fuses)
      const challengeBoard = createBoardState(spec);
      for (const mv of solved.solutionPath) {
        const outcome = commitBlockMove(
          challengeBoard,
          mv.blockId,
          mv.targetRow,
          mv.targetCol,
          'CHALLENGE',
          0,
          0,
          false,
          true
        );
        expect(outcome.moved, `Level ${id} solver step on block ${mv.blockId} must execute`).toBe(true);
        if (!isBoardWon(challengeBoard)) {
          expect(
            isBoardFailed(challengeBoard, 'CHALLENGE').failed,
            `Level ${id} optimal path must not fail Challenge budget or bomb fuses`
          ).toBe(false);
        }
      }
      expect(isBoardWon(challengeBoard), `Level ${id} must reach victory in Challenge mode`).toBe(true);
      expect(computeEarnedStars(challengeBoard, 'CHALLENGE', false)).toBe(3);
    }

    expect(causalChainCount).toBeGreaterThanOrEqual(5);
  }, 45_000);

  it('MAP-ENDLESS-NAV-01: computes bounded Endless 50-stage filter tiers and O(1) roadmap metadata', () => {
    expect(computeEndlessTierChips(25, 25)).toEqual([]);
    expect(computeEndlessTierChips(300, 300)).toEqual([]);
    expect(computeEndlessTierChips(425, 409)).toEqual([
      [301, 350],
      [351, 400],
      [401, 450],
    ]);
    const deepTiers = computeEndlessTierChips(2500, 1210);
    expect(deepTiers[0]).toEqual([301, 350]);
    expect(deepTiers.some(([s, e]) => s <= 1210 && e >= 1210)).toBe(true);
    expect(deepTiers[deepTiers.length - 1]).toEqual([2451, 2500]);
    expect(deepTiers.length).toBeLessThanOrEqual(12);

    expect(getLevelRoadmapMeta(200).name).toBe('Omega Shredder');
    expect(getLevelRoadmapMeta(250).name).toBe('Citadel Sovereign');
    expect(getLevelSpec(250).layoutId).toBe('CITADEL_OCTAGON');
    expect(getLevelRoadmapMeta(300).name).toBe('Sacred Astrolabe');
    expect(getLevelRoadmapMeta(409).id).toBe(409);
    expect(getLevelRoadmapMeta(425).id).toBe(425);
  });
});
