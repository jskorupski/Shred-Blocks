import { expect, type Page, test } from '@playwright/test';

/**
 * Helper to drag from board coordinates `(fromCol, fromRow)` to `(toCol, toRow)`
 * using 100% genuine Playwright mouse pointer events on `#game-canvas`.
 */
async function dragBoardCellToCell(
  page: Page,
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
  steps = 10
): Promise<void> {
  const pts = await page.evaluate(
    ({ c1, r1, c2, r2 }) => {
      const start = window.__SHREDBLOCKS_DEBUG__.boardToScreen(c1 + 0.5, r1 + 0.5);
      const end = window.__SHREDBLOCKS_DEBUG__.boardToScreen(c2 + 0.5, r2 + 0.5);
      return { start, end };
    },
    { c1: fromCol, r1: fromRow, c2: toCol, r2: toRow }
  );

  await page.mouse.move(pts.start.x, pts.start.y);
  await page.mouse.down();
  await page.mouse.move(pts.end.x, pts.end.y, { steps });
  await page.mouse.up();
}

/**
 * Helper to click a specific board cell `(col, row)` using a real mouse click on `#game-canvas`.
 */
async function clickBoardCell(page: Page, col: number, row: number): Promise<void> {
  const pt = await page.evaluate(({ c, r }) => window.__SHREDBLOCKS_DEBUG__.boardToScreen(c + 0.5, r + 0.5), {
    c: col,
    r: row,
  });
  await page.mouse.click(pt.x, pt.y);
}

test.describe('ShredBlocks: Color Jam — End-to-End Browser & Interactive Playtest Suite', () => {
  test('1. App Boot, Home Roadmap, Locked Level Toast Feedback, Range Filters, Direct Level Jump & Zero Console Errors', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(`CONSOLE_ERROR: ${msg.text()}`);
      }
    });

    await page.goto('/');
    // Verify Sacred-Geometry Title Screen launches in New Player mode over the live 3D board
    await expect(page.locator('#title-overlay')).toBeVisible();
    await expect(page.locator('#title-crest-heading')).toHaveText('ShredBlocks');
    await expect(page.locator('#title-new-player-tagline')).toBeVisible();
    await expect(page.locator('#title-returning-nav')).toBeHidden();
    await expect(page.locator('#btn-title-play')).toHaveText('▶ BEGIN JOURNEY');

    // Tapping '▶ BEGIN JOURNEY' launches a brand-new player straight into Level 1 (FTUE)
    await page.locator('#btn-title-play').click();
    await expect(page.locator('#title-overlay')).toBeHidden();
    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('#hud-level-title')).toContainText('Level 1');

    // Tapping '‹ Map' (#btn-hud-home) navigates to the 300-Level Sanctuary Map (#screen-home)
    await page.locator('#btn-hud-home').click();
    await expect(page.locator('#screen-home')).toBeVisible();
    await expect(page.locator('.brand-title').first()).toHaveText('ShredBlocks');
    await expect(page.locator('#stat-coins')).toHaveText('250');

    // Verify 300+ roadmap nodes render in All view
    const allNodesCount = await page.locator('#roadmap-list .level-node-card').count();
    expect(allNodesCount).toBeGreaterThanOrEqual(300);

    // Verify Sculpted Courtyard (🏛️ on L14) and Multi-Room Sanctum (⛩️ on L25) badges appear on Sanctuary Map
    await expect(page.locator('#roadmap-list .level-node-card').nth(13)).toContainText('🏛️');
    await expect(page.locator('#roadmap-list .level-node-card').nth(24)).toContainText('⛩️');

    // Click a locked level (#5) on Home Roadmap and verify global #game-toast feedback appears on #screen-home
    await page.locator('#roadmap-list .level-node-card').nth(4).click();
    await expect(page.locator('#game-toast')).toBeVisible();
    await expect(page.locator('#game-toast')).toContainText('Clear or Skip up to Level');

    // Filter by 51-100
    await page.locator('.chip-filter[data-range="51-100"]').click();
    const filteredCount = await page.locator('#roadmap-list .level-node-card').count();
    expect(filteredCount).toBe(50);

    // Filter by Endless (301+)
    await page.locator('.chip-filter[data-range="endless"]').click();
    const endlessFirstText = await page
      .locator('#roadmap-list .level-node-card .node-level-num')
      .first()
      .textContent();
    expect(endlessFirstText).toContain('301');

    // Direct Level Jump to Level 11
    await page.locator('#level-jump-input').fill('11');
    await page.locator('#btn-level-jump').click();
    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('#hud-level-title')).toContainText('Level 11');

    expect(errors).toEqual([]);
  });

  test('2. 100% Real Input Playtest: Pointer Drag-and-Drop & Keyboard Controls Beat Level 1 & Level 2 Back-to-Back', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(`CONSOLE_ERROR: ${msg.text()}`);
      }
    });

    await page.goto('/');
    await page.locator('#btn-title-play').click();
    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('#hud-level-title')).toContainText('Level 1');

    // Verify WebGL2 backend is active on Chrome Metal
    const telemetry = await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getTelemetry());
    expect(telemetry.rendererBackend).toBe('WEBGL2');

    // LEVEL 1:
    // Drag Block 1 (1x2 at row 1, col 1) along a realistic human curved/diagonal trajectory
    // through the half-cell center (col = 1.50) of the 3-wide TOP red gate (cols 1..3),
    // verifying smooth monotonic movement on every intermediate pointer step without hitching (`DRAG-04`).
    const curvedPts = await page.evaluate(() => {
      const waypoints: Array<[number, number]> = [
        [2.0, 1.5],
        [2.18, 1.38],
        [2.36, 1.22],
        [2.48, 1.02],
        [2.52, 0.82],
        [2.5, 0.62],
        [2.5, 0.42],
      ];
      return waypoints.map(([cx, ry]) => window.__SHREDBLOCKS_DEBUG__.boardToScreen(cx, ry));
    });

    await page.mouse.move(curvedPts[0].x, curvedPts[0].y);
    await page.mouse.down();
    let lastObservedY = 1.0;
    for (let i = 1; i < curvedPts.length; i++) {
      await page.mouse.move(curvedPts[i].x, curvedPts[i].y);
      const b1State = await page.evaluate(() => {
        const b = window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[0];
        return { status: b.status, x: b.x, y: b.y };
      });
      if (b1State.status === 'ACTIVE') {
        expect(b1State.y).toBeLessThan(lastObservedY - 0.05);
        lastObservedY = b1State.y;
      }
    }
    await page.mouse.up();

    // Verify Block 1 was shredded by mid-drag gate capture at the center of the wide gate (only 1 active block left)
    const activeAfterDrag1 = await page.evaluate(
      () => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks.filter((b) => b.status === 'ACTIVE').length
    );
    expect(activeAfterDrag1).toBe(1);

    // Clear Block 2 (2x1 at row 2, col 3) via keyboard Tab + ArrowRight into the RIGHT blue gate
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowRight');

    // Victory Modal must open purely from real pointer + keyboard gameplay (no debug autoSolve!)
    await expect(page.locator('#dialog-victory')).toBeVisible();
    await expect(page.locator('#victory-crest-ornament')).toBeVisible();
    await expect(page.locator('#victory-title')).toContainText('Cleared!');
    await expect(page.locator('#victory-stars')).toContainText('⭐⭐⭐');
    await expect(page.locator('#victory-stars .star-slot.earned')).toHaveCount(3);

    const saveAfterL1 = await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getSave());
    expect(saveAfterL1.coins).toBe(330); // 250 start + 50 first clear + 30 (3 stars)
    expect(saveAfterL1.highestLevelUnlocked).toBe(2);

    // Advance to Level 2 via Next Level button
    await page.locator('#btn-next-level').click();
    await expect(page.locator('#hud-level-title')).toContainText('Level 2');

    // LEVEL 2: Beat all 3 blocks using real pointer drag-and-drop on #game-canvas
    // Block 1 (row 1, col 1) -> TOP gate (row 0, col 1)
    await dragBoardCellToCell(page, 1, 1, 1, 0);
    // Block 2 (row 2, col 3) -> RIGHT gate (row 2, col 4)
    await dragBoardCellToCell(page, 3, 2, 4, 2);
    // Block 3 (row 3, col 1) -> BOTTOM gate (row 4, col 1)
    await dragBoardCellToCell(page, 1, 3, 1, 4);

    await expect(page.locator('#dialog-victory')).toBeVisible();
    const saveAfterL2 = await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getSave());
    expect(saveAfterL2.highestLevelUnlocked).toBe(3);

    // Return to Sanctuary Map via Victory Modal '‹ Map' button, then tap Brand Crest (#btn-home-title)
    // to verify Returning Player Title Screen flow ('▶ CONTINUE · LEVEL 3' + Map & Themes buttons)
    await page.locator('#btn-victory-home').click();
    await expect(page.locator('#screen-home')).toBeVisible();
    await page.locator('#btn-home-title').click();
    await expect(page.locator('#title-overlay')).toBeVisible();
    await expect(page.locator('#title-returning-summary')).toBeVisible();
    await expect(page.locator('#title-returning-nav')).toBeVisible();
    await expect(page.locator('#btn-title-play')).toHaveText('▶ CONTINUE · LEVEL 3');
    await page.locator('#btn-title-play').click();
    await expect(page.locator('#title-overlay')).toBeHidden();
    await expect(page.locator('#hud-level-title')).toContainText('Level 3');

    expect(errors).toEqual([]);
  });

  test('3. All 5 Boosters Executed via Real Canvas Clicks + Immobile Block Shake/Toast + Accidental Restart Undo', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));

    await page.goto('/');
    await page.locator('#btn-title-play').click();
    await page.locator('#btn-hud-home').click();
    // Jump to Level 3 via Direct Level Jump UI
    await page.locator('#level-jump-input').fill('3');
    await page.locator('#btn-level-jump').click();
    await expect(page.locator('#hud-level-title')).toContainText('Level 3');
    await expect(page.locator('#badge-booster-undo')).toHaveText('FREE (3)');

    // Make a real non-clearing pointer drag on Level 3: slide Block 1 from (row 1, col 1) up to (row 0, col 1)
    await dragBoardCellToCell(page, 1, 1, 1, 0);
    await expect(page.locator('#hud-moves-pill')).toContainText('Moves: 1');

    // Trigger Undo -> consumes 1 Free Undo and restores Moves: 0
    await page.locator('#btn-booster-undo').click();
    await expect(page.locator('#hud-moves-pill')).toContainText('Moves: 0');
    await expect(page.locator('#badge-booster-undo')).toHaveText('FREE (2)');

    // Make another real pointer move, press Restart (#btn-restart), then press Undo to recover pre-restart board!
    await dragBoardCellToCell(page, 1, 1, 1, 0);
    await expect(page.locator('#hud-moves-pill')).toContainText('Moves: 1');
    await page.locator('#btn-restart').click();
    await expect(page.locator('#hud-moves-pill')).toContainText('Moves: 0');
    await page.locator('#btn-booster-undo').click();
    await expect(page.locator('#hud-moves-pill')).toContainText('Moves: 1');

    // Jump to Level 41 (Frostbite Thaw) to test immobile Frozen block tap + real Hammer/Rocket/Vacuum execution on canvas
    await page.locator('#btn-pause').click();
    await page.locator('#btn-pause-home').click();
    await page.locator('#level-jump-input').fill('41');
    await page.locator('#btn-level-jump').click();
    await expect(page.locator('#hud-level-title')).toContainText('Level 41');

    // Tap Frozen Block 3 at (row 4, col 2) on #game-canvas -> verify #game-toast shows "❄️ Frozen!"
    await clickBoardCell(page, 2, 4);
    await expect(page.locator('#game-toast')).toBeVisible();
    await expect(page.locator('#game-toast')).toContainText('Frozen!');

    // Entering Hammer targeting and cancelling must NOT spend boosters or coins (`UX-04`)
    const beforeBoosters = await page.evaluate(() => ({
      coins: window.__SHREDBLOCKS_DEBUG__.getSave().coins,
      boosters: { ...window.__SHREDBLOCKS_DEBUG__.getSave().boosters },
    }));

    await page.locator('#btn-booster-hammer').click();
    await expect(page.locator('#booster-target-banner')).toBeVisible();
    await page.locator('#btn-cancel-booster').click();
    await expect(page.locator('#booster-target-banner')).toBeHidden();

    const afterCancelBoosters = await page.evaluate(() => ({
      coins: window.__SHREDBLOCKS_DEBUG__.getSave().coins,
      boosters: { ...window.__SHREDBLOCKS_DEBUG__.getSave().boosters },
    }));
    expect(afterCancelBoosters).toEqual(beforeBoosters);

    // 1. Execute HAMMER on Block 1 (at row 1, col 2) by clicking #game-canvas
    await page.locator('#btn-booster-hammer').click();
    await expect(page.locator('#booster-target-banner')).toBeVisible();
    await clickBoardCell(page, 2, 1);
    await expect(page.locator('#booster-target-banner')).toBeHidden();
    await expect(page.locator('#badge-booster-hammer')).toHaveText('2');

    // 2. Execute ROCKET (toggled to COL axis) on Block 2 (at row 2, col 4) by clicking #game-canvas
    await page.locator('#btn-booster-rocket').click();
    await expect(page.locator('#booster-target-banner')).toBeVisible();
    await page.locator('#btn-rocket-axis').click();
    await expect(page.locator('#btn-rocket-axis')).toContainText('COL');
    await clickBoardCell(page, 4, 2);
    await expect(page.locator('#booster-target-banner')).toBeHidden();
    await expect(page.locator('#badge-booster-rocket')).toHaveText('1');

    // 3. Execute COLOR VACUUM on Block 4 (at row 2, col 1) by clicking #game-canvas
    await page.locator('#btn-booster-vacuum').click();
    await expect(page.locator('#booster-target-banner')).toBeVisible();
    await clickBoardCell(page, 1, 2);
    await expect(page.locator('#booster-target-banner')).toBeHidden();
    await expect(page.locator('#badge-booster-vacuum')).toHaveText('1');

    // 4. Test Hint in Zen Mode and Freeze in Timed Rush Mode
    await page.locator('#btn-booster-freeze').click();
    const hasHint = await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().hintMove !== null);
    expect(hasHint).toBe(true);

    await page.locator('#btn-mode-toggle').click();
    await expect(page.locator('#hud-mode-label')).toContainText('Timed Rush');
    await expect(page.locator('#hud-timer-pill')).toBeVisible();
    await page.locator('#btn-booster-freeze').click();
    await expect(page.locator('#hud-timer-pill')).toContainText('❄️');

    expect(errors).toEqual([]);
  });

  test('4. All 18 Obstacles, Themes Studio Affordability Toast, Save Transfer (SB1, QR SVG, Rollback), Offline SW & WebGL Context Recovery', async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(`CONSOLE_ERROR: ${msg.text()}`);
      }
    });

    await page.goto('/');

    // Verify all 18 obstacle showcase levels + Sculpted Courtyards, Multi-Room Sanctums & Endless Mode load & render cleanly in WebGL2
    const showcaseLevels = [
      1, 11, 14, 18, 21, 22, 25, 31, 41, 51, 61, 71, 81, 91, 101, 111, 121, 131, 141, 151, 161, 171, 181, 200,
      201, 250, 300, 301,
    ];
    for (const lvl of showcaseLevels) {
      await page.evaluate((id) => window.__SHREDBLOCKS_DEBUG__.loadLevel(id), lvl);
      const boardId = await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().levelId);
      expect(boardId).toBe(lvl);
    }

    // Verify WebGL Context Loss & Instant Restoration
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.simulateContextLoss());
    const backendAfterRestore = await page.evaluate(
      () => window.__SHREDBLOCKS_DEBUG__.getTelemetry().rendererBackend
    );
    expect(backendAfterRestore).toBe('WEBGL2');

    // Verify 120Hz Benchmark meets workDurationMs <= 6.5ms budget
    const bench = await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.run120HzBenchmark(60));
    expect(bench.p95WorkMs).toBeLessThanOrEqual(6.5);

    // Return to Home & open Themes Studio via real UI clicks
    await page.locator('#btn-pause').click();
    await page.locator('#btn-pause-home').click();
    await page.locator('#tab-btn-themes').click();
    await expect(page.locator('#screen-themes')).toBeVisible();

    // Unlock & equip Smooth Bevel skin (150 coins -> leaves 100 coins)
    await page.locator('button[data-theme-id="smooth_bevel"]').click();
    const equippedSkin = await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getSave().equippedSkin);
    expect(equippedSkin).toBe('smooth_bevel');
    await expect(page.locator('#themes-coins-display')).toHaveText('100');

    // Click another locked 150-coin skin (gummy_jelly) with only 100 coins -> verify #game-toast affordability message
    await page.locator('button[data-theme-id="gummy_jelly"]').click();
    await expect(page.locator('#game-toast')).toBeVisible();
    await expect(page.locator('#game-toast')).toContainText('Need 150 Coins');

    // Verify all 8 Settings in #dialog-pause across custom skins & custom trays (`AX-01`, `AX-02`, `UX-10`)
    await page.locator('#tab-btn-settings').click();
    await expect(page.locator('#dialog-pause')).toBeVisible();

    await page.locator('#toggle-high-contrast').check();
    await page.locator('#toggle-colorblind').check();
    await page.locator('#toggle-reduced-motion').check();
    await page.locator('#toggle-sfx').uncheck();
    await page.locator('#toggle-music').uncheck();
    await page.locator('#toggle-haptics').uncheck();
    await page.locator('#select-quality-tier').selectOption('BALANCED_60');

    const bodyClassesAndSettings = await page.evaluate(() => {
      const s = window.__SHREDBLOCKS_DEBUG__.getSave().settings;
      const wheel = document.querySelector('.ornament-outer-wheel');
      const wheelAnim = wheel ? window.getComputedStyle(wheel).animationName : '';
      return {
        hcClass: document.body.classList.contains('high-contrast'),
        cbClass: document.body.classList.contains('colorblind-mode'),
        rmClass: document.body.classList.contains('reduced-motion'),
        wheelAnim,
        settings: s,
      };
    });
    expect(bodyClassesAndSettings.hcClass).toBe(true);
    expect(bodyClassesAndSettings.cbClass).toBe(true);
    expect(bodyClassesAndSettings.rmClass).toBe(true);
    expect(bodyClassesAndSettings.wheelAnim).toBe('none');
    expect(bodyClassesAndSettings.settings.highContrast).toBe(true);
    expect(bodyClassesAndSettings.settings.colorblindSymbols).toBe(true);
    expect(bodyClassesAndSettings.settings.reducedMotion).toBe(true);
    expect(bodyClassesAndSettings.settings.sfxEnabled).toBe(false);
    expect(bodyClassesAndSettings.settings.musicEnabled).toBe(false);
    expect(bodyClassesAndSettings.settings.hapticsEnabled).toBe(false);
    expect(bodyClassesAndSettings.settings.qualityTier).toBe('BALANCED_60');

    // Cycle through all 5 Block Skins x 5 Board Trays while High Contrast + Colorblind Symbols are active
    await page.evaluate(() => {
      const skins = ['classic_studs', 'smooth_bevel', 'gummy_jelly', 'carved_wood', 'neon_cyber'] as const;
      const trays = [
        'industrial_slate',
        'warm_birch',
        'midnight_arcade',
        'frosted_quartz',
        'mint_studio',
      ] as const;
      for (let i = 0; i < 5; i++) {
        window.__SHREDBLOCKS_DEBUG__.setTheme(skins[i], trays[i], 'micro_cubes');
      }
      window.__SHREDBLOCKS_DEBUG__.setHighContrast(false);
      window.__SHREDBLOCKS_DEBUG__.setColorblindMode(false);
      window.__SHREDBLOCKS_DEBUG__.setReducedMotion(false);
      window.__SHREDBLOCKS_DEBUG__.setQualityTier('AUTO');
    });
    await page.locator('#btn-pause-close').click();

    // WebGL2 Canvas Pixel-Diff Verification on Custom Theme (`neon_cyber` + `warm_birch` on Level 25):
    // Proves that toggling High Contrast and Colorblind Symbols on a non-default custom skin + custom tray
    // produces measurably distinct WebGL2 rendered frames (preventing silent shader/depth-clipping regressions).
    await page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.loadLevel(25);
      window.__SHREDBLOCKS_DEBUG__.setTheme('neon_cyber', 'warm_birch', 'pixel_sparks');
      window.__SHREDBLOCKS_DEBUG__.setReducedMotion(true);
      window.__SHREDBLOCKS_DEBUG__.setHighContrast(false);
      window.__SHREDBLOCKS_DEBUG__.setColorblindMode(false);
    });
    const canvasShotNormal = await page.locator('#game-canvas').screenshot();

    await page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setHighContrast(true);
    });
    const canvasShotHC = await page.locator('#game-canvas').screenshot();
    expect(canvasShotNormal.equals(canvasShotHC)).toBe(false);

    await page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setColorblindMode(true);
    });
    const canvasShotHCCB = await page.locator('#game-canvas').screenshot();
    expect(canvasShotHC.equals(canvasShotHCCB)).toBe(false);

    await page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setHighContrast(false);
      window.__SHREDBLOCKS_DEBUG__.setColorblindMode(false);
      window.__SHREDBLOCKS_DEBUG__.setReducedMotion(false);
      window.__SHREDBLOCKS_DEBUG__.setTheme('classic_studs', 'industrial_slate', 'micro_cubes');
    });
    await page.locator('#btn-pause').click();
    await page.locator('#btn-pause-home').click();

    // Open Save Transfer modal, verify SB1-... code and Offline QR SVG
    await page.locator('#tab-btn-save').click();
    await expect(page.locator('#dialog-save-transfer')).toBeVisible();
    const saveCode = await page.locator('#save-code-output').inputValue();
    expect(saveCode.startsWith('SB1-')).toBe(true);
    await expect(page.locator('#qr-code-container svg')).toBeVisible();

    // Test Preview Import -> Confirm Overwrite -> Undo Last Import (Restore Pre-Import Backup)
    await page.locator('#save-code-input').fill(saveCode);
    await page.locator('#btn-preview-import').click();
    await expect(page.locator('#import-diff-panel')).toBeVisible();
    await page.locator('#btn-confirm-import').click();
    await expect(page.locator('#btn-restore-backup')).toBeVisible();
    await page.locator('#btn-restore-backup').click();
    await expect(page.locator('#save-transfer-status')).toContainText('Restored pre-import');
    await page.locator('#btn-save-transfer-close').click();

    // Wait for Service Worker registration & test Offline Airplane Mode reload
    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.ready;
      }
    });
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#title-overlay')).toBeVisible();
    await page.locator('#btn-title-map').click();
    await expect(page.locator('#screen-home')).toBeVisible();
    await context.setOffline(false);

    expect(errors).toEqual([]);
  });

  test('5. Interactive Mechanics Playtest Across All 18 Obstacle Showcase Levels (MECH-01..MECH-11)', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));

    await page.goto('/');
    await page.locator('#btn-title-play').click();
    await expect(page.locator('#screen-game')).toBeVisible();

    // 1. Level 11: Axis-Locked Blocks + Unlock Banner visibility (MECH-03)
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(11));
    await expect(page.locator('#unlock-toast')).toBeVisible();
    await expect(page.locator('#unlock-toast-text')).toContainText('Axis-Locked');
    // Try dragging H-locked Block 1 (col 2, row 2) vertically -> must remain at row 2
    await dragBoardCellToCell(page, 2, 2, 2, 0);
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[0].row)).toBe(2);
    // Clear Block 4 at (col 4, row 2) up into TOP gate to open row 2, then drag H-locked Block 1 horizontally into RIGHT gate
    await dragBoardCellToCell(page, 4, 2, 4, 0);
    await dragBoardCellToCell(page, 2, 2, 5, 2);
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[0].status)).toBe(
      'CLEARED'
    );
    await expect(page.locator('#unlock-toast')).toBeHidden();

    // 2. Level 14 (Cruciform Atrium — CROSS_ATRIUM), Level 18 (East Wing Alcove — L_WING Stepped Gate),
    //    Level 21 (Cutouts & Interior Stone Pillars), and Level 25 (Twin Sanctum — Multi-Room Portcullis)
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(14));
    await expect(page.locator('#unlock-toast')).toBeVisible();
    await expect(page.locator('#unlock-toast-text')).toContainText('Sculpted Courtyards');
    await dragBoardCellToCell(page, 2, 1, 2, 0);
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[0].status)).toBe(
      'CLEARED'
    );

    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(18));
    await expect(page.locator('#unlock-toast')).toBeVisible();
    await expect(page.locator('#unlock-toast-text')).toContainText('Stepped Exit Gate');
    // Drag Block 1 (col 4, row 3) up into the Stepped-Edge TOP Gate (edgeLine = 2) at (col 4, row 2)
    await dragBoardCellToCell(page, 4, 3, 4, 2);
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[0].status)).toBe(
      'CLEARED'
    );

    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(21));
    // Drag Block 1 at (col 2, row 1) into TOP gate
    await dragBoardCellToCell(page, 2, 1, 2, 0);
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[0].status)).toBe(
      'CLEARED'
    );

    // Level 25: Twin Sanctum — Multi-Room Portcullis Barrier & Sunken Twilight Chamber Awakening
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(25));
    await expect(page.locator('#unlock-toast')).toBeVisible();
    await expect(page.locator('#unlock-toast-text')).toContainText('Multi-Room Sanctum');
    // Tap dormant Block 4 (col 2, row 1) in sealed North Chamber -> verify Chamber Sealed toast
    await clickBoardCell(page, 2, 1);
    await expect(page.locator('#game-toast')).toBeVisible();
    await expect(page.locator('#game-toast')).toContainText('Chamber Sealed!');
    // Attempting to drag dormant Block 4 (col 2, row 1) must not move or clear it
    await dragBoardCellToCell(page, 2, 1, 2, 0);
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[3].status)).toBe(
      'ACTIVE'
    );
    // Shred 2 South Courtyard blocks: Block 1 (col 2, row 5 -> BOTTOM gate at row 6) and Block 2 (col 4, row 3 -> RIGHT gate at col 5)
    await dragBoardCellToCell(page, 2, 5, 2, 6);
    expect(
      await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().barriers[0].shredsRemaining)
    ).toBe(1);
    await dragBoardCellToCell(page, 4, 3, 5, 3);
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().barriers[0].open)).toBe(true);
    await expect(page.locator('#game-toast')).toContainText('Portcullis Opened!');
    // Now drag newly awakened Block 4 from North Chamber (col 2, row 1) into TOP gate (col 2, row 0)!
    await dragBoardCellToCell(page, 2, 1, 2, 0);
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[3].status)).toBe(
      'CLEARED'
    );

    // 3. Level 31: Multi-Layer Shell Peel -> Core Shred
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(31));
    // Drag 2-layer Block 1 ([1, 2]) into TOP Red Gate -> peels outer layer 1, stays ACTIVE at colorCursor 1
    await dragBoardCellToCell(page, 2, 1, 2, 0);
    const l31AfterPeel = await page.evaluate(() => {
      const b = window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[0];
      return { status: b.status, cursor: b.colorCursor };
    });
    expect(l31AfterPeel).toEqual({ status: 'ACTIVE', cursor: 1 });

    // 4. Level 41: Frozen Ice Blocks Thaw
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(41));
    await dragBoardCellToCell(page, 2, 1, 2, 0); // Shred Block 1 -> iceCount 2 -> 1
    await dragBoardCellToCell(page, 4, 2, 5, 2); // Shred Block 2 -> iceCount 1 -> 0
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[2].iceCount)).toBe(0);
    await dragBoardCellToCell(page, 2, 4, 2, 5); // Shred thawed Block 3!
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[2].status)).toBe(
      'CLEARED'
    );

    // 5. Level 51: Star Blocks & Star Gates
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(51));
    // Clear Block 4 first so bottom lane is open
    await dragBoardCellToCell(page, 2, 4, 2, 5);
    // Drag Star Block 1 (row 2, col 2) down to non-star BOTTOM red gate -> rejected!
    await dragBoardCellToCell(page, 2, 2, 2, 5);
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[0].status)).toBe(
      'ACTIVE'
    );
    // Clear Block 2 at (row 1, col 2) left into LEFT gate, then drag Star Block 1 up into TOP Star Gate!
    await dragBoardCellToCell(page, 2, 1, 0, 1);
    await dragBoardCellToCell(page, 2, 5, 2, 0);
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[0].status)).toBe(
      'CLEARED'
    );

    // 6. Level 61: Key & Lock Blocks
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(61));
    await dragBoardCellToCell(page, 2, 1, 2, 0); // Shred Key Block 1
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[1].chained)).toBe(false);
    await dragBoardCellToCell(page, 2, 4, 2, 5); // Shred unlocked Block 2
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[1].status)).toBe(
      'CLEARED'
    );

    // 7. Level 71: Movable Neutral Stone Slider (FR-26, MECH-02)
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(71));
    // Slide Neutral Stone Block 1 from (col 2, row 1) left to (col 0, row 1)
    await dragBoardCellToCell(page, 2, 1, 0, 1);
    const stoneCol = await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[0].col);
    expect(stoneCol).toBe(0);
    // Now drag Red Block 2 from (col 2, row 3) straight up through the freed lane into TOP gate!
    await dragBoardCellToCell(page, 2, 3, 2, 0);
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[1].status)).toBe(
      'CLEARED'
    );

    // 8. Level 81: Wooden Crate Shatter & Boundary Pull-Outward Shred (MECH-04)
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(81));
    // Block 1 starts at (col 2, row 0) resting at TOP gate lip; pull outward to (col 2, row -1)
    await dragBoardCellToCell(page, 2, 0, 2, -1);
    const l81State = await page.evaluate(() => {
      const b = window.__SHREDBLOCKS_DEBUG__.getBoard();
      return { block1: b.blocks[0].status, crateHp: b.crates[0].hp };
    });
    expect(l81State).toEqual({ block1: 'CLEARED', crateHp: 0 });

    // 9. Level 91: Time-Bomb Countdown & Defusal
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(91));
    await dragBoardCellToCell(page, 4, 2, 5, 2); // Move 1: shred Block 3 -> Bomb 1 ticks 10 -> 9
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[0].bombCount)).toBe(9);

    // 10. Level 101: Glued Linked Groups Split on Shred
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(101));
    await dragBoardCellToCell(page, 2, 2, 2, 0); // Drag Block 1 up -> Block 1 shreds, glued partner Block 2 stays at row 0, col 3
    const l101State = await page.evaluate(() => {
      const b = window.__SHREDBLOCKS_DEBUG__.getBoard();
      return { b1: b.blocks[0].status, b2Status: b.blocks[1].status, b2Row: b.blocks[1].row };
    });
    expect(l101State).toEqual({ b1: 'CLEARED', b2Status: 'ACTIVE', b2Row: 0 });

    // 11. Level 111: Colored Ropes & Scissors
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(111));
    await dragBoardCellToCell(page, 2, 1, 2, 0); // Shred Scissor Block 1
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[1].ropeColor)).toBe(0);

    // 12. Level 121: Color-Changing Gate Queue
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(121));
    await dragBoardCellToCell(page, 2, 1, 2, 0); // Shred Red Block 1 -> TOP gate queueCursor advances to 1 (Blue)
    await dragBoardCellToCell(page, 2, 3, 2, 0); // Shred Blue Block 2 through the same TOP gate!
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[1].status)).toBe(
      'CLEARED'
    );

    // 13. Level 131: Frozen Gate Thaw
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(131));
    await dragBoardCellToCell(page, 2, 1, 2, 0);
    await dragBoardCellToCell(page, 4, 2, 5, 2);
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().gates[2].iceCount)).toBe(0);

    // 14. Level 141 & 145: Jewel-Locked & Toggling Shutter Gates
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(141));
    await dragBoardCellToCell(page, 2, 1, 2, 0); // Shred Gem Block 1 -> opens BOTTOM shutter gate
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().gates[1].shutterOpen)).toBe(
      true
    );

    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(145));
    await dragBoardCellToCell(page, 2, 1, 2, 0); // Shred Block 1 -> toggles TOP shutter gate closed
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().gates[0].shutterOpen)).toBe(
      false
    );

    // 15. Level 151 & 155: Sliding & Size-Changing Gates
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(151));
    await dragBoardCellToCell(page, 1, 1, 1, 0);
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().gates[0].spanStart)).toBe(2);

    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(155));
    await dragBoardCellToCell(page, 1, 1, 1, 0);
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().gates[0].spanLength)).toBe(3);

    // 16. Level 161: Block Generators
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(161));
    await dragBoardCellToCell(page, 2, 1, 2, 0); // Shred Block 1 -> Generator spawns Block 4
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks.length)).toBe(4);

    // 17. Level 171: Colorful Floor Paths
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(171));
    await dragBoardCellToCell(page, 2, 2, 2, 0); // Red Block 1 crosses red floor path at (row 1, col 2..3)
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[0].status)).toBe(
      'CLEARED'
    );

    // 18. Level 181: Moving Elevators
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(181));
    await dragBoardCellToCell(page, 4, 1, 5, 1); // Shred Block 2 -> Elevator shifts Block 1 from col 1 to col 2
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks[0].col)).toBe(2);

    // 19. Level 28: Sealed Mystery Vault (`Gilded Vault`, 8x6 Tall Portrait) + Tap Toast + Synchronized Frozen Gate
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(28));
    const l28CanvasCheck = await page.evaluate(() => {
      const c = document.getElementById('game-canvas');
      if (!c) return { aspectVar: 1, w: 0, h: 0 };
      const rect = c.getBoundingClientRect();
      return {
        aspectVar: Number.parseFloat(c.style.getPropertyValue('--board-aspect') || '1'),
        w: rect.width,
        h: rect.height,
      };
    });
    expect(l28CanvasCheck.aspectVar).toBeCloseTo(0.7906, 2);
    expect(l28CanvasCheck.h).toBeGreaterThan(l28CanvasCheck.w);

    // Tapping the sealed vault lid at (col 2, row 5) triggers the Sealed Mystery Vault toast without moving hidden blocks
    const vaultTapPt = await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.boardToScreen(2.5, 5.5));
    await page.mouse.click(vaultTapPt.x, vaultTapPt.y);
    await expect(page.locator('#game-toast')).toContainText('Sealed Mystery Vault: Shred 3 more blocks');

    // Shred Blocks 1, 2, and 3 in Room 0 to unlock the vault and thaw the bottom Frozen Gate
    await dragBoardCellToCell(page, 2, 0, 2, -1);
    await dragBoardCellToCell(page, 2, 1, 2, 0);
    await dragBoardCellToCell(page, 4, 1, 5, 1);
    const l28Unlocked = await page.evaluate(() => {
      const b = window.__SHREDBLOCKS_DEBUG__.getBoard();
      return {
        vaultOpen: b.barriers[0].open,
        bottomGateIce: b.gates.find((g) => g.edge === 'BOTTOM')?.iceCount ?? -1,
        occAt52: b.occupancy[5 * b.cols + 2],
      };
    });
    expect(l28Unlocked).toEqual({ vaultOpen: true, bottomGateIce: 0, occAt52: 6 });

    // 20. Level 74: Quad Vault Sanctum (9x7 Tall Portrait Multi-Vault Puzzle Box)
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(74));
    await dragBoardCellToCell(page, 3, 0, 3, -1); // Shred Block 1 -> all 3 vaults step from [3, 6, 9] to [2, 5, 8]
    expect(
      await page.evaluate(() =>
        window.__SHREDBLOCKS_DEBUG__.getBoard().barriers.map((b) => b.shredsRemaining)
      )
    ).toEqual([2, 5, 8]);

    expect(errors).toEqual([]);
  });
});
