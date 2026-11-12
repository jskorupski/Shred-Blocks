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
});
