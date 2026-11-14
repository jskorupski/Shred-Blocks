import { expect, type Page, test } from '@playwright/test';

async function bootWithMultiModeSave(page: Page): Promise<void> {
  const seededSave = {
    schemaVersion: 1,
    appId: 'shredblocks-color-jam',
    writeSeq: 12,
    updatedAt: 1_760_000_000_000,
    highestLevelUnlocked: 95,
    currentLevelId: 85,
    modeState: {
      CHALLENGE: { highestUnlocked: 95, currentLevelId: 85 },
      ZEN: { highestUnlocked: 40, currentLevelId: 28 },
      TIMED: { highestUnlocked: 15, currentLevelId: 12 },
    },
    coins: 600,
    totalStars: 36,
    winStreak: 2,
    bestWinStreak: 4,
    totalBlocksShredded: 110,
    totalMovesCommitted: 150,
    shredderChestProgress: 30,
    milestoneChestLevel: 20,
    starReliquaryLevel: 25,
    economyVersion: 2,
    modeLadderVersion: 1,
    boosters: { UNDO: 3, HINT: 2, HAMMER: 2, ROCKET: 2, VACUUM: 1 },
    unlockedSkins: ['classic_studs', 'relic_stone'],
    unlockedTrays: ['industrial_slate', 'warm_birch'],
    unlockedParticles: ['micro_cubes', 'star_confetti', 'pixel_sparks', 'soap_bubbles', 'lightning_bolts'],
    equippedSkin: 'classic_studs',
    equippedTray: 'industrial_slate',
    equippedParticle: 'micro_cubes',
    settings: {
      playMode: 'CHALLENGE',
      sfxEnabled: false,
      musicEnabled: false,
      hapticsEnabled: false,
      colorblindSymbols: false,
      highContrast: false,
      reducedMotion: true,
      qualityTier: 'ULTRA_120',
    },
    levelRecords: {
      1: { stars: 3, bestMoves: 3, bestTimeSec: 18 },
    },
  };

  await page.addInitScript(
    (raw) => window.localStorage.setItem('shredblocks.save.v1', raw),
    JSON.stringify(seededSave)
  );
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SHREDBLOCKS_DEBUG__));
}

test.describe('Sanctuary Map Auto-Scroll, Filter Reset & HUD Title Return', () => {
  test('HUD title/difficulty region return, Map entry, mode switches, and Save Sync/Restore reset filters & scroll to active stage', async ({
    page,
  }) => {
    await bootWithMultiModeSave(page);
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(72));

    const expectCurrentStageVisibleInMap = async (expectedId: number) => {
      await expect(page.locator('#screen-home')).toBeVisible();
      await expect(page.locator('#hero-level-heading')).toContainText(`Level ${expectedId} —`);
      await expect(page.locator('.chip-filter[data-range="all"]')).toHaveAttribute('aria-pressed', 'true');
      await expect
        .poll(async () => {
          return page.evaluate((lvl) => {
            const list = document.getElementById('roadmap-list');
            const node = list?.querySelector<HTMLElement>(
              `.level-node-card.current-level[data-level-id="${lvl}"]`
            );
            if (!list || !node) return false;
            const lr = list.getBoundingClientRect();
            const nr = node.getBoundingClientRect();
            return nr.top >= lr.top - 4 && nr.bottom <= lr.bottom + 4;
          }, expectedId);
        })
        .toBe(true);
    };

    // 1. Clicking #hud-level-title, #hud-difficulty-badge, and outer #btn-hud-title-map region returns to Map, syncs Hero, and scrolls
    await page.locator('#hud-level-title').click();
    await expectCurrentStageVisibleInMap(72);

    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(85));
    await page.locator('#hud-difficulty-badge').click();
    await expectCurrentStageVisibleInMap(85);

    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(61));
    await page.locator('#btn-hud-title-map').focus();
    await page.keyboard.press('Enter');
    await expectCurrentStageVisibleInMap(61);

    // Restore L85 as Challenge active stage
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(85));
    await page.locator('#btn-hud-title-map').click();
    await expectCurrentStageVisibleInMap(85);

    // 2. Non-All filter resets & auto-scrolls on Map re-entry and on mode tab toggles (including cross-tier content-visibility jumps)
    await page.locator('.chip-filter[data-range="1-50"]').click();
    await expect(page.locator('.level-node-card[data-level-id="85"]')).toHaveCount(0);
    await page.locator('#tab-btn-themes').click();
    await page.locator('#tab-btn-home').click();
    await expectCurrentStageVisibleInMap(85);

    await page.locator('.chip-filter[data-range="51-100"]').click();
    await page.locator('#map-tab-zen').click();
    await expectCurrentStageVisibleInMap(28);
    await page.locator('.chip-filter[data-range="1-50"]').click();
    await page.locator('#map-tab-challenge').click();
    await expectCurrentStageVisibleInMap(85);

    // 3. Save Sync import & Restore Backup from toolbar (#tab-btn-save) sync Hero, reset filter, and scroll Map
    const importedJson = await page.evaluate(() => {
      const s = structuredClone(window.__SHREDBLOCKS_DEBUG__.getSave());
      s.highestLevelUnlocked = 70;
      s.currentLevelId = 64;
      s.modeState.CHALLENGE = { highestUnlocked: 70, currentLevelId: 64 };
      return JSON.stringify(s);
    });
    await page.locator('.chip-filter[data-range="201-250"]').click();
    await page.locator('#tab-btn-save').click();
    await page.locator('#save-code-input').fill(importedJson);
    await page.locator('#btn-preview-import').click();
    await page.locator('#btn-confirm-import').click();
    await page.locator('#btn-save-transfer-close').click();
    await expectCurrentStageVisibleInMap(64);

    await page.locator('.chip-filter[data-range="201-250"]').click();
    await page.locator('#tab-btn-save').click();
    await page.locator('#btn-restore-backup').click();
    await page.locator('#btn-save-transfer-close').click();
    await expectCurrentStageVisibleInMap(85);
  });

  test('VIEWPORT-ZOOM-LOCK-01: blocks accidental pinch-zoom, double-tap zoom, trackpad zoom, and iOS input auto-zoom across Title, Game, Map, Themes, and all Dialogs', async ({
    page,
  }) => {
    await bootWithMultiModeSave(page);

    const checkZoomBlockedOnSelector = async (selector: string) => {
      return page.evaluate((sel) => {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) throw new Error(`Missing target ${sel}`);
        const touchAction = window.getComputedStyle(el).touchAction;

        const gestureStartAllowed = el.dispatchEvent(
          new Event('gesturestart', { bubbles: true, cancelable: true })
        );
        const gestureChangeAllowed = el.dispatchEvent(
          new Event('gesturechange', { bubbles: true, cancelable: true })
        );

        const fakeTouchMove = new Event('touchmove', { bubbles: true, cancelable: true });
        Object.defineProperty(fakeTouchMove, 'touches', { value: [{}, {}] });
        const multiTouchAllowed = el.dispatchEvent(fakeTouchMove);

        const ctrlWheelAllowed = el.dispatchEvent(
          new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -40 })
        );
        const normalWheelAllowed = el.dispatchEvent(
          new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: false, deltaY: 40 })
        );
        const dblClickAllowed = el.dispatchEvent(
          new MouseEvent('dblclick', { bubbles: true, cancelable: true })
        );

        return {
          touchAction,
          gestureStartAllowed,
          gestureChangeAllowed,
          multiTouchAllowed,
          ctrlWheelAllowed,
          normalWheelAllowed,
          dblClickAllowed,
        };
      }, selector);
    };

    // 1. Title Screen (#title-overlay & CTA button — zero `manipulation` or `auto`)
    for (const sel of ['#title-overlay', '#btn-title-play', '#btn-title-settings']) {
      const res = await checkZoomBlockedOnSelector(sel);
      expect(res.touchAction).toBe('none');
      expect(res.gestureStartAllowed).toBe(false);
      expect(res.gestureChangeAllowed).toBe(false);
      expect(res.multiTouchAllowed).toBe(false);
      expect(res.ctrlWheelAllowed).toBe(false);
      expect(res.normalWheelAllowed).toBe(true);
      expect(res.dblClickAllowed).toBe(false);
    }

    // 2. Sanctuary Map (#screen-home: fixed chrome = none, filter strip = pan-x, roadmap list = pan-y)
    await page.locator('#btn-title-map').click();
    await expect(page.locator('#screen-home')).toBeVisible();
    expect((await checkZoomBlockedOnSelector('#btn-play-current')).touchAction).toBe('none');
    expect((await checkZoomBlockedOnSelector('.filter-pills .chip-filter')).touchAction).toBe('pan-x');
    const roadmapRes = await checkZoomBlockedOnSelector('#roadmap-list .level-node-card');
    expect(roadmapRes.touchAction).toBe('pan-y');
    expect(roadmapRes.multiTouchAllowed).toBe(false);
    expect(roadmapRes.ctrlWheelAllowed).toBe(false);

    // 3. Themes Studio (#screen-themes)
    await page.locator('#tab-btn-themes').click();
    await expect(page.locator('#screen-themes')).toBeVisible();
    const themesRes = await checkZoomBlockedOnSelector('.themes-category-tabs .chip-filter');
    expect(themesRes.touchAction).not.toMatch(/auto|manipulation|pinch-zoom/);
    expect((await checkZoomBlockedOnSelector('.theme-category .theme-card')).touchAction).toBe('pan-y');
    expect(themesRes.multiTouchAllowed).toBe(false);

    // 4. Game Screen (#screen-game: HUD, 3D Canvas, Booster Dock all locked to `none`)
    await page.locator('#tab-btn-play').click();
    await expect(page.locator('#screen-game')).toBeVisible();
    for (const sel of [
      '.hud-top-bar',
      '#btn-hud-title-map',
      '#game-canvas',
      '.booster-dock',
      '#btn-booster-undo',
    ]) {
      const res = await checkZoomBlockedOnSelector(sel);
      expect(res.touchAction).toBe('none');
      expect(res.gestureStartAllowed).toBe(false);
      expect(res.multiTouchAllowed).toBe(false);
      expect(res.ctrlWheelAllowed).toBe(false);
    }

    // 5. Top-Layer Dialogs: Settings (#dialog-pause), Save/Load (#dialog-save-transfer), Install (#dialog-install), Victory & Failure
    await page.locator('#btn-pause').click();
    await expect(page.locator('#dialog-pause')).toBeVisible();
    const pauseRes = await checkZoomBlockedOnSelector('#dialog-pause .setting-row');
    expect(pauseRes.touchAction).toBe('pan-y');
    expect(pauseRes.gestureStartAllowed).toBe(false);
    expect(pauseRes.multiTouchAllowed).toBe(false);
    expect(pauseRes.ctrlWheelAllowed).toBe(false);

    await page.locator('#btn-pause-save-transfer').click();
    await expect(page.locator('#dialog-save-transfer')).toBeVisible();
    const saveDialogRes = await checkZoomBlockedOnSelector('#dialog-save-transfer .save-panel');
    expect(saveDialogRes.touchAction).toBe('pan-y');
    expect(saveDialogRes.gestureStartAllowed).toBe(false);
    expect(saveDialogRes.multiTouchAllowed).toBe(false);

    // Editable textarea preserves native word double-click & text selection, and >=16px font on coarse touch devices
    const inputAudit = await page.evaluate(() => {
      const isCoarse = window.matchMedia('(pointer: coarse)').matches;
      const jump = document.getElementById('level-jump-input') as HTMLInputElement;
      const qual = document.getElementById('select-quality-tier') as HTMLSelectElement;
      const codeIn = document.getElementById('save-code-input') as HTMLTextAreaElement;
      const codeOut = document.getElementById('save-code-output') as HTMLTextAreaElement;
      const dblClickInsideTextareaAllowed = codeIn.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, cancelable: true })
      );
      return {
        isCoarse,
        jumpPx: Number.parseFloat(window.getComputedStyle(jump).fontSize),
        qualPx: Number.parseFloat(window.getComputedStyle(qual).fontSize),
        codeInPx: Number.parseFloat(window.getComputedStyle(codeIn).fontSize),
        codeOutPx: Number.parseFloat(window.getComputedStyle(codeOut).fontSize),
        codeUserSelect: window.getComputedStyle(codeIn).userSelect,
        codeAutocorrect: codeIn.getAttribute('autocorrect'),
        dblClickInsideTextareaAllowed,
      };
    });
    expect(inputAudit.codeUserSelect).toBe('text');
    expect(inputAudit.codeAutocorrect).toBe('off');
    expect(inputAudit.dblClickInsideTextareaAllowed).toBe(true);
    if (inputAudit.isCoarse) {
      expect(inputAudit.jumpPx).toBeGreaterThanOrEqual(16);
      expect(inputAudit.qualPx).toBeGreaterThanOrEqual(16);
      expect(inputAudit.codeInPx).toBeGreaterThanOrEqual(16);
      expect(inputAudit.codeOutPx).toBeGreaterThanOrEqual(16);
    }

    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.openModal('install'));
    expect((await checkZoomBlockedOnSelector('#dialog-install .dialog-card')).touchAction).toBe('pan-y');
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.openModal('victory'));
    expect((await checkZoomBlockedOnSelector('#dialog-victory .dialog-card')).touchAction).toBe('pan-y');
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.openModal('failure'));
    expect((await checkZoomBlockedOnSelector('#dialog-failure .dialog-card')).touchAction).toBe('pan-y');
  });

  test('UNDER-PAR-ORACLE-01: celebrates booster-free Under-Par clear on Level 312 (15 / Par 16), grants one-time +50 Coin & Uncommon+ Booster bounty, and stamps ✦ Under Par on Map', async ({
    page,
  }) => {
    await bootWithMultiModeSave(page);

    const playLevel312UnderPar = async () => {
      await page.evaluate(() => {
        const moves: Array<[number, number, number]> = [
          [10, 7, 6],
          [12, 7, 4],
          [3, 6, 6],
          [9, 7, 1],
          [4, 8, 0],
          [5, 7, 1],
          [10, 7, 0],
          [7, 5, 7],
          [11, 5, 7],
          [6, 4, 0],
          [2, 4, 0],
          [1, 0, 3],
          [8, 0, 4],
          [10, 5, 0],
          [12, 0, 4],
        ];
        for (const [id, r, c] of moves) {
          window.__SHREDBLOCKS_DEBUG__.commitMove(id, r, c);
        }
      });
    };

    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(312));
    await playLevel312UnderPar();

    const victoryDialog = page.locator('#dialog-victory');
    await expect(victoryDialog).toBeVisible();
    await expect(victoryDialog).toHaveAttribute('data-under-par', 'true');
    await expect(page.locator('#dialog-victory .victory-dialog-card > #victory-fx-canvas')).toHaveAttribute(
      'data-fx-mode',
      'under-par'
    );
    await expect(page.locator('#victory-title')).toHaveText('✦ Level 312 · Under Par!');
    await expect(page.locator('#victory-moves')).toHaveText('15 / Par 16 (−1)');
    await expect(page.locator('#victory-under-par-banner')).toBeVisible();
    await expect(page.locator('#victory-under-par-banner')).toContainText('SECRET FEAT · ORACLE OUTSMARTED');
    await expect(page.locator('#victory-under-par-banner')).toContainText('Bounty: +50 Coins & +1');
    await expect(page.locator('#victory-coins-breakdown')).toContainText('✦ Oracle Bounty: +50');

    // Replay Level 312 Under Par: Easter Egg UI still celebrates, while stage bounty is NOT farmed a second time
    await page.locator('#btn-victory-replay').click();
    await expect(victoryDialog).toBeHidden();
    await playLevel312UnderPar();

    await expect(victoryDialog).toBeVisible();
    await expect(page.locator('#victory-under-par-banner')).toContainText(
      'Oracle Encore — Stage Bounty Claimed'
    );
    await expect(page.locator('#victory-coins-breakdown')).not.toContainText('Oracle Bounty');

    // Return to Sanctuary Map: Level 312 displays the `✦ Under Par` badge
    await page.locator('#btn-victory-home').click();
    await expect(page.locator('#screen-home')).toBeVisible();
    const card312 = page.locator('.level-node-card[data-level-id="312"]');
    await expect(card312).toBeVisible();
    await expect(card312.locator('.node-flag-badge.flag-under-par')).toHaveText('✦ Under Par');
  });

  test('COSMETICS-DRAWER-01 & STUDIO-PREVIEW-01: swaps owned cosmetics in Settings drawer without faking locked unlocks, and previews locked combos + live 3D shred in Themes Studio', async ({
    page,
  }) => {
    await bootWithMultiModeSave(page);
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(12));
    await expect(page.locator('#screen-game')).toBeVisible();

    // 1. Open Settings (#dialog-pause): verify grouped IA (`Appearance`, `Audio & Haptics`, `Accessibility & Display`, `Save & App`, Diagnostics last)
    await page.locator('#btn-pause').click();
    await expect(page.locator('#dialog-pause')).toBeVisible();
    const pauseIaOrder = await page.evaluate(() => {
      const card = document.querySelector('#dialog-pause .pause-dialog-card');
      const labels = Array.from(document.querySelectorAll('#dialog-pause .pause-section-label')).map((el) =>
        el.textContent?.trim()
      );
      const lastChildId = card?.lastElementChild?.id ?? '';
      return { labels, lastChildId };
    });
    expect(pauseIaOrder).toEqual({
      labels: ['Appearance', 'Audio & Haptics', 'Accessibility & Display', 'Save & App'],
      lastChildId: 'pause-diagnostics-footer',
    });

    const toggleBtn = page.locator('#btn-toggle-cosmetics-drawer');
    const panel = page.locator('#pause-cosmetics-panel');
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#pause-cosmetics-summary')).toContainText('Classic Studs');
    await expect(panel).toBeHidden();

    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.cosmetics-quick-row')).toHaveCount(3);
    await expect(panel.locator('.cosmetic-quick-btn')).toHaveCount(15);

    // 2. Locked item (`gummy_jelly` — not in unlockedSkins) has `aria-disabled="true"` + 🔒 badge and NEVER equips for free
    const lockedSkinBtn = panel.locator(
      'button[data-quick-cosmetic-kind="skin"][data-quick-cosmetic-id="gummy_jelly"]'
    );
    await expect(lockedSkinBtn).toHaveAttribute('aria-disabled', 'true');
    const lockedBox = await lockedSkinBtn.boundingBox();
    expect(lockedBox).not.toBeNull();
    if (lockedBox) {
      await page.mouse.click(lockedBox.x + lockedBox.width / 2, lockedBox.y + lockedBox.height / 2);
    }
    await expect(page.locator('#pause-cosmetics-status')).toContainText('Unlock in Themes Studio');
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getSave().equippedSkin)).toBe(
      'classic_studs'
    );

    // 3. Owned items (`relic_stone`, `warm_birch`, `soap_bubbles`) equip in 1 tap and update live save immediately
    await panel
      .locator('button[data-quick-cosmetic-kind="skin"][data-quick-cosmetic-id="relic_stone"]')
      .click();
    await panel
      .locator('button[data-quick-cosmetic-kind="tray"][data-quick-cosmetic-id="warm_birch"]')
      .click();
    await panel
      .locator('button[data-quick-cosmetic-kind="particle"][data-quick-cosmetic-id="soap_bubbles"]')
      .click();

    const equippedAfterQuickSwap = await page.evaluate(() => {
      const s = window.__SHREDBLOCKS_DEBUG__.getSave();
      return { skin: s.equippedSkin, tray: s.equippedTray, particle: s.equippedParticle };
    });
    expect(equippedAfterQuickSwap).toEqual({
      skin: 'relic_stone',
      tray: 'warm_birch',
      particle: 'soap_bubbles',
    });

    // 4. Direct jump to Themes Studio (`#btn-pause-open-themes`) exposes pinned 3D showcase stage + Back/Resume CTA
    await page.locator('#btn-pause-open-themes').click();
    await expect(page.locator('#dialog-pause')).toBeHidden();
    await expect(page.locator('#screen-themes')).toBeVisible();
    await expect(page.locator('#themes-preview-card')).toBeVisible();
    await expect(page.locator('#btn-themes-resume-game')).toBeVisible();
    await expect(page.locator('#themes-preview-badge')).toHaveText('✦ Equipped Loadout');

    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const baselineShot = (await page.locator('#themes-preview-canvas').screenshot()).toString('base64');

    // 5. Preview a locked Block Skin (`neon_cyber`, 1200c) + locked Board Tray (`frosted_quartz`, 750c) before buying
    await page.locator('button[data-preview-theme-id="neon_cyber"]').click();
    await page.locator('button[data-preview-theme-id="frosted_quartz"]').click();
    await expect(page.locator('#themes-preview-badge')).toContainText('🔒 Preview · 1950 Coins');
    await expect(page.locator('#btn-themes-reset-preview')).toBeVisible();

    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const previewShot = (await page.locator('#themes-preview-canvas').screenshot()).toString('base64');
    expect(previewShot).not.toBe(baselineShot);

    // Scrolling `.themes-scroll` to the bottom keeps `#themes-preview-card` pinned at the top with zero horizontal overflow
    const stickyMetrics = await page.evaluate(() => {
      const scrollEl = document.querySelector<HTMLElement>('#screen-themes .themes-scroll');
      const cardEl = document.getElementById('themes-preview-card');
      if (!scrollEl || !cardEl) return null;
      const topBefore = cardEl.getBoundingClientRect().top;
      scrollEl.scrollTop = scrollEl.scrollHeight;
      const topAfter = cardEl.getBoundingClientRect().top;
      return {
        scrolled: scrollEl.scrollTop > 40,
        pinnedDeltaPx: Math.abs(topAfter - topBefore),
        noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      };
    });
    expect(stickyMetrics).toEqual({ scrolled: true, pinnedDeltaPx: 0, noOverflow: true });

    // 6. Trigger `⚡ Test Shred` 4 times to cycle through all 4 showcase blocks (including celebratory 4th-block clear)
    for (let i = 0; i < 4; i++) {
      await page.locator('#btn-themes-test-shred').click();
    }
    // Reset preview returns cleanly to Equipped Loadout without mutating equipped save items
    await page.locator('#btn-themes-reset-preview').click();
    await expect(page.locator('#themes-preview-badge')).toHaveText('✦ Equipped Loadout');
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getSave().equippedSkin)).toBe(
      'relic_stone'
    );
  });

  test('SESSION-RESUME-01 & STREAK-INTEGRITY-01: preserves mid-level moves, spent Boosters & Flow Streak across Settings -> Themes Studio and Map round-trips while resetting on mode or stage switch', async ({
    page,
  }) => {
    await bootWithMultiModeSave(page);
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(12));
    await expect(page.locator('#screen-game')).toBeVisible();

    // Spend a HAMMER booster on the first active block so the board is genuinely mid-attempt (`isBoardRunStarted === true`)
    const initialSnapshot = await page.evaluate(() => {
      const b = window.__SHREDBLOCKS_DEBUG__.getBoard();
      const target = b.blocks.find((blk) => blk.status === 'ACTIVE');
      if (!target) throw new Error('Expected active block on Level 12');
      return {
        initialActive: b.blocks.filter((blk) => blk.status === 'ACTIVE').length,
        targetRow: target.row,
        targetCol: target.col,
        hammersBefore: window.__SHREDBLOCKS_DEBUG__.getSave().boosters.HAMMER,
        streakBefore: window.__SHREDBLOCKS_DEBUG__.getSave().winStreak,
      };
    });

    await page.locator('#btn-booster-hammer').click();
    const targetPt = await page.evaluate(
      ({ r, c }) => window.__SHREDBLOCKS_DEBUG__.boardToScreen(c + 0.5, r + 0.5),
      { r: initialSnapshot.targetRow, c: initialSnapshot.targetCol }
    );
    await page.mouse.click(targetPt.x, targetPt.y);

    const midRunCounts = await page.evaluate(() => {
      const b = window.__SHREDBLOCKS_DEBUG__.getBoard();
      const s = window.__SHREDBLOCKS_DEBUG__.getSave();
      return {
        activeBlocks: b.blocks.filter((blk) => blk.status === 'ACTIVE').length,
        shredded: b.sessionBlocksShredded,
        hammers: s.boosters.HAMMER,
        streak: s.winStreak,
      };
    });
    expect(midRunCounts.activeBlocks).toBe(initialSnapshot.initialActive - 1);
    expect(midRunCounts.shredded).toBe(1);
    expect(midRunCounts.hammers).toBe(initialSnapshot.hammersBefore - 1);
    expect(midRunCounts.streak).toBe(2);

    // 1. Mid-game Settings -> Themes Studio -> preview locked skin -> `▶ Resume Lvl 12` preserves exact board & blocks locked leak
    await page.locator('#btn-pause').click();
    await page.locator('#btn-toggle-cosmetics-drawer').click();
    await page.locator('#btn-pause-open-themes').click();
    await expect(page.locator('#screen-themes')).toBeVisible();
    await expect(page.locator('#btn-themes-resume-game')).toHaveText('▶ Resume Lvl 12');
    await page.locator('button[data-preview-theme-id="gummy_jelly"]').click();
    await page.locator('#btn-themes-resume-game').click();

    await expect(page.locator('#screen-game')).toBeVisible();
    const afterThemesResume = await page.evaluate(() => {
      const b = window.__SHREDBLOCKS_DEBUG__.getBoard();
      const s = window.__SHREDBLOCKS_DEBUG__.getSave();
      return {
        levelId: b.levelId,
        activeBlocks: b.blocks.filter((blk) => blk.status === 'ACTIVE').length,
        shredded: b.sessionBlocksShredded,
        equippedSkin: s.equippedSkin,
        streak: s.winStreak,
      };
    });
    expect(afterThemesResume).toEqual({
      levelId: 12,
      activeBlocks: initialSnapshot.initialActive - 1,
      shredded: 1,
      equippedSkin: 'classic_studs',
      streak: 2,
    });

    // 2. Exit to Sanctuary Map (`‹ Map`) -> Hero & Tab show `Resume`, `winStreak` stays 2, and clicking Hero resumes exact board
    await page.locator('#btn-hud-home').click();
    await expect(page.locator('#screen-home')).toBeVisible();
    await expect(page.locator('#btn-play-current')).toContainText('RESUME LEVEL 12');
    await expect(page.locator('#tab-play-label')).toHaveText('Resume Lvl 12');
    await expect(page.locator('.level-node-card.current-level[data-level-id="12"]')).toContainText(
      'Resume ›'
    );
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getSave().winStreak)).toBe(2);

    await page.locator('#btn-play-current').click();
    await expect(page.locator('#screen-game')).toBeVisible();
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().sessionBlocksShredded)).toBe(1);

    // 3. Picking a DIFFERENT stage on Map (Level 11) cleanly loads Move 0 instead of stale Level 12 state
    await page.locator('#btn-hud-home').click();
    await page.locator('.level-node-card[data-level-id="11"]').click();
    await expect(page.locator('#hud-level-title')).toContainText('Level 11');
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().sessionBlocksShredded)).toBe(0);
  });

  test('VIEWPORT-MATRIX-01 & SETTINGS-IA-01: keeps grouped Settings & expanded Cosmetics card unclipped and scrollable across 8 target viewports (320x568 to 1440x900 + short landscape)', async ({
    page,
  }) => {
    await bootWithMultiModeSave(page);
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(12));
    await expect(page.locator('#screen-game')).toBeVisible();

    const viewports = [
      { label: 'ultra-compact-320x568', width: 320, height: 568 },
      { label: 'compact-mobile-360x640', width: 360, height: 640 },
      { label: 'flagship-mobile-390x844', width: 390, height: 844 },
      { label: 'split-midwidth-480x800', width: 480, height: 800 },
      { label: 'short-landscape-667x375', width: 667, height: 375 },
      { label: 'flagship-landscape-844x390', width: 844, height: 390 },
      { label: 'tablet-portrait-768x1024', width: 768, height: 1024 },
      { label: 'desktop-widescreen-1440x900', width: 1440, height: 900 },
    ];

    await page.locator('#btn-pause').click();
    await expect(page.locator('#dialog-pause')).toBeVisible();

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

      for (const expanded of [false, true]) {
        const curExpanded = await page.locator('#btn-toggle-cosmetics-drawer').getAttribute('aria-expanded');
        if ((curExpanded === 'true') !== expanded) {
          await page.locator('#btn-toggle-cosmetics-drawer').click();
        }

        const metrics = await page.evaluate(() => {
          const card = document.querySelector<HTMLElement>('#dialog-pause .pause-dialog-card');
          const closeBtn = document.getElementById('btn-pause-close');
          const footer = document.getElementById('pause-diagnostics-footer');
          if (!card || !closeBtn || !footer) return null;

          card.scrollTop = 0;
          const cardRect = card.getBoundingClientRect();
          const closeRect = closeBtn.getBoundingClientRect();
          const topVisible = closeRect.top >= cardRect.top - 1 && closeRect.bottom <= cardRect.bottom + 1;

          // Check every visible button, swatch, select, and setting label inside the card
          const selectors = [
            '#btn-pause-resume',
            '#btn-pause-home',
            '#btn-pause-restart',
            '#btn-toggle-cosmetics-drawer',
            '#select-quality-tier',
            '#btn-pause-save-transfer',
            '#btn-pause-install',
            '.setting-row',
            '.cosmetic-quick-btn',
          ];
          let outOfBoundsSelector: string | null = null;
          for (const sel of selectors) {
            const nodes = card.querySelectorAll<HTMLElement>(sel);
            for (const node of nodes) {
              if (node.closest('[hidden]')) continue;
              const r = node.getBoundingClientRect();
              if (r.width < 16 || r.left < cardRect.left - 1.5 || r.right > cardRect.right + 1.5) {
                outOfBoundsSelector = `${sel} (${Math.round(r.left)}..${Math.round(r.right)} vs ${Math.round(cardRect.left)}..${Math.round(cardRect.right)})`;
                break;
              }
            }
            if (outOfBoundsSelector) break;
          }

          let truncatedLabel: string | null = null;
          for (const span of card.querySelectorAll<HTMLElement>('.setting-row > span')) {
            if (span.scrollWidth > span.clientWidth + 1) {
              truncatedLabel = `${span.textContent} (${span.scrollWidth} > ${span.clientWidth})`;
              break;
            }
          }

          card.scrollTop = card.scrollHeight;
          const footerRect = footer.getBoundingClientRect();
          const bottomReachable =
            footerRect.top >= cardRect.top - 1 && footerRect.bottom <= cardRect.bottom + 2;
          card.scrollTop = 0;

          return {
            docNoOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
            cardNoOverflow: card.scrollWidth <= card.clientWidth + 1,
            cardFitsViewport:
              cardRect.top >= -0.5 &&
              cardRect.bottom <= window.innerHeight + 1 &&
              cardRect.left >= -0.5 &&
              cardRect.right <= window.innerWidth + 1,
            topVisible,
            bottomReachable,
            outOfBoundsSelector,
            truncatedLabel,
          };
        });

        expect(metrics, `${vp.label} (expanded=${expanded})`).toEqual({
          docNoOverflow: true,
          cardNoOverflow: true,
          cardFitsViewport: true,
          topVisible: true,
          bottomReachable: true,
          outOfBoundsSelector: null,
          truncatedLabel: null,
        });
      }
    }
  });

  test('PWA-UPDATE-01 & VIEWPORT-MATRIX-01: global update banner mounts flush below top header outside folder tabs and fits 320x568 & 667x375 without vertical overflow', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const save = {
        schemaVersion: 1,
        appId: 'shredblocks-color-jam',
        writeSeq: 12,
        updatedAt: Date.now() + 30_000,
        highestLevelUnlocked: 14,
        currentLevelId: 14,
        coins: 450,
        settings: { sfxEnabled: false, musicEnabled: false, hapticsEnabled: false },
      };
      window.localStorage.setItem('shredblocks.save.v1', JSON.stringify(save));
    });
    const checkBannerSlot = (sid: 'screen-home' | 'screen-themes', nid: string) =>
      page.evaluate(
        ([s, nId]) => {
          const toast = document.getElementById('pwa-update-toast');
          const header = document.querySelector<HTMLElement>(`#${s} > .top-economy-bar`);
          const next = document.getElementById(nId);
          if (!toast || !header || !next) return null;
          const [t, h, n] = [toast, header, next].map((el) => el.getBoundingClientRect());
          return {
            parentId: toast.parentElement?.id ?? '',
            insideTabPanel: Boolean(document.getElementById('map-mode-panel')?.contains(toast)),
            belowHeader: t.top >= h.bottom - 1,
            aboveNext: t.bottom <= n.top + 1,
            widthDeltaPx: Math.abs(Math.round(t.width - h.width)),
          };
        },
        [sid, nid] as const
      );

    await page.goto('/');
    await expect(page.locator('#title-overlay')).toBeVisible();
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.setPwaUpdateBannerVisible(true));
    await expect(page.locator('#pwa-update-toast')).toBeVisible();

    const slotOk = { insideTabPanel: false, belowHeader: true, aboveNext: true, widthDeltaPx: 0 };
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('home'));
    await expect(page.locator('#screen-home')).toBeVisible();
    await expect(page.locator('#pwa-update-toast')).toBeVisible();
    expect(await checkBannerSlot('screen-home', 'map-mode-tabs')).toEqual({
      parentId: 'screen-home',
      ...slotOk,
    });

    await page.locator('#map-tab-zen').click();
    await page.locator('#map-tab-timed').click();
    await page.locator('#tab-btn-themes').click();
    await expect(page.locator('#screen-themes')).toBeVisible();
    await expect(page.locator('#pwa-update-toast')).toBeVisible();
    expect(await checkBannerSlot('screen-themes', 'themes-preview-card')).toEqual({
      parentId: 'screen-themes',
      ...slotOk,
    });

    await page.locator('#tab-btn-home').click();
    await expect(page.locator('#screen-home')).toBeVisible();

    for (const vp of [
      { label: '320x568', width: 320, height: 568 },
      { label: '667x375-landscape', width: 667, height: 375 },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const homeAudit = await page.evaluate(() => {
        const toast = document.getElementById('pwa-update-toast');
        const label = toast?.querySelector<HTMLElement>('.pwa-update-label');
        const list = document.getElementById('roadmap-list');
        return {
          hOverflow: document.documentElement.scrollWidth - window.innerWidth,
          vOverflow: document.documentElement.scrollHeight - window.innerHeight,
          toastVisible: Boolean(toast && !toast.hidden),
          labelUntruncated: Boolean(label && label.scrollWidth <= label.clientWidth + 1),
          roadmapHeight: list?.clientHeight ?? 0,
        };
      });
      expect(
        homeAudit.hOverflow <= 0 &&
          homeAudit.vOverflow <= 1 &&
          homeAudit.toastVisible &&
          homeAudit.labelUntruncated,
        `${vp.label} home layout: ${JSON.stringify(homeAudit)}`
      ).toBe(true);
      expect(homeAudit.roadmapHeight, `${vp.label} home roadmapHeight`).toBeGreaterThanOrEqual(80);

      await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.openTitleScreen());
      await expect(page.locator('#title-overlay')).toBeVisible();
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const titleAudit = await page.evaluate(() => {
        const inView = (el: Element | null) => {
          const r = el?.getBoundingClientRect();
          return Boolean(r && r.top >= -1 && r.bottom <= window.innerHeight + 1);
        };
        return {
          hOverflow: document.documentElement.scrollWidth - window.innerWidth,
          vOverflow: document.documentElement.scrollHeight - window.innerHeight,
          cardOk: inView(document.querySelector('.title-crest-card')),
          toastOk: inView(document.getElementById('pwa-update-toast')),
        };
      });
      expect(titleAudit, `${vp.label} title`).toEqual({
        hOverflow: 0,
        vOverflow: 0,
        cardOk: true,
        toastOk: true,
      });
      await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('home'));
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.openTitleScreen());
    const beforePlayCanvas = await page.locator('#game-canvas').evaluate((el) => el.getBoundingClientRect());
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('game', false));
    await expect(page.locator('#pwa-update-toast')).toBeHidden();
    const afterPlayCanvas = await page.locator('#game-canvas').evaluate((el) => el.getBoundingClientRect());
    expect(Math.abs(beforePlayCanvas.top - afterPlayCanvas.top)).toBeLessThanOrEqual(0.5);
  });
});
