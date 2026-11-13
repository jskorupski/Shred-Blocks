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
});
