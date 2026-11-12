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
        const shell = document.getElementById('app-shell');
        const backdrop = document.querySelector('.mode-ambience-backdrop');
        const ornament = document.querySelector('#screen-game .sacred-geometry-ornament');
        const canvas = document.getElementById('game-canvas');
        const ch = document.querySelector('.ambience-challenge');
        const zn = document.querySelector('.ambience-zen');
        const tm = document.querySelector('.ambience-timed');
        return {
          playMode: shell?.getAttribute('data-play-mode'),
          titleOpen: shell?.getAttribute('data-title-open'),
          activeScreen: shell?.getAttribute('data-active-screen'),
          backdropOpacity: backdrop ? window.getComputedStyle(backdrop).opacity : '',
          ornamentColor: ornament ? window.getComputedStyle(ornament).color : '',
          canvasFilter: canvas ? window.getComputedStyle(canvas).filter : '',
          layerOpacity: {
            challenge: ch ? window.getComputedStyle(ch).opacity : '',
            zen: zn ? window.getComputedStyle(zn).opacity : '',
            timed: tm ? window.getComputedStyle(tm).opacity : '',
          },
        };
      });

    const challengeState = await readModeVisualState();
    expect(challengeState.playMode).toBe('CHALLENGE');
    expect(challengeState.titleOpen).toBe('false');
    expect(challengeState.activeScreen).toBe('game');
    expect(challengeState.backdropOpacity).toBe('1');
    expect(challengeState.canvasFilter).toBe('none');
    expect(challengeState.layerOpacity).toEqual({ challenge: '1', zen: '0', timed: '0' });

    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.setPlayMode('ZEN'));
    const zenState = await readModeVisualState();
    expect(zenState.playMode).toBe('ZEN');
    expect(zenState.canvasFilter).toBe('none');
    expect(zenState.layerOpacity).toEqual({ challenge: '0', zen: '1', timed: '0' });
    expect(zenState.ornamentColor).not.toBe(challengeState.ornamentColor);

    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.setPlayMode('TIMED'));
    const timedState = await readModeVisualState();
    expect(timedState.playMode).toBe('TIMED');
    expect(timedState.canvasFilter).toBe('none');
    expect(timedState.layerOpacity).toEqual({ challenge: '0', zen: '0', timed: '1' });
    expect(timedState.ornamentColor).not.toBe(zenState.ornamentColor);
    expect(timedState.ornamentColor).not.toBe(challengeState.ornamentColor);

    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.setHighContrast(true));
    const hcBackdropOpacity = await page.evaluate(() => {
      const backdrop = document.querySelector('.mode-ambience-backdrop');
      return backdrop ? window.getComputedStyle(backdrop).opacity : '';
    });
    expect(hcBackdropOpacity).toBe('0');
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
      const idleParticles = dbg.getTelemetry().activeParticles;
      const nonShredBlock = dbg.getBoard().blocks.find((b) => b.col === 3 && b.row === 2);
      if (nonShredBlock) {
        dbg.commitMove(nonShredBlock.id, 1, 3);
      }
      dbg.advanceFrozenFrames(6);
      const afterSlideParticles = dbg.getTelemetry().activeParticles;
      const shredBlk = dbg.getBoard().blocks[0];
      dbg.commitMove(shredBlk.id, 0, shredBlk.col);
      dbg.advanceFrozenFrames(2);
      const midShredParticles = dbg.getTelemetry().activeParticles;
      (document.getElementById('btn-restart') as HTMLButtonElement | null)?.click();
      dbg.advanceFrozenFrames(1);
      const afterRestartParticles = dbg.getTelemetry().activeParticles;

      dbg.freezeTime(null);
      dbg.setFxRandomSeed(null);
      return {
        zStart,
        zAfter,
        boltTelemetry,
        rmTelemetry,
        idleParticles,
        afterSlideParticles,
        midShredParticles,
        afterRestartParticles,
      };
    });

    expect(bubbleVsBolt.zAfter).toBeGreaterThan(bubbleVsBolt.zStart + 0.35);
    expect(bubbleVsBolt.boltTelemetry.activeParticles).toBeGreaterThan(10);
    expect(bubbleVsBolt.boltTelemetry.gateBurstModes).toContain('PLASMA_ARCS:lightning_bolts');
    expect(bubbleVsBolt.rmTelemetry.activeParticles).toBe(0);
    expect(bubbleVsBolt.rmTelemetry.gateBurstModes).toContain('REDUCED_MOTION_SEAL:star_confetti');
    expect(bubbleVsBolt.idleParticles).toBe(0);
    expect(bubbleVsBolt.afterSlideParticles).toBe(0);
    expect(bubbleVsBolt.midShredParticles).toBeGreaterThan(12);
    expect(bubbleVsBolt.afterRestartParticles).toBe(0);
  });
});
