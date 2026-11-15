import { expect, type Page, test } from '@playwright/test';

async function bootWithSave(page: Page, levelId = 12): Promise<void> {
  const seededSave = {
    schemaVersion: 1,
    appId: 'shredblocks-color-jam',
    writeSeq: 8,
    updatedAt: 1_760_000_000_000,
    highestLevelUnlocked: 40,
    currentLevelId: levelId,
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

test.describe('Mode Ambience & Simplified Settings Modal (MODE-AMBIENCE-01)', () => {
  test('renames Settings modal cleanly and removes duplicate Play Mode select', async ({ page }) => {
    await bootWithSave(page, 12);
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('game'));

    const pauseBtn = page.locator('#btn-pause');
    await expect(pauseBtn).toHaveAttribute('aria-label', 'Settings');
    await pauseBtn.click();

    await expect(page.locator('#dialog-pause')).toBeVisible();
    await expect(page.locator('#pause-title')).toHaveText('Settings');
    await expect(page.locator('#btn-pause-close')).toHaveAttribute('aria-label', 'Close Settings');
    await expect(page.locator('#dialog-pause #select-play-mode')).toHaveCount(0);
  });

  test('keeps Title Screen pure and transitions ambient astrolabe & rim framing across modes', async ({
    page,
  }) => {
    await bootWithSave(page, 12);

    const titleState = await page.evaluate(() => {
      const shell = document.getElementById('app-shell');
      const backdrop = document.querySelector('.mode-ambience-backdrop');
      return {
        titleOpen: shell?.getAttribute('data-title-open'),
        backdropOpacity: backdrop ? window.getComputedStyle(backdrop).opacity : '',
      };
    });
    expect(titleState.titleOpen).toBe('true');
    expect(titleState.backdropOpacity).toBe('0');

    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('game'));

    const readModeVisualState = async () =>
      page.evaluate(() => {
        const q = (s: string) => document.querySelector(s);
        const bg = (s: string) => {
          const e = q(s);
          return e ? getComputedStyle(e).backgroundImage : '';
        };
        const op = (s: string) => {
          const e = q(s);
          return e ? getComputedStyle(e).opacity : '';
        };
        const attrGlyph = (s: string) => q(s)?.getAttribute('data-mode-glyph') ?? null;
        const shell = q('#app-shell');
        return {
          playMode: shell?.getAttribute('data-play-mode'),
          bodyPlayMode: document.body.getAttribute('data-play-mode'),
          titleOpen: shell?.getAttribute('data-title-open'),
          activeScreen: shell?.getAttribute('data-active-screen'),
          backdropOpacity: op('.mode-ambience-backdrop'),
          ornamentColor: (() => {
            const e = q('#screen-game .sacred-geometry-ornament');
            return e ? getComputedStyle(e).color : '';
          })(),
          hudBg: bg('#screen-game .hud-top-bar'),
          dockBg: bg('#screen-game .booster-dock'),
          titlePlayBg: bg('#btn-title-play'),
          titlePlayText: q('#btn-title-play')?.textContent ?? '',
          titlePlayMode: attrGlyph('#btn-title-play .btn-mode-emblem'),
          mapPlayBg: bg('#btn-play-current'),
          mapPlayText: q('#btn-play-current')?.textContent ?? '',
          mapPlayMode: attrGlyph('#btn-play-current .btn-mode-emblem'),
          navPlayBg: bg('#tab-btn-play'),
          navPlayMode: attrGlyph('#tab-play-mode-icon'),
          navPlaySvg: Boolean(q('#tab-play-mode-icon svg.mode-svg-icon')),
          pauseResumeBg: bg('#btn-pause-resume'),
          pauseResumeText: q('#btn-pause-resume')?.textContent ?? '',
          pauseResumeMode: attrGlyph('#btn-pause-resume .btn-mode-emblem'),
          canvasFilter: (() => {
            const e = q('#game-canvas');
            return e ? getComputedStyle(e).filter : '';
          })(),
          layerOpacity: {
            challenge: op('.ambience-challenge'),
            zen: op('.ambience-zen'),
            timed: op('.ambience-timed'),
          },
        };
      });

    const assertModeCtas = (
      state: Awaited<ReturnType<typeof readModeVisualState>>,
      mode: 'CHALLENGE' | 'ZEN' | 'TIMED'
    ) => {
      expect(state.playMode).toBe(mode);
      expect(state.bodyPlayMode).toBe(mode);
      expect(state.canvasFilter).toBe('none');
      expect(state.titlePlayText).toContain('▶ CONTINUE');
      expect(state.titlePlayMode).toBe(mode);
      expect(state.mapPlayText).toContain('▶ PLAY');
      expect(state.mapPlayMode).toBe(mode);
      expect(state.navPlayMode).toBe(mode);
      expect(state.navPlaySvg).toBe(true);
      expect(state.pauseResumeText).toBe('▶ Resume');
      expect(state.pauseResumeMode).toBe(mode);
    };

    const challengeState = await readModeVisualState();
    assertModeCtas(challengeState, 'CHALLENGE');
    expect(challengeState.titleOpen).toBe('false');
    expect(challengeState.activeScreen).toBe('game');
    expect(challengeState.backdropOpacity).toBe('1');
    expect(challengeState.layerOpacity).toEqual({ challenge: '1', zen: '0', timed: '0' });
    expect(challengeState.mapPlayBg).toBe(challengeState.navPlayBg);
    expect(challengeState.pauseResumeBg).toBe(challengeState.navPlayBg);

    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.setPlayMode('ZEN'));
    const zenState = await readModeVisualState();
    assertModeCtas(zenState, 'ZEN');
    expect(zenState.layerOpacity).toEqual({ challenge: '0', zen: '1', timed: '0' });
    expect(zenState.ornamentColor).not.toBe(challengeState.ornamentColor);
    expect(zenState.hudBg).not.toBe(challengeState.hudBg);
    expect(zenState.dockBg).not.toBe(challengeState.dockBg);
    expect(zenState.navPlayBg).not.toBe(challengeState.navPlayBg);

    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.setPlayMode('TIMED'));
    const timedState = await readModeVisualState();
    assertModeCtas(timedState, 'TIMED');
    expect(timedState.layerOpacity).toEqual({ challenge: '0', zen: '0', timed: '1' });
    expect(timedState.ornamentColor).not.toBe(zenState.ornamentColor);
    expect(timedState.ornamentColor).not.toBe(challengeState.ornamentColor);
    expect(timedState.hudBg).not.toBe(zenState.hudBg);
    expect(timedState.hudBg).not.toBe(challengeState.hudBg);
    expect(timedState.navPlayBg).not.toBe(zenState.navPlayBg);
    expect(timedState.navPlayBg).not.toBe(challengeState.navPlayBg);

    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.setHighContrast(true));
    const hcBackdropOpacity = await page.evaluate(() => {
      const backdrop = document.querySelector('.mode-ambience-backdrop');
      return backdrop ? window.getComputedStyle(backdrop).opacity : '';
    });
    expect(hcBackdropOpacity).toBe('0');

    // Sanctuary Map whispers active mode at 0.28 opacity when High Contrast is off
    await page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setHighContrast(false);
      window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('home');
    });
    const mapWhisperOpacity = await page.evaluate(() => {
      const backdrop = document.querySelector('.mode-ambience-backdrop');
      return backdrop ? window.getComputedStyle(backdrop).opacity : '';
    });
    expect(Number(mapWhisperOpacity)).toBeCloseTo(0.28, 2);
  });

  test('renders distinct 5 Shred Animations, upward soap_bubbles, gate plasma arcs, and Reduced-Motion Gate Seals', async ({
    page,
  }) => {
    await bootWithSave(page, 1);
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('themes'));

    const swatchBackgrounds = await page.evaluate(() => {
      const ids = ['micro_cubes', 'star_confetti', 'pixel_sparks', 'soap_bubbles', 'lightning_bolts'];
      return ids.map((id) => {
        const el = document.querySelector(`.swatch-${id}`);
        return el ? window.getComputedStyle(el).backgroundImage : '';
      });
    });
    expect(new Set(swatchBackgrounds).size).toBe(5);

    // 1. Live WebGL2 upward buoyancy for soap_bubbles vs plasma arcs for lightning_bolts
    const bubbleVsBolt = await page.evaluate(() => {
      const dbg = window.__SHREDBLOCKS_DEBUG__;
      dbg.setFxRandomSeed(42);
      dbg.setReducedMotion(false);
      dbg.setTheme('classic_studs', 'industrial_slate', 'soap_bubbles');
      dbg.loadLevel(1);
      dbg.freezeTime(1.0);
      const b1 = dbg.getBoard().blocks[0];
      dbg.commitMove(b1.id, 0, b1.col); // Shred into top gate on Level 1
      dbg.advanceFrozenFrames(2);
      const zStart = dbg.getParticleTelemetry().meanParticleZ;
      dbg.advanceFrozenFrames(24);
      const zAfter = dbg.getParticleTelemetry().meanParticleZ;

      dbg.setTheme('classic_studs', 'industrial_slate', 'lightning_bolts');
      dbg.loadLevel(1);
      dbg.freezeTime(2.0);
      const b2 = dbg.getBoard().blocks[0];
      dbg.commitMove(b2.id, 0, b2.col);
      dbg.advanceFrozenFrames(2);
      const boltTelemetry = dbg.getParticleTelemetry();

      // 2. Reduced Motion: 0 flying particles + stationary REDUCED_MOTION_SEAL
      dbg.setReducedMotion(true);
      dbg.setTheme('classic_studs', 'industrial_slate', 'star_confetti');
      dbg.loadLevel(1);
      dbg.freezeTime(3.0);
      const b3 = dbg.getBoard().blocks[0];
      dbg.commitMove(b3.id, 0, b3.col);
      dbg.advanceFrozenFrames(2);
      const rmTelemetry = dbg.getParticleTelemetry();

      // 3. FX State Management: 0 particles during idle + non-shredding move; immediate clear on Restart & Screen Switch
      dbg.setReducedMotion(false);
      dbg.setTheme('classic_studs', 'industrial_slate', 'pixel_sparks');
      dbg.loadLevel(1);
      dbg.freezeTime(4.0);
      dbg.advanceFrozenFrames(90); // 1.5s idle
      const idleP = dbg.getTelemetry().activeParticles;
      const nonShredBlock = dbg.getBoard().blocks.find((b) => b.col === 3 && b.row === 2);
      if (nonShredBlock) dbg.commitMove(nonShredBlock.id, 1, 3);
      dbg.advanceFrozenFrames(6);
      const slideP = dbg.getTelemetry().activeParticles;
      const shredBlk = dbg.getBoard().blocks[0];
      dbg.commitMove(shredBlk.id, 0, shredBlk.col);
      dbg.advanceFrozenFrames(2);
      const shredP = dbg.getTelemetry().activeParticles;
      (document.getElementById('btn-restart') as HTMLButtonElement | null)?.click();
      dbg.advanceFrozenFrames(1);
      const restartP = dbg.getTelemetry().activeParticles;
      dbg.freezeTime(null);
      dbg.setFxRandomSeed(null);
      return { zStart, zAfter, boltTelemetry, rmTelemetry, idleP, slideP, shredP, restartP };
    });

    expect(bubbleVsBolt.zAfter).toBeGreaterThan(bubbleVsBolt.zStart + 0.35);
    expect(bubbleVsBolt.boltTelemetry.activeParticles).toBeGreaterThan(10);
    expect(bubbleVsBolt.boltTelemetry.gateBurstModes).toContain('PLASMA_ARCS:lightning_bolts');
    expect(bubbleVsBolt.rmTelemetry.activeParticles).toBe(0);
    expect(bubbleVsBolt.rmTelemetry.gateBurstModes).toContain('REDUCED_MOTION_SEAL:star_confetti');
    expect(bubbleVsBolt.idleP).toBe(0);
    expect(bubbleVsBolt.slideP).toBe(0);
    expect(bubbleVsBolt.shredP).toBeGreaterThan(12);
    expect(bubbleVsBolt.restartP).toBe(0);
  });

  test('MAP-MODE-SPLIT-01 & ZEN-STARS-01: Connected Folder-Tab WAI-ARIA navigation, independent ladders, global booster unlocks, Zen-only skips, Zen Stars, and free Zen Blessing continues', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__SHREDBLOCKS_DEBUG__));
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('home'));
    await expect(page.locator('#screen-home')).toBeVisible();

    // 1. WAI-ARIA tablist + connected folder-tab geometry + zero horizontal overflow at 360x640
    const tabGeometry = await page.evaluate(() => {
      const tablist = document.getElementById('map-mode-tabs');
      const activeTab = document.getElementById('map-tab-challenge');
      const zenTab = document.getElementById('map-tab-zen');
      const panel = document.getElementById('map-mode-panel');
      if (!tablist || !activeTab || !zenTab || !panel) return null;
      const tr = activeTab.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      return {
        tablistRole: tablist.getAttribute('role'),
        tablistLabel: tablist.getAttribute('aria-label'),
        panelRole: panel.getAttribute('role'),
        panelLabelledBy: panel.getAttribute('aria-labelledby'),
        activeSelected: activeTab.getAttribute('aria-selected'),
        activeTabIndex: activeTab.tabIndex,
        zenSelected: zenTab.getAttribute('aria-selected'),
        zenTabIndex: zenTab.tabIndex,
        seamDeltaPx: Math.abs(tr.bottom - pr.top),
        noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      };
    });
    expect(tabGeometry?.tablistRole).toBe('tablist');
    expect(tabGeometry?.tablistLabel).toBe('Game Modes');
    expect(tabGeometry?.panelRole).toBe('tabpanel');
    expect(tabGeometry?.panelLabelledBy).toBe('map-tab-challenge');
    expect(tabGeometry?.activeSelected).toBe('true');
    expect(tabGeometry?.activeTabIndex).toBe(0);
    expect(tabGeometry?.zenSelected).toBe('false');
    expect(tabGeometry?.zenTabIndex).toBe(-1);
    expect(tabGeometry?.seamDeltaPx).toBeLessThanOrEqual(3);
    expect(tabGeometry?.noOverflow).toBe(true);
    await page.locator('#map-tab-challenge').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#map-tab-zen')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#map-mode-panel')).toHaveAttribute('aria-labelledby', 'map-tab-zen');
    await expect(page.locator('#map-mode-panel')).toHaveAttribute('data-play-mode', 'ZEN');
    await page.keyboard.press('End');
    await expect(page.locator('#map-tab-timed')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(page.locator('#map-tab-challenge')).toHaveAttribute('aria-selected', 'true');
    await page.locator('#map-tab-zen').click();
    await page.locator('#btn-play-current').click();
    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('#btn-skip-hud')).toBeVisible();
    for (let lvl = 1; lvl <= 4; lvl++) {
      await page.evaluate((id) => {
        window.__SHREDBLOCKS_DEBUG__.loadLevel(id);
        window.__SHREDBLOCKS_DEBUG__.autoSolveCurrentLevel();
      }, lvl);
      await expect(page.locator('#dialog-victory')).toBeVisible();
      if (lvl === 3) await expect(page.locator('#victory-stars')).toContainText('+1 Gold Star Earned');
      await page.locator('#btn-next-level').click();
    }
    for (let s = 0; s < 3; s++) await page.locator('#btn-skip-hud').click();
    await expect(page.locator('#hud-level-title')).toContainText('Level 8');
    await expect(page.locator('#btn-skip-hud')).toHaveAttribute('aria-disabled', 'true');
    await page.locator('#btn-skip-hud').click({ force: true });
    await expect(page.locator('#hud-level-title')).toContainText('Level 8');
    await expect(page.locator('#game-toast')).toContainText('max 3 skipped in a row');
    await page.locator('#btn-hud-home').click();
    await expect(page.locator('#map-tab-lvl-zen')).toHaveText('Lvl 8');
    await expect(page.locator('#map-tab-lvl-challenge')).toHaveText('Lvl 1');
    await expect(page.locator('#map-tab-lvl-timed')).toHaveText('Lvl 1');
    await expect(page.locator('#stat-stars')).toHaveText('1');
    await expect(page.locator('#zen-progress-text')).toContainText('1/3');
    await page.locator('#map-tab-challenge').click();
    await expect(page.locator('#btn-play-current')).toContainText('PLAY LEVEL 1');
    await page.locator('#btn-play-current').click();
    await expect(page.locator('#hud-level-title')).toContainText('Level 1');
    await expect(page.locator('#btn-skip-hud')).toBeHidden();
    await expect(page.locator('#btn-booster-hammer')).toHaveClass(/locked-booster/);

    // Complete 3 more genuine Zen clears (stages 5, 6, 7 -> 7 total unique clears -> effective unlock Lvl 8!)
    await page.evaluate(() => {
      const dbg = window.__SHREDBLOCKS_DEBUG__;
      dbg.setPlayMode('ZEN');
      for (const id of [5, 6, 7]) {
        dbg.loadLevel(id);
        dbg.autoSolveCurrentLevel();
      }
      dbg.closeAllModals();
      dbg.loadLevel(8); // Restore Zen frontier bookmark at Lvl 8
      dbg.setPlayMode('CHALLENGE');
    });
    await expect(page.locator('#hud-level-title')).toContainText('Level 1');
    await expect(page.locator('#btn-booster-hammer')).not.toHaveClass(/locked-booster/);

    await page.locator('#btn-pause').click();
    await expect(page.locator('#dialog-pause .pause-nav-section')).toBeVisible();
    await expect(page.locator('#btn-pause-skip')).toBeHidden();
    await page.locator('#btn-pause-close').click();

    // 4. Trigger OUT_OF_MOVES in Challenge Mode and spend the banked 🌿 Zen Blessing for a FREE +5 Moves Continue!
    const coinsBeforeBlessing = await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getSave().coins);
    await page.evaluate(() => {
      const dbg = window.__SHREDBLOCKS_DEBUG__;
      const b = dbg.getBoard();
      b.movesRemaining = 1;
      const b2 = b.blocks.find((blk) => blk.col === 3 && blk.row === 2);
      if (b2) {
        dbg.commitMove(b2.id, 1, 3);
        dbg.commitMove(b2.id, 1, 4);
      }
    });
    await expect(page.locator('#dialog-failure')).toBeVisible();
    await expect(page.locator('#btn-use-zen-blessing')).toBeVisible();
    await expect(page.locator('#btn-use-zen-blessing')).toContainText('Free · 1/3');

    await page.locator('#btn-use-zen-blessing').click();
    await expect(page.locator('#dialog-failure')).toBeHidden();
    await expect(page.locator('#hud-moves-value')).toHaveText('5');

    const postBlessingState = await page.evaluate(() => {
      const s = window.__SHREDBLOCKS_DEBUG__.getSave();
      return {
        coins: s.coins,
        zenBlessings: s.zenBlessings,
        continuesUsed: window.__SHREDBLOCKS_DEBUG__.getBoard().continuesUsed,
      };
    });
    expect(postBlessingState.coins).toBe(coinsBeforeBlessing);
    expect(postBlessingState.zenBlessings).toBe(0);
    expect(postBlessingState.continuesUsed).toBe(1);

    // 5. MODE-ISOLATION-01: Mid-board HUD switch to Zen clean-resets Lvl 1 to Move 0 AND preserves Zen's Lvl 8 frontier bookmark!
    await page.locator('#btn-mode-toggle').click();
    await expect(page.locator('#hud-level-title')).toContainText('Level 1');
    const cleanResetZen = await page.evaluate(() => ({
      levelId: window.__SHREDBLOCKS_DEBUG__.getBoard().levelId,
      bombsInert: window.__SHREDBLOCKS_DEBUG__.getBoard().bombsInert,
      movesCommitted: window.__SHREDBLOCKS_DEBUG__.getBoard().movesCommitted,
      continuesUsed: window.__SHREDBLOCKS_DEBUG__.getBoard().continuesUsed ?? 0,
      zenBookmark: window.__SHREDBLOCKS_DEBUG__.getSave().modeState.ZEN.currentLevelId,
    }));
    expect(cleanResetZen.levelId).toBe(1);
    expect(cleanResetZen.bombsInert).toBe(true);
    expect(cleanResetZen.movesCommitted).toBe(0);
    expect(cleanResetZen.continuesUsed).toBe(0);
    expect(cleanResetZen.zenBookmark).toBe(8);
  });

  test('MODE-ISOLATION-01 & STREAK-INTEGRITY-01: blocks Restart+Switch+Undo smuggling, frontier collisions, Hint smuggling, Speed Rush undo clock-freeze, active drag leaks, off-game Settings nav, and Flow Streak bailouts', async ({
    page,
  }) => {
    await bootWithSave(page, 12);

    // 1. Settings modal opened from Title / Map hides in-game .pause-nav-section
    await page.locator('#btn-title-settings').click();
    await expect(page.locator('#dialog-pause')).toBeVisible();
    await expect(page.locator('#dialog-pause .pause-nav-section')).toBeHidden();
    await page.locator('#btn-pause-close').click();

    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('game'));
    await expect(page.locator('#hud-level-title')).toContainText('Level 12');

    // 2. Restart -> Mode Switch -> Undo cross-mode snapshot smuggling is blocked (MODE-ISOLATION-01)
    await page.evaluate(() => {
      const dbg = window.__SHREDBLOCKS_DEBUG__;
      dbg.loadLevel(1);
      const b2 = dbg.getBoard().blocks.find((blk) => blk.col === 3 && blk.row === 2);
      if (b2) dbg.commitMove(b2.id, 1, 3);
    });
    await page.locator('#btn-restart').click(); // Creates preRestartSnapshot in Challenge
    await page.locator('#btn-mode-prev').click(); // Switch Challenge -> Timed (wipes preRestartSnapshot!)
    await page.locator('#btn-booster-undo').click(); // Attempt to smuggle Challenge snapshot into Timed
    const afterSmuggleAttempt = await page.evaluate(() => ({
      movesCommitted: window.__SHREDBLOCKS_DEBUG__.getBoard().movesCommitted,
      toast: document.getElementById('game-toast')?.textContent ?? '',
    }));
    expect(afterSmuggleAttempt.movesCommitted).toBe(0);
    expect(afterSmuggleAttempt.toast).toContain('No moves to undo');

    // 3. TIMED Move 1 + Undo back to Move 0 keeps Speed Rush clock running (UNDO-RES-01)
    const timedUndoClock = await page.evaluate(() => {
      const dbg = window.__SHREDBLOCKS_DEBUG__;
      dbg.setPlayMode('TIMED');
      dbg.loadLevel(1);
      dbg.freezeTime(10.0);
      const b2 = dbg.getBoard().blocks.find((blk) => blk.col === 3 && blk.row === 2);
      if (b2) dbg.commitMove(b2.id, 1, 3);
      dbg.advanceFrozenFrames(60); // 1.0s elapsed
      const tBeforeUndo = dbg.getBoard().timeRemainingSec;
      dbg.activateBooster('UNDO'); // Undo Move 1 back to Move 0
      const runningAtMove0 = dbg.getBoard().timerRunning;
      dbg.advanceFrozenFrames(60); // Another 1.0s must STILL tick!
      const tAfterMoreTime = dbg.getBoard().timeRemainingSec;
      dbg.freezeTime(null);
      return {
        movesCommitted: dbg.getBoard().movesCommitted,
        runningAtMove0,
        tBeforeUndo,
        tAfterMoreTime,
      };
    });
    expect(timedUndoClock.movesCommitted).toBe(0);
    expect(timedUndoClock.runningAtMove0).toBe(true);
    expect(timedUndoClock.tAfterMoreTime).toBeLessThan(timedUndoClock.tBeforeUndo - 0.8);

    // 4. Move-0 Hint (+2 Free Moves) & Mid-Run Streak Bailout reset on mode switch, while Restart preserves streak (STREAK-INTEGRITY-01)
    const streakAndHintCheck = await page.evaluate(() => {
      const dbg = window.__SHREDBLOCKS_DEBUG__;
      dbg.setPlayMode('CHALLENGE'); // Leaving running TIMED attempt resets winStreak to 0
      const streakAfterLeavingRunningTimed = dbg.getSave().winStreak;
      dbg.patchSave({ winStreak: 2 });
      dbg.loadLevel(2);
      dbg.autoSolveCurrentLevel(); // First clear on L2 -> winStreak advances 2 -> 3
      dbg.closeAllModals();
      const streakAfterFirstClear = dbg.getSave().winStreak;

      // Replaying L2 does NOT increment winStreak
      dbg.loadLevel(2);
      dbg.autoSolveCurrentLevel();
      dbg.closeAllModals();
      const streakAfterReplay = dbg.getSave().winStreak;

      // Normal Restart mid-run preserves winStreak
      dbg.loadLevel(3);
      dbg.activateBooster('HINT'); // +2 Free Moves at Move 0
      const freeMovesBeforeSwitch = dbg.getBoard().freeMovesRemaining;
      (document.getElementById('btn-restart') as HTMLButtonElement | null)?.click();
      const streakAfterNormalRestart = dbg.getSave().winStreak;

      // Mid-run mode switch in Challenge resets winStreak AND clears Hint Free Moves
      dbg.activateBooster('HINT');
      (document.getElementById('btn-mode-next') as HTMLButtonElement | null)?.click(); // Switch Challenge -> Zen
      return {
        streakAfterLeavingRunningTimed,
        streakAfterFirstClear,
        streakAfterReplay,
        freeMovesBeforeSwitch,
        streakAfterNormalRestart,
        streakAfterMidRunSwitch: dbg.getSave().winStreak,
        freeMovesAfterSwitch: dbg.getBoard().freeMovesRemaining,
      };
    });
    expect(streakAndHintCheck.streakAfterLeavingRunningTimed).toBe(0);
    expect(streakAndHintCheck.streakAfterFirstClear).toBe(3);
    expect(streakAndHintCheck.streakAfterReplay).toBe(3);
    expect(streakAndHintCheck.freeMovesBeforeSwitch).toBe(2);
    expect(streakAndHintCheck.streakAfterNormalRestart).toBe(3);
    expect(streakAndHintCheck.streakAfterMidRunSwitch).toBe(0);
    expect(streakAndHintCheck.freeMovesAfterSwitch).toBe(0);

    // 5. Off-screen frontier collision (Zen L12 -> Map -> Challenge Tab [also L12] -> Browser Back) never leaks bombsInert (MODE-ISOLATION-01)
    await page.evaluate(() => {
      const dbg = window.__SHREDBLOCKS_DEBUG__;
      dbg.patchSave({
        modeState: {
          CHALLENGE: { currentLevelId: 12, highestUnlocked: 40 },
          ZEN: { currentLevelId: 12, highestUnlocked: 40 },
          TIMED: { currentLevelId: 1, highestUnlocked: 1 },
        },
      });
      dbg.setPlayMode('ZEN');
      dbg.loadLevel(12);
    });
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().bombsInert)).toBe(true);
    await page.locator('#btn-hud-home').click(); // Navigate to Map (pushes history)
    await page.locator('#map-tab-challenge').click(); // Switch to Challenge tab (also frontier L12!)
    await page.goBack(); // Popstate back to game L12
    await expect(page.locator('#screen-game')).toBeVisible();
    const afterCollisionBack = await page.evaluate(() => ({
      mode: window.__SHREDBLOCKS_DEBUG__.getSave().settings.playMode,
      levelId: window.__SHREDBLOCKS_DEBUG__.getBoard().levelId,
      bombsInert: window.__SHREDBLOCKS_DEBUG__.getBoard().bombsInert,
    }));
    expect(afterCollisionBack).toEqual({ mode: 'CHALLENGE', levelId: 12, bombsInert: false });

    // 6. Multi-touch active drag held across a mode switch cancels cleanly without mutating the new board (MODE-ISOLATION-01)
    const multiTouchIsolation = await page.evaluate(() => {
      const dbg = window.__SHREDBLOCKS_DEBUG__;
      dbg.setPlayMode('CHALLENGE');
      dbg.loadLevel(1);
      const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
      const b0 = dbg.getBoard().blocks[0];
      const startPt = dbg.boardToScreen(b0.col + 0.5, b0.row + 0.5);
      const dragPt = dbg.boardToScreen(b0.col + 0.5, 0.2);

      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 7,
          pointerType: 'touch',
          clientX: startPt.x,
          clientY: startPt.y,
          bubbles: true,
        })
      );
      const activeDuringHold = dbg.getHoverState().activeBlockId;
      // Second finger switches mode while finger #7 is still down!
      (document.getElementById('btn-mode-next') as HTMLButtonElement | null)?.click();
      const activeAfterSwitch = dbg.getHoverState().activeBlockId;

      // Finger #7 moves and releases over the gate on the NEW board
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 7,
          pointerType: 'touch',
          clientX: dragPt.x,
          clientY: dragPt.y,
          bubbles: true,
        })
      );
      canvas.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerId: 7,
          pointerType: 'touch',
          clientX: dragPt.x,
          clientY: dragPt.y,
          bubbles: true,
        })
      );
      return {
        activeDuringHold,
        activeAfterSwitch,
        movesAfterRelease: dbg.getBoard().movesCommitted,
        shreddedAfterRelease: dbg.getBoard().sessionBlocksShredded,
      };
    });
    expect(multiTouchIsolation.activeDuringHold).not.toBeNull();
    expect(multiTouchIsolation.activeAfterSwitch).toBeNull();
    expect(multiTouchIsolation.movesAfterRelease).toBe(0);
    expect(multiTouchIsolation.shreddedAfterRelease).toBe(0);
  });

  test('MAP-ENDLESS-NAV-01: navigates generated Endless stages (301..425+), expands archived flights inline, filters 50-stage Endless tiers, and launches Level 409', async ({
    page,
  }) => {
    await bootWithSave(page, 12);
    await page.evaluate(() => {
      const dbg = window.__SHREDBLOCKS_DEBUG__;
      const cur = dbg.getSave();
      const records = { ...cur.levelRecords };
      records[200] = { stars: 3, challengeStars: 3, bestMoves: 18, bestTimeSec: 40 };
      records[300] = { stars: 3, challengeStars: 3, bestMoves: 20, bestTimeSec: 50 };
      records[350] = { stars: 2, challengeStars: 2, bestMoves: 19, bestTimeSec: 45 };
      records[409] = { stars: 3, challengeStars: 3, bestMoves: 21, bestTimeSec: 52 };
      dbg.patchSave({
        highestLevelUnlocked: 425,
        currentLevelId: 425,
        modeState: {
          CHALLENGE: { highestUnlocked: 425, currentLevelId: 425 },
          ZEN: { highestUnlocked: 12, currentLevelId: 12 },
          TIMED: { highestUnlocked: 5, currentLevelId: 5 },
        },
        levelRecords: records,
      });
      dbg.dismissTitleScreen('home');
    });

    await expect(page.locator('#screen-home')).toBeVisible();
    // Dynamic 50-stage Endless tier chips appear once unlockedMax > 300
    await expect(page.locator('.chip-filter[data-range="301-350"]')).toBeVisible();
    await expect(page.locator('.chip-filter[data-range="351-400"]')).toBeVisible();
    await expect(page.locator('.chip-filter[data-range="401-450"]')).toBeVisible();

    // Active neighborhood avoids above-the-fold content-visibility overhead, while distant flights use native CSS virtualization
    const containmentCheck = await page.evaluate(() => {
      const activeGroup = document.querySelector('.roadmap-stage-group.stage-group-active');
      const distantTrack = document.querySelector(
        '.roadmap-stage-group.stage-group-deferred .stage-group-track'
      );
      return {
        activeDeferred: activeGroup?.classList.contains('stage-group-deferred') ?? true,
        distantContentVis: distantTrack ? window.getComputedStyle(distantTrack).contentVisibility : '',
      };
    });
    expect(containmentCheck.activeDeferred).toBe(false);
    expect(containmentCheck.distantContentVis).toBe('auto');

    // Sequential keyboard Tab navigation crosses cleanly into a `.stage-group-deferred` off-fold flight
    await page.evaluate(() => {
      const stage15 = document.querySelector<HTMLButtonElement>('.level-node-card[data-level-id="15"]');
      stage15?.focus();
    });
    await page.keyboard.press('Tab');
    const focusedAcrossDeferredBoundary = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.levelId
    );
    expect(focusedAcrossDeferredBoundary).toBe('16');

    // In 'All' at L425, earlier Endless stages (#311..#410) are summarized in an interactive Archive button
    const archiveBtn = page.locator('.roadmap-archive-btn').first();
    await expect(archiveBtn).toBeVisible();
    await archiveBtn.click();
    // Expanding reveals Level 409 inline without snapping back away from the expanded flight
    await expect(page.locator('.level-node-card[data-level-id="409"]')).toBeVisible();

    // Keyboard Enter on 401–450 tier chip isolates stages 401..450 while keeping focus & aria-pressed
    const chip401 = page.locator('.chip-filter[data-range="401-450"]');
    await chip401.focus();
    await page.keyboard.press('Enter');
    await expect(chip401).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.chip-filter[data-range="all"]')).toHaveAttribute('aria-pressed', 'false');
    const focusedChipAfterEnter = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.range
    );
    expect(focusedChipAfterEnter).toBe('401-450');
    await expect(page.locator('.level-node-card[data-level-id="401"]')).toBeVisible();
    await expect(page.locator('.level-node-card[data-level-id="409"]')).toBeVisible();
    await expect(page.locator('.level-node-card[data-level-id="1"]')).toHaveCount(0);

    // Switching to Zen Mode (unlockedMax = 12) cleans up dynamic Endless chips and resets range cleanly
    await page.locator('#map-tab-zen').click();
    await expect(page.locator('.chip-filter[data-endless-tier-chip="true"]')).toHaveCount(0);
    await expect(page.locator('.chip-filter[data-range="all"]')).toHaveClass(/active/);

    // Switch back to Challenge Mode, filter ∞ 301+, and tap Level 409 directly to play
    await page.locator('#map-tab-challenge').click();
    await page.locator('.chip-filter[data-range="endless"]').click();
    const node409 = page.locator('.level-node-card[data-level-id="409"]');
    await expect(node409).toBeVisible();
    await node409.click();

    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('#hud-level-title')).toContainText('Level 409 —');
  });

  test('ICON-OPTICAL-PARITY-01: Mode icon optical sizing and structured CTA spacing', async ({ page }) => {
    for (const [width, height] of [
      [320, 568],
      [1280, 800],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await page.waitForFunction(() => Boolean(window.__SHREDBLOCKS_DEBUG__));
      await page.evaluate(() => {
        window.__SHREDBLOCKS_DEBUG__.patchSave({ highestLevelUnlocked: 25, currentLevelId: 25 });
        window.__SHREDBLOCKS_DEBUG__.setPlayMode('TIMED');
      });
      const title = await page.evaluate(() => {
        const btn = document.getElementById('btn-title-play');
        const em = btn?.querySelector('.btn-mode-emblem');
        const j = document.querySelector('#title-chapter-badge .inline-mode-icon');
        const cs = j ? window.getComputedStyle(j) : null;
        return {
          mode: em?.getAttribute('data-mode-glyph'),
          w: em?.querySelector('svg.mode-svg-icon')?.getBoundingClientRect().width ?? 0,
          emBoxShadow: em ? window.getComputedStyle(em).boxShadow : '',
          badgeGlow: Boolean(cs && cs.backgroundImage !== 'none' && cs.boxShadow !== 'none'),
          overflow: !btn || btn.scrollWidth > btn.clientWidth + 1,
        };
      });
      expect(title).toMatchObject({ mode: 'TIMED', emBoxShadow: 'none', badgeGlow: true, overflow: false });
      expect(title.w).toBeGreaterThanOrEqual(8);
      await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('home'));
      const home = await page.evaluate(() => {
        const h = (s: string) => document.querySelector(s)?.getBoundingClientRect().height ?? 0;
        const tEl = document.querySelector('#map-tab-timed .mode-tab-icon');
        const tH = tEl?.getBoundingClientRect().height ?? 0;
        const j = document.querySelector('#zen-sanctuary-card .inline-mode-icon');
        const zs = j ? window.getComputedStyle(j) : null;
        const bad = ['#btn-play-current', '#tab-btn-play', '.node-play-cue'].filter((s) => {
          const el = document.querySelector<HTMLElement>(s);
          return !el || el.scrollWidth > el.clientWidth + 1;
        });
        return {
          timedAttr: tEl?.getAttribute('data-mode-glyph'),
          navAttr: document.getElementById('tab-play-mode-icon')?.getAttribute('data-mode-glyph'),
          ratioC: tH / (h('#map-tab-challenge .mode-tab-icon') || 1),
          ratioZ: tH / (h('#map-tab-zen .mode-tab-icon') || 1),
          zenJewel: Boolean(zs && zs.backgroundImage !== 'none' && zs.boxShadow !== 'none'),
          bad,
        };
      });
      expect(home).toMatchObject({ timedAttr: 'TIMED', navAttr: 'TIMED', zenJewel: false, bad: [] });
      expect(home.ratioC).toBeGreaterThanOrEqual(0.95);
      expect(home.ratioC).toBeLessThanOrEqual(1.05);
      expect(home.ratioZ).toBeGreaterThanOrEqual(0.95);
      expect(home.ratioZ).toBeLessThanOrEqual(1.05);
      await page.locator('#btn-play-current').click();
      await page.locator('#hud-keystone-info').click();
      await expect(
        page.locator('#game-toast .inline-mode-icon[data-mode-glyph="TIMED"] svg.mode-svg-icon')
      ).toBeVisible();
      await page.locator('#btn-pause').click();
      await expect(page.locator('#dialog-pause')).toBeVisible();
      const hudPause = await page.evaluate(() => {
        const j = document.querySelector('#game-toast .inline-mode-icon');
        const cs = j ? window.getComputedStyle(j) : null;
        const attr = (id: string) => document.getElementById(id)?.getAttribute('data-mode-glyph');
        const ctas = ['#btn-pause-resume', '#btn-pause-restart', '#btn-pause-home', '#btn-pause-open-themes'];
        const bad = ctas.filter((s) => {
          const e = document.querySelector<HTMLElement>(s);
          return !e || e.scrollWidth > e.clientWidth + 1;
        });
        return {
          toastGlow: Boolean(cs && cs.backgroundImage !== 'none' && cs.boxShadow !== 'none'),
          hud: attr('hud-mode-icon'),
          prev: attr('hud-mode-prev-icon'),
          next: attr('hud-mode-next-icon'),
          bad,
        };
      });
      expect(hudPause).toEqual({ toastGlow: true, hud: 'TIMED', prev: 'ZEN', next: 'CHALLENGE', bad: [] });
    }
  });
});
