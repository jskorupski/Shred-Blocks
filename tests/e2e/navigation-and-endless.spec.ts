import { expect, test } from '@playwright/test';

test.describe('ShredBlocks: Browser History Navigation, Infinite Mode Saves & Cross-Screen Button Colors', () => {
  test('NAV-HISTORY-01: supports non-URL browser Back/Forward across Title, Map, Gameplay, Modals & Themes without mutating URL or breaking standalone PWA', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await expect(page.locator('#title-overlay')).toBeVisible();

    const assertZeroUrlMutation = async () => {
      const loc = await page.evaluate(() => ({
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
      }));
      expect(loc).toEqual({ pathname: '/', search: '', hash: '' });
    };
    await assertZeroUrlMutation();

    // 1. Launch Level 1 from Title Screen -> seeds Map ('home') beneath Gameplay ('game')
    await page.locator('#btn-title-play').click();
    await expect(page.locator('#title-overlay')).toBeHidden();
    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('#hud-level-title')).toContainText('Level 1');
    await assertZeroUrlMutation();

    // 2. Browser Back from Gameplay -> lands on Sanctuary Map (#screen-home)
    await page.goBack();
    await expect(page.locator('#screen-home')).toBeVisible();
    await expect(page.locator('#screen-game')).toBeHidden();
    await assertZeroUrlMutation();

    // 3. Browser Forward from Map -> returns to Gameplay (Level 1)
    await page.goForward();
    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('#hud-level-title')).toContainText('Level 1');
    await assertZeroUrlMutation();

    // 4. Advance through multiple levels in-game (Level 1 -> 2 -> 3) via Skip:
    //    replaceState prevents per-level history stack bloat!
    await page.locator('#btn-skip-hud').click();
    await expect(page.locator('#hud-level-title')).toContainText('Level 2');
    await page.locator('#btn-skip-hud').click();
    await expect(page.locator('#hud-level-title')).toContainText('Level 3');
    await assertZeroUrlMutation();

    // Open Pause modal while on Level 3, then press Browser Back:
    // closes open modal and lands directly on Map in a single Back step!
    await page.locator('#btn-pause').click();
    await expect(page.locator('#dialog-pause')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#dialog-pause')).toBeHidden();
    await expect(page.locator('#screen-home')).toBeVisible();
    await assertZeroUrlMutation();

    // Forward returns directly to Level 3
    await page.goForward();
    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('#hud-level-title')).toContainText('Level 3');

    // Back to Map, then open Themes Studio, then Back -> Map, then Back -> Title Screen!
    await page.goBack();
    await expect(page.locator('#screen-home')).toBeVisible();
    await page.locator('#tab-btn-themes').click();
    await expect(page.locator('#screen-themes')).toBeVisible();
    await assertZeroUrlMutation();

    await page.goBack();
    await expect(page.locator('#screen-home')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#title-overlay')).toBeVisible();
    await assertZeroUrlMutation();

    // 5. Simulate installed standalone mobile PWA and verify identical Back/Forward behavior
    await page.evaluate(() => {
      window.localStorage.setItem('shredblocks_pwa_installed_v1', '1');
    });
    await page.reload();
    await expect(page.locator('#title-overlay')).toBeVisible();
    await expect(page.locator('#btn-title-install')).toBeHidden();
    await page.locator('#btn-title-map').click();
    await expect(page.locator('#screen-home')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#title-overlay')).toBeVisible();
    await assertZeroUrlMutation();

    expect(errors).toEqual([]);
  });

  test('ENDLESS-SAVE-01 & UI-BTN-COLOR-01: handles 2,500-level Infinite Mode saves, >999 level jump, and enforces identical semantic button colors across all screens', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await expect(page.locator('#title-overlay')).toBeVisible();

    // Build and import a 2,500-level Infinite Mode save JSON payload via Save Transfer
    const endlessSaveJson = await page.evaluate(() => {
      const base = window.__SHREDBLOCKS_DEBUG__.getSave();
      const clone = JSON.parse(JSON.stringify(base));
      clone.highestLevelUnlocked = 2501;
      clone.currentLevelId = 2501;
      clone.coins = 125000;
      clone.totalStars = 0;
      clone.levelRecords = {};
      for (let i = 1; i <= 2500; i++) {
        const stars = ((i * 5) % 3) + 1;
        clone.totalStars += stars;
        clone.levelRecords[i] = {
          stars,
          bestMoves: 8 + (i % 15),
          bestTimeSec: 20 + (i % 40),
          skipped: false,
        };
      }
      return JSON.stringify(clone);
    });

    await page.evaluate((jsonStr) => {
      window.__SHREDBLOCKS_DEBUG__.previewSaveImport(jsonStr);
    }, endlessSaveJson);
    await expect(page.locator('#dialog-save-transfer')).toBeVisible();
    await page.locator('#btn-confirm-import').click();

    // Verify QR SVG still renders cleanly for a 2,500-level Infinite Mode save!
    await expect(page.locator('#qr-code-container svg')).toBeVisible();
    await page.locator('#btn-save-transfer-close').click();

    // Returning player Title Screen reflects Level 2501 and exposes #btn-title-map, #btn-title-themes, #btn-title-install
    await expect(page.locator('#btn-title-play')).toContainText('LEVEL 2501');
    await expect(page.locator('#btn-title-map')).toBeVisible();

    // Capture Title Screen button styles before navigating across screens (UI-BTN-COLOR-01)
    const getButtonPalette = (selector: string) =>
      page.locator(selector).evaluate((el) => {
        const cs = window.getComputedStyle(el);
        return { bg: cs.backgroundImage, color: cs.color };
      });

    const titleMapStyle = await getButtonPalette('#btn-title-map');
    const titleThemesStyle = await getButtonPalette('#btn-title-themes');
    const titleSyncStyle = await getButtonPalette('#btn-title-sync');
    const titleSettingsStyle = await getButtonPalette('#btn-title-settings');
    const titleInstallStyle = await getButtonPalette('#btn-title-install');

    // Title secondary utility pills (Themes, Sync, Settings) share exact Amethyst-Slate background
    expect(titleThemesStyle.bg).toBe(titleSyncStyle.bg);
    expect(titleSyncStyle.bg).toBe(titleSettingsStyle.bg);
    // Map (Terracotta-Amber) and Install (Seafoam-Teal) are semantically distinct from purple utility pills
    expect(titleMapStyle.bg).not.toBe(titleThemesStyle.bg);
    expect(titleInstallStyle.bg).not.toBe(titleThemesStyle.bg);

    // Open Sanctuary Map: verify windowed Endless rendering (< 345 DOM nodes instead of 2,500+!)
    await page.locator('#btn-title-map').click();
    await expect(page.locator('#screen-home')).toBeVisible();

    const nodeCount = await page.locator('#roadmap-list .level-node-card').count();
    expect(nodeCount).toBeLessThanOrEqual(345);
    await expect(page.locator('#roadmap-list')).toContainText('ENDLESS ARCHIVE');
    await expect(page.locator('#roadmap-list .level-node-card.current-level')).toContainText('STAGE #2501');

    // Verify Map active tab (#tab-btn-home.active) & Home Install button (#btn-install-header) match Title colors!
    const homeTabMapStyle = await getButtonPalette('#tab-btn-home.active');
    const homeInstallStyle = await getButtonPalette('#btn-install-header');
    const homeJumpGoStyle = await getButtonPalette('#btn-level-jump');
    expect(homeTabMapStyle).toEqual(titleMapStyle);
    expect(homeInstallStyle).toEqual(titleInstallStyle);
    expect(homeJumpGoStyle.bg).toBe(titleThemesStyle.bg);

    // Verify Themes Studio Map button (#btn-themes-home) matches Title & Home Map color!
    await page.locator('#tab-btn-themes').click();
    await expect(page.locator('#screen-themes')).toBeVisible();
    const themesMapStyle = await getButtonPalette('#btn-themes-home');
    expect(themesMapStyle).toEqual(titleMapStyle);

    // Return to Map via #btn-themes-home and jump directly to Level 1850 (> 999!)
    await page.locator('#btn-themes-home').click();
    await expect(page.locator('#screen-home')).toBeVisible();
    await page.locator('#level-jump-input').fill('1850');
    await page.locator('#btn-level-jump').click();
    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('#hud-level-title')).toContainText('Level 1850');

    // Verify In-Game HUD Map button (#btn-hud-home) & Pause Modal Map/Install buttons match 1:1!
    const hudMapStyle = await getButtonPalette('#btn-hud-home');
    const hudSkipStyle = await getButtonPalette('#btn-skip-hud');
    expect(hudMapStyle).toEqual(titleMapStyle);
    expect(hudSkipStyle.bg).toBe(titleThemesStyle.bg);

    await page.locator('#btn-pause').click();
    await expect(page.locator('#dialog-pause')).toBeVisible();
    const pauseMapStyle = await getButtonPalette('#btn-pause-home');
    const pauseInstallStyle = await getButtonPalette('#btn-pause-install');
    expect(pauseMapStyle).toEqual(titleMapStyle);
    expect(pauseInstallStyle).toEqual(titleInstallStyle);

    expect(errors).toEqual([]);
  });
});
