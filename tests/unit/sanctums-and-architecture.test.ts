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
import { COLOR_PALETTE, type ColorId, type LevelSpec, type SkinId, type TrayId } from '../../src/core/types';
import { pickBlockAtBoardPoint } from '../../src/input/pointer-controller';
import { getAllCampaignLevels, getLevelSpec } from '../../src/levels/catalog';
import { computeStateHash, solveBoard } from '../../src/levels/solver';
import { getStoneThemeMineralTint } from '../../src/render/render-types';

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
  }, 25_000);

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
    expect(swJs).toContain("'/favicon.ico'");

    // SEO-OG-FAVICON-01: Verify SEO/OpenGraph/Twitter/JSON-LD metadata, multi-size ICO favicon, 1200x630 OG card, and Cloudflare Pages _headers
    expect(indexHtml).toContain(
      'property="og:image" content="https://shredblocks.skorupski.org/og-image.png"'
    );
    expect(indexHtml).toContain('property="og:image:width" content="1200"');
    expect(indexHtml).toContain('property="og:image:height" content="630"');
    expect(indexHtml).toContain('name="twitter:card" content="summary_large_image"');
    expect(indexHtml).toContain(
      'name="twitter:image" content="https://shredblocks.skorupski.org/og-image.png"'
    );
    expect(indexHtml).toContain('href="/favicon.ico" sizes="48x48 32x32 16x16"');
    const jsonLdMatch = indexHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
    expect(jsonLdMatch).not.toBeNull();
    const jsonLd = JSON.parse(jsonLdMatch?.[1] ?? '{}') as {
      '@type': string[];
      isAccessibleForFree: boolean;
    };
    expect(jsonLd['@type']).toContain('VideoGame');
    expect(jsonLd.isAccessibleForFree).toBe(true);

    const icoBuf = fs.readFileSync(path.join(repoRoot, 'public/favicon.ico'));
    expect(icoBuf.readUInt16LE(0)).toBe(0);
    expect(icoBuf.readUInt16LE(2)).toBe(1); // ICO type
    expect(icoBuf.readUInt16LE(4)).toBe(3); // 16x16, 32x32, 48x48

    const ogBuf = fs.readFileSync(path.join(repoRoot, 'public/og-image.png'));
    expect(ogBuf.readUInt32BE(16)).toBe(1200);
    expect(ogBuf.readUInt32BE(20)).toBe(630);

    const cfHeaders = fs.readFileSync(path.join(repoRoot, 'public/_headers'), 'utf8');
    expect(cfHeaders).toContain('/favicon.ico');
    expect(cfHeaders).toContain('Content-Type: image/x-icon');
    expect(cfHeaders).toContain('/og-image.png');
    expect(fs.existsSync(path.join(repoRoot, 'public/robots.txt'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'public/sitemap.xml'))).toBe(true);

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
    const roadmapPathCss = fs.readFileSync(path.join(repoRoot, 'src/styles/roadmap-path.css'), 'utf8');
    expect(homeCss).toContain('.roadmap-chapter-banner');
    expect(roadmapPathCss).toContain('.roadmap-stage-group');
    expect(roadmapPathCss).toContain('.stage-group-track::before');
    expect(roadmapPathCss).toContain('.level-node-card.completed-level');
    expect(roadmapPathCss).toContain('.level-node-card.skipped-level');
    expect(roadmapPathCss).toContain('.level-node-card:not(.current-level) .badge-difficulty');
    expect(roadmapPathCss).toContain('.level-node-card.milestone-node:not(.current-level)');

    const shadersTs =
      fs.readFileSync(path.join(repoRoot, 'src/render/shaders-3d.ts'), 'utf8') +
      fs.readFileSync(path.join(repoRoot, 'src/render/shaders-main-vertex.ts'), 'utf8') +
      fs.readFileSync(path.join(repoRoot, 'src/render/shaders-glsl-lib.ts'), 'utf8') +
      fs.readFileSync(path.join(repoRoot, 'src/render/shaders-tray-materials.ts'), 'utf8');
    expect(shadersTs).toContain('stoneRelief');
    expect(shadersTs).toContain('runeDist');
    expect(shadersTs).toContain('u_blockSeed');
    expect(shadersTs).toContain('applyTrayMaterial');
    expect(shadersTs).toContain('u_trayMaterial');
    expect(shadersTs).toContain('neonCol');
    expect(shadersTs).toContain('knotDist');
    expect(shadersTs).toContain('float zRelief = mix(1.0, 0.76, u_blueprintMix)');
    expect(shadersTs).toContain('rotateRelicVec');
    expect(shadersTs).toContain('u_stoneTint');
    expect(shadersTs).toContain('astrolabeAlloy');
    expect(shadersTs).toContain('stoneCrack');
    expect(shadersTs).toContain('champagneRim');
    expect(shadersTs).toContain('satinSheen');
    expect(shadersTs).toContain('arcanePurple');
    expect(shadersTs).toContain('godRaySweep');
    expect(shadersTs).toContain('totalMysticGlow');
    expect(shadersTs).toContain('blueprintAlpha = 1.0');

    const screenGameCss = fs.readFileSync(path.join(repoRoot, 'src/styles/screen-game.css'), 'utf8');
    expect(screenGameCss).toContain('@keyframes mysticGodRays');

    // MYSTIC-RELIC-01 living crack pulses + STONE-FLOOR-01 gameplay stone surfaces
    expect(shadersTs).toContain('crackPulse');
    expect(shadersTs).toContain('voronoiRockCrack');
    expect(shadersTs).toContain('astrolabeTicks');
    expect(shadersTs).toContain('u_materialStyle == 5');
    // Classic Studs default + BLOCK-STONE-01 Relic Stone Tier-1 upgrade (worn meshes + carved sigils) & WOOD-GRAIN-01 realistic wood
    expect(shadersTs).toContain('u_materialStyle == 6');
    expect(shadersTs).toContain('ringCoord');
    const meshGenTs = fs.readFileSync(path.join(repoRoot, 'src/render/mesh-generator.ts'), 'utf8');
    expect(meshGenTs).toContain('meshOuterWorn');
    const catalogTs = fs.readFileSync(path.join(repoRoot, 'src/ui/catalog-meta.ts'), 'utf8');
    expect(catalogTs.indexOf("id: 'classic_studs'")).toBeLessThan(catalogTs.indexOf("id: 'relic_stone'"));
    const saveManagerTs = fs.readFileSync(path.join(repoRoot, 'src/storage/save-manager.ts'), 'utf8');
    expect(saveManagerTs).toContain("equippedSkin: 'classic_studs'");
    expect(shadersTs).toContain("from './shaders-particles'");
    expect(fs.readFileSync(path.join(repoRoot, 'src/render/pass1-courtyard.ts'), 'utf8')).toContain(
      'STONE_SURFACE_STYLE'
    );
    expect(fs.readFileSync(path.join(repoRoot, 'src/render/pass1-courtyard.ts'), 'utf8')).toContain(
      'TRAY_WALL_STYLE'
    );
    expect(fs.readFileSync(path.join(repoRoot, 'src/render/pass1-gates-barriers.ts'), 'utf8')).toContain(
      'TRAY_WALL_STYLE'
    );
    const renderTypesTs = fs.readFileSync(path.join(repoRoot, 'src/render/render-types.ts'), 'utf8');
    expect(renderTypesTs).toContain('export const STONE_SURFACE_STYLE = 5');
    expect(renderTypesTs).toContain('export const TRAY_WALL_STYLE = 7');

    // ARCH-ERGONOMICS-01 extracted modules & on-demand skill-style agent reference docs stay wired
    const mainTs = fs.readFileSync(path.join(repoRoot, 'src/main.ts'), 'utf8');
    expect(mainTs).toContain("from './ui/boosters-controller'");
    expect(mainTs).toContain("from './ui/outcome-modals-view'");
    expect(fs.existsSync(path.join(repoRoot, 'src/render/shaders-particles.ts'))).toBe(true);
    for (const refDoc of [
      'docs/ARCHITECTURE_AND_RULES.md',
      'docs/PHYSICS_AND_MECHANICS.md',
      'docs/RENDERING_AND_SHADERS.md',
      'docs/PROGRESSION_AND_ECONOMY.md',
      'docs/UI_PWA_STORAGE_AND_SEO.md',
    ]) {
      expect(fs.existsSync(path.join(repoRoot, refDoc))).toBe(true);
    }

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
    const portabilityViolations: string[] = [];
    const forbiddenPatterns: Array<{ label: string; regex: RegExp }> = [
      { label: 'macOS user home path', regex: /\/Users\/[A-Za-z0-9][A-Za-z0-9._-]*/ },
      { label: 'Linux user home path', regex: /\/home\/[A-Za-z0-9][A-Za-z0-9._-]*/ },
      { label: 'Windows user home path', regex: /[A-Za-z]:\\Users\\[A-Za-z0-9][A-Za-z0-9._-]*/ },
      { label: 'Agent local config path', regex: /\.gemini\/[A-Za-z0-9][A-Za-z0-9._-]*/ },
      { label: 'PEM private key', regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
      {
        label: 'API token or secret key',
        regex:
          /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/,
      },
    ];

    for (const filePath of files) {
      const rel = path.relative(repoRoot, filePath);
      const buf = fs.readFileSync(filePath);
      const text = buf.toString('utf8');
      const lineCount = text.split('\n').length;
      const byteCount = buf.byteLength;
      if (lineCount > 800 || byteCount > 45_000) {
        violations.push(`${rel} (${lineCount} lines, ${byteCount} bytes)`);
      }
      for (const { label, regex } of forbiddenPatterns) {
        const match = text.match(regex);
        if (match) {
          portabilityViolations.push(`${rel}: ${label} (${match[0]})`);
        }
      }
    }

    expect(violations).toEqual([]);
    expect(portabilityViolations).toEqual([]);

    // REPO-PORTABILITY-01: Ensure .gitignore excludes local TLS certs and .env files, and wrangler.jsonc stays account-agnostic
    const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.certs');
    expect(gitignore).toContain('.env');
    const wranglerJsonc = fs.readFileSync(path.join(repoRoot, 'wrangler.jsonc'), 'utf8');
    expect(wranglerJsonc).not.toContain('account_id');
    expect(wranglerJsonc).not.toContain('zone_id');
  });

  it('STONE-TABLET-01 theme mineral tint: derives distinct desaturated stone mineral tints across all 5 trays and 5 skins without punchy saturation', () => {
    const slateTint = getStoneThemeMineralTint('industrial_slate', 'classic_studs');
    const birchTint = getStoneThemeMineralTint('warm_birch', 'carved_wood');
    const midnightTint = getStoneThemeMineralTint('midnight_arcade', 'neon_cyber');
    const quartzTint = getStoneThemeMineralTint('frosted_quartz', 'relic_stone');
    const mintTint = getStoneThemeMineralTint('mint_studio', 'gummy_jelly');

    expect(slateTint[2]).toBeGreaterThan(slateTint[0]); // Cool architectural slate-gray
    expect(birchTint[0]).toBeGreaterThan(birchTint[2]); // Warm sun-baked travertine/sandstone
    expect(midnightTint[2]).toBeGreaterThan(midnightTint[1]); // Smoky obsidian-violet basalt
    expect(quartzTint[2]).toBeGreaterThan(quartzTint[0]); // Pale glacial quartzite
    expect(mintTint[1]).toBeGreaterThan(mintTint[0]); // Muted celadon-sage slate

    const skins: SkinId[] = ['classic_studs', 'relic_stone', 'gummy_jelly', 'carved_wood', 'neon_cyber'];
    const trays: TrayId[] = [
      'industrial_slate',
      'warm_birch',
      'midnight_arcade',
      'frosted_quartz',
      'mint_studio',
    ];
    for (const tray of trays) {
      for (const skin of skins) {
        const rgb = getStoneThemeMineralTint(tray, skin);
        for (const ch of rgb) {
          expect(ch).toBeGreaterThanOrEqual(0.84);
          expect(ch).toBeLessThanOrEqual(1.16);
        }
        expect(Math.max(...rgb) - Math.min(...rgb)).toBeLessThanOrEqual(0.28);
      }
    }
  });

  it('AX-01 & AX-02: Universal CVD-Safe Jewel Palette maintains strong OKLab ΔE separation across Deuteranopia, Protanopia, and Tritanopia', () => {
    const srgbToLin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const linToSrgb = (v: number) => {
      const cl = Math.max(0, Math.min(1, v));
      return cl <= 0.0031308 ? 12.92 * cl : 1.055 * cl ** (1 / 2.4) - 0.055;
    };
    const simCvd = (rgb: [number, number, number], m: number[][]): [number, number, number] => {
      const lr = srgbToLin(rgb[0]);
      const lg = srgbToLin(rgb[1]);
      const lb = srgbToLin(rgb[2]);
      return [
        linToSrgb(m[0][0] * lr + m[0][1] * lg + m[0][2] * lb),
        linToSrgb(m[1][0] * lr + m[1][1] * lg + m[1][2] * lb),
        linToSrgb(m[2][0] * lr + m[2][1] * lg + m[2][2] * lb),
      ];
    };
    const toOklab = (rgb: [number, number, number]): [number, number, number] => {
      const r = srgbToLin(rgb[0]);
      const g = srgbToLin(rgb[1]);
      const b = srgbToLin(rgb[2]);
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
      ];
    };
    const deltaE = (a: [number, number, number], b: [number, number, number]) => {
      const oa = toOklab(a);
      const ob = toOklab(b);
      return Math.hypot(oa[0] - ob[0], oa[1] - ob[1], oa[2] - ob[2]) * 100;
    };
    const mDeut = [
      [0.367322, 0.860646, -0.227968],
      [0.280085, 0.672501, 0.047413],
      [-0.01182, 0.04294, 0.968881],
    ];
    const mProt = [
      [0.152286, 1.052583, -0.204868],
      [0.114503, 0.786281, 0.099216],
      [-0.003882, -0.048116, 1.051998],
    ];
    const mTrit = [
      [1.255528, -0.076749, -0.178779],
      [-0.078411, 0.930809, 0.147602],
      [0.004733, 0.691367, 0.3039],
    ];

    const relLum = (rgb: [number, number, number]) =>
      0.2126 * srgbToLin(rgb[0]) + 0.7152 * srgbToLin(rgb[1]) + 0.0722 * srgbToLin(rgb[2]);
    const contrast = (a: [number, number, number], b: [number, number, number]) => {
      const la = relLum(a);
      const lb = relLum(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    const simDanom = (rgb: [number, number, number]): [number, number, number] => {
      const d = simCvd(rgb, mDeut);
      return [rgb[0] * 0.35 + d[0] * 0.65, rgb[1] * 0.35 + d[1] * 0.65, rgb[2] * 0.35 + d[2] * 0.65];
    };

    for (const [pick, pickGlyph] of [
      [(e: (typeof COLOR_PALETTE)[ColorId]) => e.cbRgb, (e: (typeof COLOR_PALETTE)[ColorId]) => e.cbGlyphRgb],
      [
        (e: (typeof COLOR_PALETTE)[ColorId]) => e.cbHcRgb,
        (e: (typeof COLOR_PALETTE)[ColorId]) => e.cbHcGlyphRgb,
      ],
    ] as const) {
      for (let i = 0 as ColorId; i <= 9; i = (i + 1) as ColorId) {
        const base = pick(COLOR_PALETTE[i]);
        const glyph = pickGlyph(COLOR_PALETTE[i]);
        // Simulates top-face 3D standard lighting (`litFactor = 1.16, spec = 0.09`) for WCAG 1.4.11 >= 3.0:1 non-text contrast
        const litSurface: [number, number, number] = [
          Math.min(1, base[0] * 1.16 + 0.09),
          Math.min(1, base[1] * 1.16 + 0.09),
          Math.min(1, base[2] * 1.16 + 0.09),
        ];
        expect(contrast(litSurface, glyph)).toBeGreaterThanOrEqual(4.2);
      }
      for (let i = 1 as ColorId; i <= 9; i = (i + 1) as ColorId) {
        for (let j = (i + 1) as ColorId; j <= 9; j = (j + 1) as ColorId) {
          const ci = pick(COLOR_PALETTE[i]);
          const cj = pick(COLOR_PALETTE[j]);
          expect(deltaE(ci, cj)).toBeGreaterThanOrEqual(20.0);
          expect(deltaE(simDanom(ci), simDanom(cj))).toBeGreaterThanOrEqual(17.0);
          expect(deltaE(simCvd(ci, mDeut), simCvd(cj, mDeut))).toBeGreaterThanOrEqual(14.5);
          expect(deltaE(simCvd(ci, mProt), simCvd(cj, mProt))).toBeGreaterThanOrEqual(14.5);
          expect(deltaE(simCvd(ci, mTrit), simCvd(cj, mTrit))).toBeGreaterThanOrEqual(14.5);
        }
      }
    }
  });
});
