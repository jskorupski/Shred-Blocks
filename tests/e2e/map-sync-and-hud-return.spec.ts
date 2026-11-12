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
});
