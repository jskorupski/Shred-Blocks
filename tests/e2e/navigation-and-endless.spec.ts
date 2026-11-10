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

  test('MYSTIC-RELIC-01: animates levitating glowing stone relic on Title Screen, smoothly fades into play, and never leaks into game mode', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await expect(page.locator('#title-overlay')).toBeVisible();

    const titleState = await page.evaluate(() => {
      const canvas = document.getElementById('game-canvas');
      const cs = canvas ? window.getComputedStyle(canvas) : null;
      return {
        backend: window.__SHREDBLOCKS_DEBUG__.getTelemetry().rendererBackend,
        mix: window.__SHREDBLOCKS_DEBUG__.getBlueprintMix(),
        hasBackdropClass: document.getElementById('screen-game')?.classList.contains('title-backdrop-mode'),
        canvasFilter: cs ? cs.filter : '',
        canvasAnim: cs ? cs.animationName : '',
      };
    });
    expect(titleState.backend).toBe('WEBGL2');
    expect(titleState.mix).toBe(1);
    expect(titleState.hasBackdropClass).toBe(true);
    expect(titleState.canvasAnim).toBe('mysticRelicAura');

    // Verify subtle levitating/twisting + pulsating glow animates live frames on Title Screen
    const frameA = await page.evaluate(() =>
      (document.getElementById('game-canvas') as HTMLCanvasElement).toDataURL()
    );
    await page.waitForTimeout(280);
    const frameB = await page.evaluate(() =>
      (document.getElementById('game-canvas') as HTMLCanvasElement).toDataURL()
    );
    expect(frameA).not.toBe(frameB);

    // Clicking Play smoothly fades mystic relic -> normal 3D gameplay (0 < mix < 1 mid-transition -> 0 settled)
    await page.locator('#btn-title-play').click();
    await expect(page.locator('#title-overlay')).toBeHidden();
    await page.waitForTimeout(120);
    const midTransitionMix = await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBlueprintMix());
    expect(midTransitionMix).toBeGreaterThan(0);
    expect(midTransitionMix).toBeLessThan(1);

    await page.waitForTimeout(820);
    const settledGameState = await page.evaluate(() => {
      const canvas = document.getElementById('game-canvas');
      const cs = canvas ? window.getComputedStyle(canvas) : null;
      return {
        mix: window.__SHREDBLOCKS_DEBUG__.getBlueprintMix(),
        hasBackdropClass: document.getElementById('screen-game')?.classList.contains('title-backdrop-mode'),
        canvasFilter: cs ? cs.filter : '',
        canvasAnim: cs ? cs.animationName : '',
      };
    });
    expect(settledGameState.mix).toBe(0);
    expect(settledGameState.hasBackdropClass).toBe(false);
    expect(settledGameState.canvasAnim).toBe('none');
    expect(settledGameState.canvasFilter).not.toBe(titleState.canvasFilter);

    // Re-open Title Screen, then load a level directly -> ZERO blueprintMix or backdrop leak!
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.openTitleScreen());
    await expect(page.locator('#title-overlay')).toBeVisible();
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBlueprintMix())).toBe(1);

    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(11));
    const directLoadState = await page.evaluate(() => {
      const canvas = document.getElementById('game-canvas');
      const cs = canvas ? window.getComputedStyle(canvas) : null;
      return {
        mix: window.__SHREDBLOCKS_DEBUG__.getBlueprintMix(),
        isTitleOpen: window.__SHREDBLOCKS_DEBUG__.isTitleScreenOpen(),
        hasBackdropClass: document.getElementById('screen-game')?.classList.contains('title-backdrop-mode'),
        canvasAnim: cs ? cs.animationName : '',
      };
    });
    expect(directLoadState).toEqual({
      mix: 0,
      isTitleOpen: false,
      hasBackdropClass: false,
      canvasAnim: 'none',
    });

    // Re-open Title Screen, dismiss to Map -> blueprintMix immediately 0!
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.openTitleScreen());
    await page.locator('#btn-title-map').click();
    await expect(page.locator('#screen-home')).toBeVisible();
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBlueprintMix())).toBe(0);

    expect(errors).toEqual([]);
  });
});
