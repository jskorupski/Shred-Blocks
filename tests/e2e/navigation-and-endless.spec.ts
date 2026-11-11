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
      const stage = document.querySelector('#screen-game .board-stage');
      const cs = canvas ? window.getComputedStyle(canvas) : null;
      const stageCs = stage ? window.getComputedStyle(stage) : null;
      const raysCs = stage ? window.getComputedStyle(stage, '::before') : null;
      return {
        backend: window.__SHREDBLOCKS_DEBUG__.getTelemetry().rendererBackend,
        mix: window.__SHREDBLOCKS_DEBUG__.getBlueprintMix(),
        hasBackdropClass: document.getElementById('screen-game')?.classList.contains('title-backdrop-mode'),
        canvasFilter: cs ? cs.filter : '',
        canvasAnim: cs ? cs.animationName : '',
        stageIsolation: stageCs ? stageCs.isolation : '',
        godRaysAnim: raysCs ? raysCs.animationName : '',
        godRaysBlend: raysCs ? raysCs.mixBlendMode : '',
      };
    });
    expect(titleState.backend).toBe('WEBGL2');
    expect(titleState.mix).toBe(1);
    expect(titleState.hasBackdropClass).toBe(true);
    expect(titleState.canvasAnim).toBe('mysticRelicAura');
    expect(titleState.stageIsolation).toBe('isolate');
    expect(titleState.godRaysAnim).toBe('mysticGodRays');
    expect(titleState.godRaysBlend).toBe('screen');

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
    // while the RELIC-AWAKEN-01 burst (stone shards + smoke + embers + glow halo) fires on frame 1.
    const titleCanvasRect = await page.locator('#game-canvas').boundingBox();
    await page.locator('#btn-title-play').click();
    await expect(page.locator('#title-overlay')).toBeHidden();
    await page.waitForTimeout(120);
    const midTransition = await page.evaluate(() => {
      const canvas = document.getElementById('game-canvas');
      return {
        mix: window.__SHREDBLOCKS_DEBUG__.getBlueprintMix(),
        particles: window.__SHREDBLOCKS_DEBUG__.getTelemetry().activeParticles,
        burstClass: document.getElementById('screen-game')?.classList.contains('relic-awakening-burst'),
        canvasAnim: canvas ? window.getComputedStyle(canvas).animationName : '',
      };
    });
    expect(midTransition.mix).toBeGreaterThan(0);
    expect(midTransition.mix).toBeLessThan(1);
    expect(midTransition.particles).toBeGreaterThan(60);
    expect(midTransition.burstClass).toBe(true);
    expect(midTransition.canvasAnim).toBe('relicAwakeningBloom');
    // TITLE-TRANSITION-01: the burst halo is filter-only, so the canvas never shifts
    const midCanvasRect = await page.locator('#game-canvas').boundingBox();
    expect(Math.abs((midCanvasRect?.y ?? 0) - (titleCanvasRect?.y ?? 0))).toBeLessThan(1);
    expect(Math.abs((midCanvasRect?.width ?? 0) - (titleCanvasRect?.width ?? 0))).toBeLessThan(1);

    await page.waitForTimeout(820);
    const settledGameState = await page.evaluate(() => {
      const canvas = document.getElementById('game-canvas');
      const cs = canvas ? window.getComputedStyle(canvas) : null;
      return {
        mix: window.__SHREDBLOCKS_DEBUG__.getBlueprintMix(),
        hasBackdropClass: document.getElementById('screen-game')?.classList.contains('title-backdrop-mode'),
        burstClass: document.getElementById('screen-game')?.classList.contains('relic-awakening-burst'),
        canvasFilter: cs ? cs.filter : '',
        canvasAnim: cs ? cs.animationName : '',
      };
    });
    expect(settledGameState.mix).toBe(0);
    expect(settledGameState.hasBackdropClass).toBe(false);
    expect(settledGameState.burstClass).toBe(false);
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

  test('SAVE-SEC-01: hostile #import= URLs never execute code, never mutate the save, and the CSP reports zero violations', async ({
    page,
  }) => {
    const errors: string[] = [];
    const dialogs: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('dialog', async (d) => {
      dialogs.push(d.message());
      await d.dismiss();
    });
    await page.addInitScript(() => {
      (window as unknown as { __cspViolations: string[] }).__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        (window as unknown as { __cspViolations: string[] }).__cspViolations.push(e.violatedDirective);
      });
    });

    await page.goto('/');
    await expect(page.locator('#title-overlay')).toBeVisible();
    const before = await page.evaluate(() => JSON.stringify(window.__SHREDBLOCKS_DEBUG__.getSave()));

    const hostile = [
      '#import=SB1-%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E-deadbeef',
      '#import=SB1-PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg-00000000',
      '#import=javascript:alert(document.domain)',
    ];
    for (const hash of hostile) {
      await page.goto(`/${hash}`);
      await page.waitForTimeout(250);
      const state = await page.evaluate(() => ({
        save: JSON.stringify(window.__SHREDBLOCKS_DEBUG__.getSave()),
        diffVisible: !(document.getElementById('import-diff-panel')?.hidden ?? true),
        injectedImg: document.querySelectorAll('img[src="x"], script:not([src])').length,
        csp: (window as unknown as { __cspViolations: string[] }).__cspViolations,
      }));
      expect(state.diffVisible).toBe(false);
      expect(state.injectedImg).toBe(0);
      expect(state.csp).toEqual([]);
      expect(JSON.parse(state.save).coins).toBe(JSON.parse(before).coins);
      expect(JSON.parse(state.save).highestLevelUnlocked).toBe(JSON.parse(before).highestLevelUnlocked);
    }

    expect(dialogs).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('MAP-LINKED-PATH-01: renders 5-stage grouped linked path, distinguishes Completed vs Skipped states, auto-scrolls to current stage, and preserves responsive UX across viewports', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.locator('#btn-title-play').click();
    await expect(page.locator('#screen-game')).toBeVisible();

    // Create a realistic mixed progression up to Stage #12:
    // - Completed: #1 (3★), #3 (2★), #5 (3★), #6..#10 (all 3★ -> fully cleared group!)
    // - Skipped: #2 ( via real HUD Skip button below + seeded #4, #11 )
    // - Current: #12
    await page.locator('#btn-skip-hud').click(); // Real UI skip on Level 1 first to verify live Skip wiring
    await expect(page.locator('#hud-level-title')).toContainText('Level 2');

    const mixedSaveJson = await page.evaluate(() => {
      const clone = JSON.parse(JSON.stringify(window.__SHREDBLOCKS_DEBUG__.getSave()));
      clone.highestLevelUnlocked = 12;
      clone.currentLevelId = 12;
      clone.levelRecords = {
        1: { stars: 3, bestMoves: 2, bestTimeSec: 8, skipped: false },
        2: { stars: 0, bestMoves: null, bestTimeSec: null, skipped: true },
        3: { stars: 2, bestMoves: 5, bestTimeSec: 14, skipped: false },
        4: { stars: 0, bestMoves: null, bestTimeSec: null, skipped: true },
        5: { stars: 3, bestMoves: 4, bestTimeSec: 12, skipped: false },
        6: { stars: 3, bestMoves: 5, bestTimeSec: 15, skipped: false },
        7: { stars: 3, bestMoves: 6, bestTimeSec: 16, skipped: false },
        8: { stars: 3, bestMoves: 6, bestTimeSec: 18, skipped: false },
        9: { stars: 3, bestMoves: 7, bestTimeSec: 19, skipped: false },
        10: { stars: 3, bestMoves: 6, bestTimeSec: 17, skipped: false },
        11: { stars: 0, bestMoves: null, bestTimeSec: null, skipped: true },
      };
      clone.totalStars = 23;
      return JSON.stringify(clone);
    });

    await page.evaluate((jsonStr) => {
      window.__SHREDBLOCKS_DEBUG__.previewSaveImport(jsonStr);
    }, mixedSaveJson);
    await page.locator('#btn-confirm-import').click();
    await page.locator('#btn-save-transfer-close').click();

    // Navigate to Sanctuary Map (#screen-home)
    await page.locator('#btn-hud-home').click();
    await expect(page.locator('#screen-home')).toBeVisible();

    // 1. Verify auto-scroll brought active Stage #12 directly into the visible #roadmap-list viewport
    const autoScrollCheck = await page.evaluate(() => {
      const list = document.getElementById('roadmap-list');
      const current = list?.querySelector<HTMLElement>('.level-node-card.current-level');
      if (!list || !current) return null;
      const lr = list.getBoundingClientRect();
      const cr = current.getBoundingClientRect();
      return {
        scrollTop: list.scrollTop,
        scrollHeight: list.scrollHeight,
        clientHeight: list.clientHeight,
        currentLevelId: current.dataset.levelId,
        ariaCurrent: current.getAttribute('aria-current'),
        isVisibleInScrollPort: cr.top >= lr.top - 2 && cr.bottom <= lr.bottom + 2,
      };
    });
    expect(autoScrollCheck).not.toBeNull();
    expect(autoScrollCheck?.currentLevelId).toBe('12');
    expect(autoScrollCheck?.ariaCurrent).toBe('step');
    expect(autoScrollCheck?.scrollTop).toBeGreaterThan(80);
    expect(autoScrollCheck?.scrollHeight).toBeGreaterThan((autoScrollCheck?.clientHeight ?? 0) * 3);
    expect(autoScrollCheck?.isVisibleInScrollPort).toBe(true);

    // 2. Scroll to top and verify 5-stage visual grouping & strict top-to-bottom linked-path ordering
    await page.evaluate(() => {
      const list = document.getElementById('roadmap-list');
      if (list) list.scrollTop = 0;
    });

    const firstThreeGroups = page.locator('#roadmap-list .roadmap-stage-group');
    await expect(firstThreeGroups.nth(0)).toContainText('STAGES 1–5');
    await expect(firstThreeGroups.nth(0)).toContainText('3/5 Cleared · 2 Skipped · ★ 8/15');
    await expect(firstThreeGroups.nth(1)).toHaveClass(/stage-group-cleared/);
    await expect(firstThreeGroups.nth(1)).toContainText('STAGES 6–10');
    await expect(firstThreeGroups.nth(1)).toContainText('✓ 5/5 Cleared · ★ 15/15');
    await expect(firstThreeGroups.nth(2)).toHaveClass(/stage-group-active/);
    await expect(firstThreeGroups.nth(2)).toContainText('STAGES 11–15');

    // Verify Completed (#1) vs Skipped (#2) visual states & strict vertical step progression
    const stateComparison = await page.evaluate(() => {
      const n1 = document.querySelector<HTMLElement>('.level-node-card[data-level-id="1"]');
      const n2 = document.querySelector<HTMLElement>('.level-node-card[data-level-id="2"]');
      const n12 = document.querySelector<HTMLElement>('.level-node-card[data-level-id="12"]');
      const n14 = document.querySelector<HTMLElement>('.level-node-card[data-level-id="14"]');
      if (!n1 || !n2 || !n12 || !n14) return null;
      const cs1 = window.getComputedStyle(n1);
      const cs2 = window.getComputedStyle(n2);
      const firstGroup = document.querySelector('.roadmap-stage-group');
      const group1Nodes = Array.from(
        firstGroup ? firstGroup.querySelectorAll<HTMLElement>('.level-node-card') : []
      );
      let strictlyVertical = group1Nodes.length === 5;
      for (let i = 0; i < group1Nodes.length - 1; i++) {
        if (
          group1Nodes[i].getBoundingClientRect().bottom >
          group1Nodes[i + 1].getBoundingClientRect().top + 1
        ) {
          strictlyVertical = false;
        }
      }
      return {
        n1Completed: n1.classList.contains('completed-level') && !n1.classList.contains('skipped-level'),
        n1Text: n1.textContent ?? '',
        n1Opacity: Number(cs1.opacity),
        n2Skipped: n2.classList.contains('skipped-level') && !n2.classList.contains('completed-level'),
        n2Text: n2.textContent ?? '',
        n2Opacity: Number(cs2.opacity),
        distinctBg: cs1.backgroundImage !== cs2.backgroundImage,
        n14Locked: n14.classList.contains('locked-level'),
        strictlyVertical,
      };
    });
    expect(stateComparison?.n1Completed).toBe(true);
    expect(stateComparison?.n1Text).toContain('✓ Cleared');
    expect(stateComparison?.n1Text).toContain('★★★');
    expect(stateComparison?.n1Opacity).toBe(1);
    expect(stateComparison?.n2Skipped).toBe(true);
    expect(stateComparison?.n2Text).toContain('Skipped');
    expect(stateComparison?.n2Text).not.toContain('✓ Cleared');
    expect(stateComparison?.n2Opacity).toBeLessThan(0.85);
    expect(stateComparison?.n2Opacity).toBeGreaterThan(0.55);
    expect(stateComparison?.distinctBg).toBe(true);
    expect(stateComparison?.n14Locked).toBe(true);
    expect(stateComparison?.strictlyVertical).toBe(true);

    // 3. Verify responsive layout & zero horizontal overflow across compact mobile, standard mobile, tablet, and desktop
    for (const vp of [
      { width: 360, height: 640 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(vp);
      const vpMetrics = await page.evaluate(() => {
        const list = document.getElementById('roadmap-list');
        const group = list?.querySelector<HTMLElement>('.roadmap-stage-group');
        return {
          noDocOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
          noListHOverflow: list ? list.scrollWidth <= list.clientWidth + 1 : false,
          canScrollVertically: list ? list.scrollHeight > list.clientHeight + 50 : false,
          groupFits: group && list ? group.getBoundingClientRect().width <= list.clientWidth + 1 : false,
        };
      });
      expect(vpMetrics).toEqual({
        noDocOverflow: true,
        noListHOverflow: true,
        canScrollVertically: true,
        groupFits: true,
      });
    }

    // 4. UI-SELECT-01 & UI-SCROLLBAR-01: prevent errant desktop text selection on UI chrome & style scrollbars
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.mouse.move(280, 24);
    await page.mouse.down();
    await page.mouse.move(960, 620, { steps: 10 });
    await page.mouse.up();

    const desktopPolish = await page.evaluate(() => {
      const cs = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? window.getComputedStyle(el) : null;
      };
      const roadmapCs = cs('#roadmap-list');
      const defaultThumbColor = roadmapCs?.scrollbarColor ?? '';
      const roadmapEl = document.getElementById('roadmap-list');
      document.body.classList.add('high-contrast');
      const hcThumbColor = roadmapEl ? window.getComputedStyle(roadmapEl).scrollbarColor : '';
      document.body.classList.remove('high-contrast');

      return {
        dragSelection: window.getSelection()?.toString() ?? '',
        shellUserSelect: cs('#app-shell')?.userSelect,
        nodeUserSelect: cs('.level-node-card')?.userSelect,
        dialogUserSelect: cs('#dialog-pause')?.userSelect,
        jumpInputUserSelect: cs('#level-jump-input')?.userSelect,
        saveTextareaUserSelect: cs('#save-code-output')?.userSelect,
        telemetryUserSelect: cs('#telemetry-readout')?.userSelect,
        roadmapScrollbarWidth: roadmapCs?.scrollbarWidth,
        themesScrollbarWidth: cs('.themes-scroll')?.scrollbarWidth,
        dialogScrollbarWidth: cs('#dialog-save-transfer .dialog-card')?.scrollbarWidth,
        filterPillsScrollbarWidth: cs('.filter-pills')?.scrollbarWidth,
        themeTabsScrollbarWidth: cs('.themes-category-tabs')?.scrollbarWidth,
        defaultThumbColor,
        hcThumbColor,
      };
    });
    expect(desktopPolish.dragSelection).toBe('');
    expect(desktopPolish.shellUserSelect).toBe('none');
    expect(desktopPolish.nodeUserSelect).toBe('none');
    expect(desktopPolish.dialogUserSelect).toBe('none');
    expect(desktopPolish.jumpInputUserSelect).toBe('text');
    expect(desktopPolish.saveTextareaUserSelect).toBe('text');
    expect(desktopPolish.telemetryUserSelect).toBe('text');
    expect(desktopPolish.roadmapScrollbarWidth).toBe('thin');
    expect(desktopPolish.themesScrollbarWidth).toBe('thin');
    expect(desktopPolish.dialogScrollbarWidth).toBe('thin');
    expect(desktopPolish.filterPillsScrollbarWidth).toBe('none');
    expect(desktopPolish.themeTabsScrollbarWidth).toBe('none');
    expect(desktopPolish.defaultThumbColor).not.toBe('auto');
    expect(desktopPolish.hcThumbColor).not.toBe(desktopPolish.defaultThumbColor);

    // 5. Verify clicking Skipped Stage #2 cleanly opens Level 2 so players can replay & clear skipped stages!
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.level-node-card[data-level-id="2"]').click();
    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('#hud-level-title')).toContainText('Level 2');

    expect(errors).toEqual([]);
  });

  test('CHALLENGE-MODE-01: defaults to Tactical Challenge mode, coalesces multi-drag adjustments, rescues OUT_OF_MOVES into Zen Mode, records 🌿 Zen badge, and resets stage on Zen -> Challenge switch', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.locator('#btn-title-play').click();
    await expect(page.locator('#screen-game')).toBeVisible();

    // 1. Fresh boot defaults to CHALLENGE mode (`⚔️ Challenge` + `Moves Left: 8` on Level 1)
    await expect(page.locator('#hud-mode-label')).toContainText('Challenge');
    await expect(page.locator('#hud-moves-pill')).toHaveText('Moves Left: 8');

    // 2. Touch-Move Coalescing: two consecutive non-clearing adjustments of Block 1 on Level 3 (`Moves Left: 9 -> 8`) count as 1 Move
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(3));
    const dragCell = async (c1: number, r1: number, c2: number, r2: number) => {
      const pts = await page.evaluate(
        ({ a, b, c, d }) => ({
          s: window.__SHREDBLOCKS_DEBUG__.boardToScreen(a + 0.5, b + 0.5),
          e: window.__SHREDBLOCKS_DEBUG__.boardToScreen(c + 0.5, d + 0.5),
        }),
        { a: c1, b: r1, c: c2, d: r2 }
      );
      await page.mouse.move(pts.s.x, pts.s.y);
      await page.mouse.down();
      await page.mouse.move(pts.e.x, pts.e.y, { steps: 8 });
      await page.mouse.up();
    };
    await expect(page.locator('#hud-moves-pill')).toHaveText('Moves Left: 9');
    await dragCell(1, 1, 1, 0);
    await expect(page.locator('#hud-moves-pill')).toHaveText('Moves Left: 8');
    await dragCell(1, 0, 2, 0);
    await expect(page.locator('#hud-moves-pill')).toHaveText('Moves Left: 8');

    // 3. Exhaust remaining moves on Level 1 to trigger OUT_OF_MOVES, then click "🌿 Finish in Zen Mode (Free)"
    await page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.loadLevel(1);
      window.__SHREDBLOCKS_DEBUG__.getBoard().movesRemaining = 1;
    });
    // Non-shredding move on Block 2 (col 3, row 2 -> col 3, row 1) spends the final move tick. FINAL-TOUCH-01:
    // Block 2 can still slide into its gate, so OUT_OF_MOVES is deferred and the final-touch hint appears.
    await dragCell(3, 2, 3, 1);
    await expect(page.locator('#game-toast')).toContainText('Last move');
    await expect(page.locator('#dialog-failure')).toBeHidden();
    // Finishing Block 2 is a free coalesced touch; Block 1 still remains -> Failure modal!
    await dragCell(3, 1, 4, 1);
    await expect(page.locator('#dialog-failure')).toBeVisible();
    await expect(page.locator('#failure-title')).toContainText('Out of Moves');
    await page.locator('#btn-failure-zen').click();
    await expect(page.locator('#dialog-failure')).toBeHidden();
    await expect(page.locator('#hud-mode-label')).toContainText('Zen');

    // Finish Level 1 in Zen Mode (board state preserved!) -> awards `🌿 Zen Clear` (0 Gold Stars)
    await dragCell(1, 1, 1, 0);
    await expect(page.locator('#dialog-victory')).toBeVisible();
    await expect(page.locator('#victory-stars')).toContainText('🌿 Zen Clear');
    await page.locator('#btn-victory-home').click();
    await expect(page.locator('#screen-home')).toBeVisible();
    await expect(page.locator('.level-node-card[data-level-id="1"]')).toHaveClass(/zen-cleared-level/);
    await expect(page.locator('.level-node-card[data-level-id="1"]')).toContainText('🌿 Zen');

    // 4. Anti-Cheese: on Level 2 in Zen Mode, make a move (`Moves: 1 / Par 3`), then switch Zen -> Timed/Challenge -> resets to Move 0
    await page.locator('.level-node-card[data-level-id="2"]').click();
    await expect(page.locator('#hud-level-title')).toContainText('Level 2');
    await dragCell(1, 1, 0, 1);
    await expect(page.locator('#hud-moves-pill')).toContainText('Moves: 1 / Par');
    await page.locator('#btn-mode-toggle').click(); // ZEN -> TIMED -> restarts at Move 0
    await expect(page.locator('#hud-mode-label')).toContainText('Speed Rush');
    await expect(page.locator('#hud-moves-pill')).toContainText('Moves: 0 / Par');
    await page.locator('#btn-mode-toggle').click(); // TIMED -> CHALLENGE
    await expect(page.locator('#hud-mode-label')).toContainText('Challenge');
    await expect(page.locator('#hud-moves-pill')).toHaveText('Moves Left: 9');

    expect(errors).toEqual([]);
  });
});
