// @ts-expect-error Node built-in module resolved at runtime by Vitest
import fs from 'node:fs';
// @ts-expect-error Node built-in module resolved at runtime by Vitest
import path from 'node:path';
import { describe, expect, it } from 'vitest';

declare const process: { cwd: () => string };

import {
  applyBoosterHammer,
  applyBoosterRocket,
  applyBoosterVacuum,
  commitBlockMove,
  createBoardState,
  isBoardWon,
} from '../../src/core/board';
import {
  getBlockRoomId,
  getSealedVaultAtCell,
  isBlockInLockedRoom,
  isBlockInSealedVault,
  isBlockMovable,
  isGateInLockedRoom,
  isRoomUnlocked,
} from '../../src/core/physics';
import type { LevelSpec } from '../../src/core/types';
import { pickBlockAtBoardPoint } from '../../src/input/pointer-controller';
import { getAllCampaignLevels, getLevelSpec } from '../../src/levels/catalog';
import { computeStateHash, solveBoard } from '../../src/levels/solver';

describe('Multi-Room Portcullis Sanctums & Architectural Topologies', () => {
  it('SANCTUM-01 & SANCTUM-02: validates Multi-Room Portcullis Barriers (shredsRemaining, Key lockId, dormant room stasis, cross-room archway traversal, and Zero-Softlock Law)', () => {
    // 7x6 TWIN_SANCTUM split across row 3:
    // - South Courtyard (Room 0): rows 4..6
    // - Archway row 3: pillars at [3,0] and [3,5], Portcullis Barrier across [3,1..4] (shredsRemaining: 2)
    // - North Chamber (Room 1): rows 0..2 ( plus archway row 3)
    const room1Cells: Array<[number, number]> = [];
    for (let r = 0; r <= 2; r++) {
      for (let c = 0; c < 6; c++) {
        room1Cells.push([r, c]);
      }
    }

    const spec: LevelSpec = {
      id: 961,
      name: 'Twin Sanctum Portcullis',
      difficulty: 'NORMAL',
      layoutId: 'TWIN_SANCTUM',
      rows: 7,
      cols: 6,
      pillars: [
        [3, 0],
        [3, 5],
      ],
      barriers: [
        {
          id: 1,
          cells: [
            [3, 1],
            [3, 2],
            [3, 3],
            [3, 4],
          ],
          orientation: 'H',
          shredsRemaining: 2,
          unlocksRoomId: 1,
          roomCells: room1Cells,
        },
      ],
      blocks: [
        // South Courtyard (Room 0) blocks:
        { id: 1, shapeId: '1x2', row: 5, col: 1, colorStack: [1] },
        { id: 2, shapeId: '1x2', row: 5, col: 3, colorStack: [2] },
        // North Chamber (Room 1) block: Green 2x2 with bombCount=5 and iceCount=1 -> must stay dormant while Room 1 is sealed!
        { id: 3, shapeId: '2x2', row: 1, col: 2, colorStack: [3], bombCount: 5, iceCount: 1 },
      ],
      gates: [
        // South gates for Red (1), Blue (2), and Green (3)
        { edge: 'BOTTOM', spanStart: 0, spanLength: 3, colorQueue: [1, 3] },
        { edge: 'BOTTOM', spanStart: 3, spanLength: 3, colorQueue: [2] },
      ],
    };

    const board = createBoardState(spec);
    expect(board.barriers.length).toBe(1);
    expect(board.barriers[0].open).toBe(false);
    expect(board.barriers[0].shredsRemaining).toBe(2);
    // Closed barrier writes -3 into occupancy
    expect(board.occupancy[3 * 6 + 2]).toBe(-3);

    // North Chamber block (id=3) is in Room 1 and sealed
    expect(getBlockRoomId(board, board.blocks[2])).toBe(1);
    expect(isRoomUnlocked(board, 1)).toBe(false);
    expect(isBlockInLockedRoom(board, board.blocks[2])).toBe(true);
    expect(isBlockMovable(board, 3)).toBe(false);

    // Vacuum on Green (3) must NOT affect Block 3 while Room 1 is sealed
    expect(applyBoosterVacuum(board, 3)).toBe(false);

    // Shred Block 1 in Room 0 -> portcullis ticks down 2 -> 1
    const hashBefore = computeStateHash(board);
    const out1 = commitBlockMove(board, 1, 6, 1, 'ZEN');
    expect(out1.moved).toBe(true);
    expect(out1.clearedBlockIds).toContain(1);
    expect(out1.unlockedBarrierIds).toEqual([]);
    expect(board.barriers[0].shredsRemaining).toBe(1);
    expect(board.barriers[0].open).toBe(false);
    expect(computeStateHash(board)).not.toBe(hashBefore);

    // Dormant Room Stasis: Block 3's bombCount and iceCount did NOT tick down while Room 1 was locked!
    expect(board.blocks[2].bombCount).toBe(5);
    expect(board.blocks[2].iceCount).toBe(1);

    // Shred Block 2 in Room 0 -> portcullis ticks down 1 -> 0 and OPENS!
    const out2 = commitBlockMove(board, 2, 6, 3, 'ZEN');
    expect(out2.moved).toBe(true);
    expect(out2.clearedBlockIds).toContain(2);
    expect(out2.unlockedBarrierIds).toEqual([1]);
    expect(board.barriers[0].shredsRemaining).toBe(0);
    expect(board.barriers[0].open).toBe(true);
    expect(isRoomUnlocked(board, 1)).toBe(true);
    // Archway cells are now walkable floor (0)
    expect(board.occupancy[3 * 6 + 2]).toBe(0);

    // Clear ice on Block 3 and verify it can now slide from Room 1 (row 1) across the archway (row 3) to South gate (row 5)!
    board.blocks[2].iceCount = 0;
    expect(isBlockMovable(board, 3)).toBe(true);
    const solvedAfterUnlock = solveBoard(board, 300);
    expect(solvedAfterUnlock.solvable).toBe(true);
    const out3 = commitBlockMove(board, 3, 5, 1, 'ZEN');
    expect(out3.moved).toBe(true);
    expect(out3.clearedBlockIds).toContain(3);
    expect(isBoardWon(board)).toBe(true);

    // Also verify Key-Sealed Portcullis (`lockId: 1`) + Zero-Softlock Law
    const keyBarrierBoard = createBoardState({
      ...spec,
      barriers: [
        {
          id: 1,
          cells: [
            [3, 1],
            [3, 2],
            [3, 3],
            [3, 4],
          ],
          orientation: 'H',
          shredsRemaining: 0,
          lockId: 1,
          unlocksRoomId: 1,
          roomCells: room1Cells,
        },
      ],
      blocks: [
        { id: 1, shapeId: '1x2', row: 5, col: 1, colorStack: [1], hasKey: 1 },
        { id: 3, shapeId: '2x2', row: 1, col: 2, colorStack: [3] },
      ],
    });
    expect(keyBarrierBoard.barriers[0].open).toBe(false);
    // Solver solves the Key-Sealed 2-room board in 2 moves (shred Key block 1 -> unlocks Room 1 -> shred block 3)
    const keySolved = solveBoard(keyBarrierBoard, 400);
    expect(keySolved.solvable).toBe(true);
    expect(keySolved.minMoves).toBe(2);

    // Sealed-Room Stasis & Cutout Clamping Invariants (`MECH-16`..`MECH-18`):
    // Verify size-changing gate clamping on cutout edges, dormant gate stasis in locked rooms,
    // Key/Scissor priority in unlocked rooms, and elevator stasis in locked rooms.
    const stasisBoard = createBoardState({
      ...spec,
      cutouts: [
        [6, 0],
        [6, 5],
      ],
      elevators: [
        // Elevator inside locked Room 1 (row 1) -> must stay in stasis while Room 1 is sealed!
        { id: 1, row: 1, col: 0, width: 2, height: 1, deltaRow: 0, deltaCol: 1 },
      ],
      blocks: [
        // Room 1 chained block appears FIRST in blocks array, Room 0 chained block appears SECOND:
        // Key shredded in Room 0 must unlock Room 0's chained block first!
        { id: 10, shapeId: '1x1', row: 1, col: 0, colorStack: [3] },
        { id: 11, shapeId: '1x1', row: 0, col: 4, colorStack: [3], chained: true, lockId: 2 },
        { id: 1, shapeId: '1x2', row: 5, col: 1, colorStack: [1], hasKey: 2 },
        { id: 2, shapeId: '1x2', row: 4, col: 2, colorStack: [2], chained: true, lockId: 2 },
      ],
      gates: [
        // South gate on row 6 (where cols 0 and 5 are cutouts -> playable span is [1..4])
        {
          edge: 'BOTTOM',
          spanStart: 1,
          spanLength: 3,
          colorQueue: [1, 2, 3],
          sizeChangesOnClear: true,
          minLength: 2,
          maxLength: 4,
          slidesOnClear: true,
        },
        // North gate attached to locked Room 1 (row 0) with iceCount=2 and togglesOnClear=true
        {
          edge: 'TOP',
          spanStart: 1,
          spanLength: 3,
          colorQueue: [3],
          iceCount: 2,
          togglesOnClear: true,
          shutterOpen: true,
        },
      ],
    });

    // Shred Block 1 in Room 0 (carries Key 2, barrier has shredsRemaining: 2 so Room 1 stays locked after 1 shred):
    const stasisMove1 = commitBlockMove(stasisBoard, 1, 6, 1, 'ZEN');
    expect(stasisMove1.moved).toBe(true);
    expect(stasisBoard.barriers[0].open).toBe(false);
    // Key 2 unlocked Room 0's Block 2 (id=2), NOT locked Room 1's Block 11 (id=11)!
    expect(stasisBoard.blocks.find((b) => b.id === 2)?.chained).toBe(false);
    expect(stasisBoard.blocks.find((b) => b.id === 11)?.chained).toBe(true);
    // Locked Room 1's TOP gate kept its iceCount=2 and shutterOpen=true in stasis!
    expect(stasisBoard.gates[1].iceCount).toBe(2);
    expect(stasisBoard.gates[1].shutterOpen).toBe(true);
    // Locked Room 1's elevator did NOT move while Room 1 was sealed!
    expect(stasisBoard.elevators[0].atAlternatePos).toBe(false);
    // South gate on cutout edge stayed strictly within playable span [1..4] (never overlapping cutout col 0 or col 5)!
    expect(stasisBoard.gates[0].spanStart).toBeGreaterThanOrEqual(1);
    expect(stasisBoard.gates[0].spanStart + stasisBoard.gates[0].spanLength).toBeLessThanOrEqual(5);

    // Multi-Room Booster Shielding, Non-Convex Room Resolution & 4-Entry-Point Barrier Unlock Parity (`MECH-10`, `MECH-18`):
    // Verify crates/blocks in sealed rooms are shielded from Hammer & Rocket strikes,
    // smashing a Portcullis Barrier triggers ready generators in the newly awakened room,
    // non-convex polyominoes (`PLUS_5`) resolve their true roomId even when (row, col) is on a pillar,
    // and all destructive boosters (`Hammer`, `Rocket`, `Vacuum`) decrement `shredsRemaining` on Portcullis Barriers when clearing blocks in an unlocked room!
    const boosterShieldBoard = createBoardState({
      ...spec,
      pillars: [
        [0, 0],
        [3, 0],
        [3, 5],
      ],
      crates: [
        // Crate at (1, 4) inside sealed Room 1
        { id: 1, row: 1, col: 4, hp: 1 },
      ],
      generators: [
        // Ready generator at (2, 3) spawning at (2, 4) inside sealed Room 1 -> must stay dormant while sealed, then spawn when barrier is hammered!
        {
          id: 1,
          row: 2,
          col: 3,
          spawnRow: 2,
          spawnCol: 4,
          cooldown: 0,
          queue: [{ shapeId: '1x1', colorStack: [3] }],
        },
      ],
      blocks: [
        // Non-convex PLUS_5 at (0, 0) in Room 1 whose top-left [0, 0] cell sits on pillar [0, 0]
        { id: 20, shapeId: 'PLUS_5', row: 0, col: 0, colorStack: [3] },
        // Active blocks in Room 0 at (5, 2) and (4, 1)
        { id: 21, shapeId: '1x2', row: 5, col: 2, colorStack: [1] },
        { id: 22, shapeId: '1x2', row: 4, col: 1, colorStack: [2] },
      ],
    });

    // Generator in sealed Room 1 did NOT spawn during createBoardState while Room 1 was locked
    expect(boosterShieldBoard.generators[0].queueCursor).toBe(0);
    // Non-convex PLUS_5 at (0, 0) resolves to Room 1 even if [0, 0] is a pillar
    const plusBlock = boosterShieldBoard.blocks.find((b) => b.id === 20);
    if (!plusBlock) throw new Error('Expected plusBlock id=20');
    expect(getBlockRoomId(boosterShieldBoard, plusBlock)).toBe(1);
    expect(isBlockInLockedRoom(boosterShieldBoard, plusBlock)).toBe(true);

    // Hammer on crate (1, 4) inside sealed Room 1 is rejected while Room 1 is locked
    expect(applyBoosterHammer(boosterShieldBoard, 1, 4)).toBe(false);
    expect(boosterShieldBoard.crates[0].destroyed).toBe(false);

    // Rocket along ROW 1 (passing through sealed Room 1 without hitting row 3 barrier) does NOT destroy crate or PLUS_5
    expect(applyBoosterRocket(boosterShieldBoard, 1, 2, 'ROW')).toBe(false);
    expect(boosterShieldBoard.crates[0].destroyed).toBe(false);
    expect(plusBlock.status).toBe('ACTIVE');

    // Rocket on unlocked Room 0 block at row 5 decrements barrier shredsRemaining from 2 -> 1!
    expect(applyBoosterRocket(boosterShieldBoard, 5, 2, 'ROW')).toBe(true);
    expect(boosterShieldBoard.barriers[0].shredsRemaining).toBe(1);
    expect(boosterShieldBoard.barriers[0].open).toBe(false);

    // Vacuum on unlocked Room 0 color 2 block decrements barrier shredsRemaining from 1 -> 0, opening the Portcullis AND triggering Room 1's ready generator!
    expect(applyBoosterVacuum(boosterShieldBoard, 2)).toBe(true);
    expect(boosterShieldBoard.barriers[0].shredsRemaining).toBe(0);
    expect(boosterShieldBoard.barriers[0].open).toBe(true);
    expect(boosterShieldBoard.generators[0].queueCursor).toBe(1);
  });

  it('VAULT-01, VAULT-02, PORTRAIT-01 & GATE-ICE-01: validates Sealed Mystery Vaults, concealed block stasis, progressive multi-vault countdowns, synchronized Frozen Gates, and tall portrait campaign levels', () => {
    // 1. Level 28 (`Gilded Vault`, 8x6 tall portrait MYSTERY_VAULT)
    const lvl28 = createBoardState(getLevelSpec(28));
    expect(lvl28.rows).toBe(8);
    expect(lvl28.cols).toBe(6);
    expect(lvl28.layoutId).toBe('MYSTERY_VAULT');
    expect(lvl28.barriers.length).toBe(1);
    expect(lvl28.barriers[0].isVault).toBe(true);
    expect(lvl28.barriers[0].shredsRemaining).toBe(3);

    // Hidden blocks 6 and 7 inside the sealed vault leave occupancy at -3 and cannot be picked
    const hidden6 = lvl28.blocks.find((b) => b.id === 6);
    const hidden7 = lvl28.blocks.find((b) => b.id === 7);
    if (!hidden6 || !hidden7) throw new Error('Expected hidden blocks 6 & 7 on Level 28');
    expect(isBlockInSealedVault(lvl28, hidden6)).toBe(true);
    expect(isBlockInSealedVault(lvl28, hidden7)).toBe(true);
    expect(lvl28.occupancy[5 * lvl28.cols + 2]).toBe(-3);
    expect(lvl28.occupancy[6 * lvl28.cols + 2]).toBe(-3);
    expect(pickBlockAtBoardPoint(lvl28, 2.5, 5.5)).toBeNull();
    expect(getSealedVaultAtCell(lvl28, 5, 2)?.id).toBe(1);

    // Perimeter Frozen Gate at BOTTOM (iceCount: 3) is NOT locked by the vault room so it thaws on every shred
    const bottomGate28 = lvl28.gates.find((g) => g.edge === 'BOTTOM');
    if (!bottomGate28) throw new Error('Expected BOTTOM gate on Level 28');
    expect(isGateInLockedRoom(lvl28, bottomGate28)).toBe(false);
    expect(bottomGate28.iceCount).toBe(3);

    // Rocket fired along ROW 5 crossing the sealed vault does NOT pop open the vault or destroy hidden6
    expect(applyBoosterRocket(lvl28, 5, 2, 'ROW')).toBe(false);
    expect(lvl28.barriers[0].open).toBe(false);
    expect(hidden6.status).toBe('ACTIVE');

    // Shredding blocks 1, 2, and 3 in Room 0 ticks down both the Mystery Vault (3 -> 2 -> 1 -> 0) and the Frozen Gate (3 -> 2 -> 1 -> 0) in lockstep!
    commitBlockMove(lvl28, 1, 0, 2, 'ZEN');
    expect(lvl28.barriers[0].shredsRemaining).toBe(2);
    expect(lvl28.barriers[0].open).toBe(false);
    expect(bottomGate28.iceCount).toBe(2);

    commitBlockMove(lvl28, 2, 0, 2, 'ZEN');
    expect(lvl28.barriers[0].shredsRemaining).toBe(1);
    expect(lvl28.barriers[0].open).toBe(false);
    expect(bottomGate28.iceCount).toBe(1);

    commitBlockMove(lvl28, 3, 1, 5, 'ZEN');
    expect(lvl28.barriers[0].shredsRemaining).toBe(0);
    expect(lvl28.barriers[0].open).toBe(true);
    expect(bottomGate28.iceCount).toBe(0);

    // Once the vault opens, hidden6 and hidden7 become visible in occupancy (> 0) and pickable!
    expect(isBlockInSealedVault(lvl28, hidden6)).toBe(false);
    expect(lvl28.occupancy[5 * lvl28.cols + 2]).toBe(6);
    expect(pickBlockAtBoardPoint(lvl28, 2.5, 5.5)?.id).toBe(6);

    // 2. Level 74 (`Quad Vault Sanctum`, 9x7 tall portrait with 3 progressive Mystery Vaults: 3, 6, 9)
    const lvl74 = createBoardState(getLevelSpec(74));
    expect(lvl74.rows).toBe(9);
    expect(lvl74.cols).toBe(7);
    expect(lvl74.barriers.map((b) => b.shredsRemaining)).toEqual([3, 6, 9]);

    // Shredding block 1 in Room 0 decrements the 3 vaults to [2, 5, 8] without prematurely clamping Vault 2 or Vault 3!
    commitBlockMove(lvl74, 1, 0, 3, 'ZEN');
    expect(lvl74.barriers.map((b) => b.shredsRemaining)).toEqual([2, 5, 8]);
    expect(lvl74.barriers.map((b) => b.open)).toEqual([false, false, false]);

    // Verify campaign catalog includes tall portrait maps (rows > cols), MYSTERY_VAULT levels, and high-density & scaled breather invariants (`DENSITY-01`, `RAMP-01`)
    const allCampaign = getAllCampaignLevels();
    const portraitCount = allCampaign.filter((s) => s.rows > s.cols).length;
    const vaultCount = allCampaign.filter((s) => s.barriers?.some((b) => b.isVault)).length;
    expect(portraitCount).toBeGreaterThanOrEqual(40);
    expect(vaultCount).toBeGreaterThanOrEqual(25);

    // Verify high-density packing on curated showcase levels & procedural epochs (`DENSITY-01`)
    expect(getLevelSpec(25).blocks.length).toBeGreaterThanOrEqual(9);
    expect(getLevelSpec(28).blocks.length).toBeGreaterThanOrEqual(12);
    expect(getLevelSpec(38).blocks.length).toBeGreaterThanOrEqual(13);
    expect(getLevelSpec(74).blocks.length).toBeGreaterThanOrEqual(16);
    expect(getLevelSpec(200).blocks.length).toBeGreaterThanOrEqual(10);
    expect(getLevelSpec(250).blocks.length).toBeGreaterThanOrEqual(12);
    expect(getLevelSpec(300).blocks.length).toBeGreaterThanOrEqual(14);

    // Verify breather levels (`decPos === 6`) scale up progressively across epochs rather than staying at 4 blocks (`RAMP-01`)
    expect(getLevelSpec(16).blocks.length).toBeGreaterThanOrEqual(5);
    expect(getLevelSpec(36).blocks.length).toBeGreaterThanOrEqual(6);
    expect(getLevelSpec(66).blocks.length).toBeGreaterThanOrEqual(7);
    expect(getLevelSpec(156).blocks.length).toBeGreaterThanOrEqual(8);
    expect(getLevelSpec(256).blocks.length).toBeGreaterThanOrEqual(9);
  });

  it('VIEWPORT-01, PWA-UPDATE-01, TITLE-LOGO-01, CAVE-ETCH-01, UI-DEPTH-01 & MAP-JOURNEY-01: enforces zero-cutoff viewport geometry, monumental splash logo, cave-wall etching shader, 3-plane depth hierarchy, and progressive map journey invariants', () => {
    const repoRoot = path.resolve(process.cwd());
    const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
    expect(indexHtml).not.toContain('viewport-fit=cover');
    expect(indexHtml).toContain('logo-word-shred');
    expect(indexHtml).toContain('logo-word-blocks');
    expect(indexHtml).toContain('id="hero-awakening-banner"');
    expect(indexHtml).toContain('/fonts/fraunces-latin-var.woff2');
    expect(indexHtml).toContain('/fonts/plus-jakarta-sans-latin-var.woff2');
    expect(indexHtml).not.toContain('fonts.googleapis.com');

    // TYPOGRAPHY-01: Verify self-hosted SIL OFL variable WOFF2 binaries exist, are non-empty, and are pre-cached in public/sw.js
    const frauncesStat = fs.statSync(path.join(repoRoot, 'public/fonts/fraunces-latin-var.woff2'));
    const jakartaStat = fs.statSync(path.join(repoRoot, 'public/fonts/plus-jakarta-sans-latin-var.woff2'));
    expect(frauncesStat.size).toBeGreaterThan(50_000);
    expect(jakartaStat.size).toBeGreaterThan(15_000);

    const swJs = fs.readFileSync(path.join(repoRoot, 'public/sw.js'), 'utf8');
    expect(swJs).toContain("'/fonts/fraunces-latin-var.woff2'");
    expect(swJs).toContain("'/fonts/plus-jakarta-sans-latin-var.woff2'");

    const tokensCss = fs.readFileSync(path.join(repoRoot, 'src/styles/tokens-and-shell.css'), 'utf8');
    expect(tokensCss).toContain('--app-height');
    expect(tokensCss).toContain('height: var(--app-height, 100%)');
    expect(tokensCss).toContain('--font-logo');
    expect(tokensCss).toContain('font-family: "Fraunces"');
    expect(tokensCss).toContain('font-family: "Plus Jakarta Sans"');
    expect(tokensCss).toContain('font-size-adjust: from-font');
    expect(tokensCss).toContain('inset 0 1px 0');

    const gameCss = fs.readFileSync(path.join(repoRoot, 'src/styles/screen-game.css'), 'utf8');
    expect(gameCss).toContain('container-type: size');
    expect(gameCss).toContain('82cqh');
    expect(gameCss).not.toContain('min-height: 250px');

    const titleCss = fs.readFileSync(path.join(repoRoot, 'src/styles/title-and-a11y.css'), 'utf8');
    expect(titleCss).toContain('visibility: hidden');
    expect(titleCss).not.toContain('#screen-game.title-backdrop-mode .board-stage');
    expect(titleCss).toContain('var(--font-logo)');

    const homeCss = fs.readFileSync(path.join(repoRoot, 'src/styles/screen-home.css'), 'utf8');
    expect(homeCss).toContain('.level-node-card:not(.current-level) .badge-difficulty');
    expect(homeCss).toContain('.level-node-card.milestone-node:not(.current-level)');

    const shadersTs = fs.readFileSync(path.join(repoRoot, 'src/render/shaders-3d.ts'), 'utf8');
    expect(shadersTs).toContain('float zRelief = mix(1.0, 0.22, u_blueprintMix)');
    expect(shadersTs).toContain('quarryStone');
    expect(shadersTs).toContain('stoneCrack');
    expect(shadersTs).toContain('blueprintAlpha = 1.0');

    const pass1Gates = fs.readFileSync(path.join(repoRoot, 'src/render/pass1-gates-barriers.ts'), 'utf8');
    const pass2Barriers = fs.readFileSync(
      path.join(repoRoot, 'src/render/pass2-barriers-and-reticles.ts'),
      'utf8'
    );
    const pass3Blocks = fs.readFileSync(path.join(repoRoot, 'src/render/pass3-block-shells.ts'), 'utf8');
    expect(pass1Gates).toContain('const isStoneRuin =');
    expect(pass2Barriers).toContain('const isStoneRuin =');
    expect(pass3Blocks).toContain('const isStoneRuin =');

    const dialogsCss = fs.readFileSync(path.join(repoRoot, 'src/styles/dialogs.css'), 'utf8');
    expect(dialogsCss).toContain('.pwa-update-badge');
    expect(dialogsCss).not.toContain('bottom: calc(4.2rem + var(--safe-bottom))');
  });

  it('ARCH-ERGONOMICS-01: enforces single-call agentic file-size limits (<= 800 lines and <= 45,000 bytes) across all repository source, style, test, script, and doc files', () => {
    const repoRoot = path.resolve(process.cwd());
    const trackedExtensions = new Set(['.ts', '.css', '.html', '.md', '.js', '.json', '.jsonc', '.svg']);
    const ignoredDirs = new Set([
      'node_modules',
      'dist',
      '.git',
      '.certs',
      'test-results',
      'playwright-report',
    ]);
    const ignoredFiles = new Set(['package-lock.json']);

    const collectFiles = (dir: string, acc: string[] = []): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true }) as Array<{
        name: string;
        isDirectory: () => boolean;
      }>;
      for (const entry of entries) {
        if (ignoredDirs.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name) as string;
        if (entry.isDirectory()) {
          collectFiles(fullPath, acc);
        } else if (
          !ignoredFiles.has(entry.name) &&
          trackedExtensions.has(path.extname(entry.name) as string)
        ) {
          acc.push(fullPath);
        }
      }
      return acc;
    };

    const files = collectFiles(repoRoot);
    expect(files.length).toBeGreaterThanOrEqual(65);

    const violations: string[] = [];
    for (const filePath of files) {
      const rel = path.relative(repoRoot, filePath);
      const buf = fs.readFileSync(filePath);
      const lineCount = buf.toString('utf8').split('\n').length;
      const byteCount = buf.byteLength;
      if (lineCount > 800 || byteCount > 45_000) {
        violations.push(`${rel} (${lineCount} lines, ${byteCount} bytes)`);
      }
    }

    expect(violations).toEqual([]);
  });
});
