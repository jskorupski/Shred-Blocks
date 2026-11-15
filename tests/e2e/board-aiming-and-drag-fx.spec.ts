import { expect, type Page, test } from '@playwright/test';

async function bootIntoGameLevel(page: Page, levelId: number): Promise<void> {
  const seededSave = {
    schemaVersion: 1,
    appId: 'shredblocks-color-jam',
    writeSeq: 10,
    updatedAt: 1_760_000_000_000,
    highestLevelUnlocked: 60,
    currentLevelId: levelId,
    coins: 900,
    totalStars: 45,
    winStreak: 2,
    bestWinStreak: 4,
    totalBlocksShredded: 90,
    totalMovesCommitted: 130,
    shredderChestProgress: 20,
    milestoneChestLevel: 20,
    starReliquaryLevel: 25,
    economyVersion: 2,
    boosters: { UNDO: 3, HINT: 3, HAMMER: 2, ROCKET: 3, VACUUM: 2 },
    unlockedSkins: ['classic_studs', 'relic_stone'],
    unlockedTrays: ['industrial_slate', 'warm_birch'],
    unlockedParticles: ['micro_cubes'],
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
      reducedMotion: false,
      qualityTier: 'ULTRA_120',
    },
    levelRecords: {},
  };

  await page.addInitScript(
    (raw) => window.localStorage.setItem('shredblocks.save.v1', raw),
    JSON.stringify(seededSave)
  );
  await page.goto('/');
  await page.evaluate((id) => {
    window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('game', false);
    window.__SHREDBLOCKS_DEBUG__.loadLevel(id);
  }, levelId);
  await expect(page.locator('#screen-game')).toBeVisible();
}

test.describe('Board Aiming, Mid-Drag Origin Ghost Footprint & Mystic Path-Tracing FX', () => {
  test('ROCKET-AIM-01: starts unhighlighted, live-scrubs on mouse hover & touch press-slide, cancels on drag-off-board, and fires on release or keyboard Enter', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await bootIntoGameLevel(page, 20);

    // 1. Entering TARGET_ROCKET starts with NO phantom/stale row highlighted (hoverRow === -1, hoverCol === -1)
    await page.locator('#btn-booster-rocket').click();
    await expect(page.locator('#booster-target-banner')).toBeVisible();
    await expect(page.locator('#booster-target-text')).toContainText('Aim & release to blast entire ROW');
    const initialHover = await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getHoverState());
    expect(initialHover.inputMode).toBe('TARGET_ROCKET');
    expect(initialHover.hoverRow).toBe(-1);
    expect(initialHover.hoverCol).toBe(-1);

    // 2. Desktop Mouse Hover previews the row under the cursor, and leaving the board clears it back to -1
    const cellRow3 = await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.boardToScreen(2.5, 3.5));
    const offBoard = await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.boardToScreen(-1.2, -1.2));
    await page.mouse.move(cellRow3.x, cellRow3.y);
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getHoverState().hoverRow)).toBe(3);

    await page.mouse.move(offBoard.x, offBoard.y);
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getHoverState().hoverRow)).toBe(-1);

    // 3. Mobile Touch Press-and-Slide Aiming + Drag-Off-Board Safe Cancel (0 Rockets spent!)
    const cellRow1 = await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.boardToScreen(2.5, 1.5));
    await page.evaluate(
      ({ p1, p3, pOff }) => {
        const canvas = document.getElementById('game-canvas');
        if (!canvas) throw new Error('Missing #game-canvas');
        canvas.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            pointerId: 41,
            pointerType: 'touch',
            clientX: p1.x,
            clientY: p1.y,
          })
        );
        if (window.__SHREDBLOCKS_DEBUG__.getHoverState().hoverRow !== 1) {
          throw new Error('Expected touch pointerdown to preview row 1 without firing early');
        }
        if (window.__SHREDBLOCKS_DEBUG__.getHoverState().inputMode !== 'TARGET_ROCKET') {
          throw new Error('Expected Rocket mode to remain active during touch hold');
        }
        canvas.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            pointerId: 41,
            pointerType: 'touch',
            clientX: p3.x,
            clientY: p3.y,
          })
        );
        if (window.__SHREDBLOCKS_DEBUG__.getHoverState().hoverRow !== 3) {
          throw new Error('Expected touch slide to scrub highlight to row 3');
        }
        // Slide finger off the board rim and release -> cancels without spending Rocket!
        canvas.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            pointerId: 41,
            pointerType: 'touch',
            clientX: pOff.x,
            clientY: pOff.y,
          })
        );
        if (window.__SHREDBLOCKS_DEBUG__.getHoverState().hoverRow !== -1) {
          throw new Error('Expected sliding off board to clear Rocket highlight');
        }
        canvas.dispatchEvent(
          new PointerEvent('pointerup', {
            bubbles: true,
            pointerId: 41,
            pointerType: 'touch',
            clientX: pOff.x,
            clientY: pOff.y,
          })
        );
      },
      { p1: cellRow1, p3: cellRow3, pOff: offBoard }
    );

    await expect(page.locator('#booster-target-banner')).toBeHidden();
    await expect(page.locator('#badge-booster-rocket')).toHaveText('3');

    // 4. Touch Press-Slide-Release inside bounds fires Rocket on the final aimed row
    await page.locator('#btn-booster-rocket').click();
    const targetRowWithBlock = await page.evaluate(() => {
      const b = window.__SHREDBLOCKS_DEBUG__.getBoard().blocks.find((blk) => blk.status === 'ACTIVE');
      if (!b) throw new Error('Expected active block');
      const startPt = window.__SHREDBLOCKS_DEBUG__.boardToScreen(b.col + 0.5, Math.max(0, b.row - 1) + 0.5);
      const aimPt = window.__SHREDBLOCKS_DEBUG__.boardToScreen(b.col + 0.5, b.row + 0.5);
      return { startPt, aimPt };
    });

    await page.evaluate(({ startPt, aimPt }) => {
      const canvas = document.getElementById('game-canvas');
      if (!canvas) throw new Error('Missing #game-canvas');
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 42,
          pointerType: 'touch',
          clientX: startPt.x,
          clientY: startPt.y,
        })
      );
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 42,
          pointerType: 'touch',
          clientX: aimPt.x,
          clientY: aimPt.y,
        })
      );
      canvas.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 42,
          pointerType: 'touch',
          clientX: aimPt.x,
          clientY: aimPt.y,
        })
      );
    }, targetRowWithBlock);

    await expect(page.locator('#booster-target-banner')).toBeHidden();
    await expect(page.locator('#badge-booster-rocket')).toHaveText('2');

    // 5. Keyboard Rocket aiming (Arrow keys step hoverRow without moving puzzle blocks, X toggles axis)
    const movesBeforeKeyAim = await page.evaluate(
      () => window.__SHREDBLOCKS_DEBUG__.getBoard().movesCommitted
    );
    await page.locator('#btn-booster-rocket').click();
    await page.keyboard.press('ArrowDown');
    const keyHover = await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getHoverState());
    expect(keyHover.hoverRow).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getBoard().movesCommitted)).toBe(
      movesBeforeKeyAim
    );
    await page.keyboard.press('Escape');
    await expect(page.locator('#booster-target-banner')).toBeHidden();

    expect(errors).toEqual([]);
  });

  test('ORIGIN-GHOST-01 & MYSTIC-TRACE-01: tracks mid-drag origin return for 0-move cancel, spawns fast-fading path traces, honors Reduced Motion, and holds 120Hz budget', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await bootIntoGameLevel(page, 2);

    // 1. Dragging >= 1 cell away activates dragLeftOrigin (Origin Ghost Footprint),
    //    and dragging back onto the home spot cancels cleanly for 0 moves spent!
    const dragCoords = await page.evaluate(() => {
      // Level 2 Block 1 ('1x2' at col 1, row 1) has open cells at (1, 3) and (1, 4) to slide right and return
      const b = window.__SHREDBLOCKS_DEBUG__
        .getBoard()
        .blocks.find((blk) => blk.status === 'ACTIVE' && blk.id === 1);
      if (!b) throw new Error('Expected movable Block 1 on Level 2');
      return {
        home: window.__SHREDBLOCKS_DEBUG__.boardToScreen(b.col + 0.5, b.row + 0.5),
        away: window.__SHREDBLOCKS_DEBUG__.boardToScreen(b.col + 2.0 + 0.5, b.row + 0.5),
        initialMovesRem: window.__SHREDBLOCKS_DEBUG__.getBoard().movesRemaining,
      };
    });

    await page.mouse.move(dragCoords.home.x, dragCoords.home.y);
    await page.mouse.down();
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getHoverState().dragLeftOrigin)).toBe(
      false
    );

    await page.mouse.move(dragCoords.away.x, dragCoords.away.y, { steps: 6 });
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getHoverState().dragLeftOrigin)).toBe(true);

    // Return block back onto its origin footprint and release -> 0 moves spent, 0 path traces spawned!
    await page.mouse.move(dragCoords.home.x, dragCoords.home.y, { steps: 6 });
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getHoverState().dragLeftOrigin)).toBe(true);
    await page.mouse.up();

    const afterCancel = await page.evaluate(() => ({
      movesCommitted: window.__SHREDBLOCKS_DEBUG__.getBoard().movesCommitted,
      movesRemaining: window.__SHREDBLOCKS_DEBUG__.getBoard().movesRemaining,
      traces: window.__SHREDBLOCKS_DEBUG__.getActivePathTraceCount(),
    }));
    expect(afterCancel).toEqual({
      movesCommitted: 0,
      movesRemaining: dragCoords.initialMovesRem,
      traces: 0,
    });

    // 2. Committing a real slide move AND a shred move spawns Block Motion-Blur Path Traces that fade after 0.50s
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.freezeTime(1.0));
    await page.mouse.move(dragCoords.home.x, dragCoords.home.y);
    await page.mouse.down();
    await page.mouse.move(dragCoords.away.x, dragCoords.away.y, { steps: 6 });
    await page.mouse.up();

    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getActivePathTraceCount())).toBe(1);

    // Step 10 frames (~0.167s) -> still visible mid-flourish (also exercises Colorblind + High Contrast render path!)
    await page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setColorblindMode(true);
      window.__SHREDBLOCKS_DEBUG__.setHighContrast(true);
      window.__SHREDBLOCKS_DEBUG__.advanceFrozenFrames(10, 1 / 60);
    });
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getActivePathTraceCount())).toBe(1);

    // Step 24 more frames (~0.567s total > 0.50s maxAge) -> trace has completely faded & been removed
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.advanceFrozenFrames(24, 1 / 60));
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getActivePathTraceCount())).toBe(0);

    // Shredding a block into its exit gate also emits a Mystic Fissure Path Trace extending into the gate
    await page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.loadLevel(2);
      window.__SHREDBLOCKS_DEBUG__.freezeTime(1.0);
      window.__SHREDBLOCKS_DEBUG__.commitMove(1, 0, 1); // Shreds Block 1 out TOP gate
    });
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getActivePathTraceCount())).toBe(1);

    // 3. Reduced Motion immediately suppresses and clears any Mystic Path Traces
    await page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setColorblindMode(false);
      window.__SHREDBLOCKS_DEBUG__.setHighContrast(false);
      window.__SHREDBLOCKS_DEBUG__.setReducedMotion(true);
      window.__SHREDBLOCKS_DEBUG__.advanceFrozenFrames(1, 1 / 60);
      window.__SHREDBLOCKS_DEBUG__.commitMove(3, 3, 2); // Valid slide move under Reduced Motion
    });
    expect(await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.getActivePathTraceCount())).toBe(0);

    // 4. Verify 60Hz/120Hz frame budget holds effortlessly while rendering active path traces
    const bench = await page.evaluate(async () => {
      window.__SHREDBLOCKS_DEBUG__.freezeTime(null);
      window.__SHREDBLOCKS_DEBUG__.setReducedMotion(false);
      window.__SHREDBLOCKS_DEBUG__.loadLevel(25);
      window.__SHREDBLOCKS_DEBUG__.activateBooster('HINT');
      const hint = window.__SHREDBLOCKS_DEBUG__.getBoard().hintMove;
      if (hint) {
        window.__SHREDBLOCKS_DEBUG__.commitMove(hint.blockId, hint.targetRow, hint.targetCol);
      }
      return window.__SHREDBLOCKS_DEBUG__.run120HzBenchmark(40);
    });
    expect(bench.passes60HzBudget).toBe(true);

    expect(errors).toEqual([]);
  });

  test('Responsive hint, helper, and booster targeting banners stay symmetrically centered without diagonal wrapping across viewports', async ({
    page,
  }) => {
    await bootIntoGameLevel(page, 28);

    // 1. Mobile Portrait (430x932 & 360x740): Rocket, Hammer, Vacuum stack symmetrically around the banner's center axis
    for (const vp of [
      { width: 430, height: 932 },
      { width: 360, height: 740 },
    ]) {
      await page.setViewportSize(vp);
      await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(28));

      // Onboarding #unlock-toast is centered within viewport with centered text
      await expect(page.locator('#unlock-toast')).toBeVisible();
      const unlockGeom = await page.evaluate(() => {
        const el = document.getElementById('unlock-toast');
        if (!el) throw new Error('Missing #unlock-toast');
        const r = el.getBoundingClientRect();
        return {
          centerX: r.left + r.width / 2,
          left: r.left,
          right: r.right,
          textAlign: getComputedStyle(el).textAlign,
          vw: window.innerWidth,
        };
      });
      expect(Math.abs(unlockGeom.centerX - vp.width / 2)).toBeLessThanOrEqual(3);
      expect(unlockGeom.left).toBeGreaterThanOrEqual(4);
      expect(unlockGeom.right).toBeLessThanOrEqual(vp.width - 4);
      expect(unlockGeom.textAlign).toBe('center');

      for (const boosterBtn of ['#btn-booster-rocket', '#btn-booster-hammer', '#btn-booster-vacuum']) {
        await page.locator(boosterBtn).click();
        await expect(page.locator('#booster-target-banner')).toBeVisible();
        const geom = await page.evaluate(() => {
          const banner = document.getElementById('booster-target-banner');
          const instr = document.getElementById('booster-target-text');
          const actions = banner?.querySelector<HTMLElement>('.target-actions');
          if (!banner || !instr || !actions) throw new Error('Missing targeting banner elements');
          const b = banner.getBoundingClientRect();
          const i = instr.getBoundingClientRect();
          const a = actions.getBoundingClientRect();
          return {
            bannerCenterX: b.left + b.width / 2,
            instrCenterX: i.left + i.width / 2,
            actionsCenterX: a.left + a.width / 2,
            bannerLeft: b.left,
            bannerRight: b.right,
            actionsTop: a.top,
            instrBottom: i.bottom,
          };
        });
        expect(Math.abs(geom.bannerCenterX - vp.width / 2)).toBeLessThanOrEqual(3);
        expect(Math.abs(geom.instrCenterX - geom.bannerCenterX)).toBeLessThanOrEqual(3);
        expect(Math.abs(geom.actionsCenterX - geom.bannerCenterX)).toBeLessThanOrEqual(3);
        expect(geom.actionsTop).toBeGreaterThanOrEqual(geom.instrBottom - 2);
        expect(geom.bannerLeft).toBeGreaterThanOrEqual(4);
        expect(geom.bannerRight).toBeLessThanOrEqual(vp.width - 4);
        await page.locator('#btn-cancel-booster').click();
        await expect(page.locator('#booster-target-banner')).toBeHidden();
      }
    }

    // 2. Desktop (1280x800) & Mobile Landscape (844x390): Rocket targeting banner sits on a single shrink-wrapped centered row
    for (const vp of [
      { width: 1280, height: 800 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(vp);
      await page.locator('#btn-booster-rocket').click();
      await expect(page.locator('#booster-target-banner')).toBeVisible();
      const rowGeom = await page.evaluate(() => {
        const banner = document.getElementById('booster-target-banner');
        const instr = document.getElementById('booster-target-text');
        const actions = banner?.querySelector<HTMLElement>('.target-actions');
        if (!banner || !instr || !actions) throw new Error('Missing targeting banner elements');
        const b = banner.getBoundingClientRect();
        const i = instr.getBoundingClientRect();
        const a = actions.getBoundingClientRect();
        return {
          bannerCenterX: b.left + b.width / 2,
          bannerWidth: b.width,
          instrCenterY: i.top + i.height / 2,
          actionsCenterY: a.top + a.height / 2,
        };
      });
      expect(Math.abs(rowGeom.bannerCenterX - vp.width / 2)).toBeLessThanOrEqual(3);
      expect(Math.abs(rowGeom.instrCenterY - rowGeom.actionsCenterY)).toBeLessThanOrEqual(6);
      expect(rowGeom.bannerWidth).toBeLessThan(600);
      await page.locator('#btn-cancel-booster').click();
    }
  });

  test('CORNER-INSET-01: restores native sharp corner radii, removes phantom bottom gaps, and balances 4-edge perimeter clearance', async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const readCornerRadii = (elId: string) =>
      page.evaluate((id) => {
        const el = document.getElementById(id);
        if (!el) throw new Error(`Missing #${id}`);
        const cs = window.getComputedStyle(el);
        return {
          tl: Number.parseFloat(cs.borderTopLeftRadius),
          tr: Number.parseFloat(cs.borderTopRightRadius),
          br: Number.parseFloat(cs.borderBottomRightRadius),
          bl: Number.parseFloat(cs.borderBottomLeftRadius),
        };
      }, elId);

    const readBarPadding = (selector: string) =>
      page.evaluate((sel) => {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) throw new Error(`Missing ${sel}`);
        const cs = window.getComputedStyle(el);
        return {
          top: Number.parseFloat(cs.paddingTop),
          bottom: Number.parseFloat(cs.paddingBottom),
          left: Number.parseFloat(cs.paddingLeft),
          right: Number.parseFloat(cs.paddingRight),
        };
      }, selector);

    const measureEdgeClearance = (
      selector: string,
      topLeftSel: string,
      topRightSel: string,
      bottomLeftSel: string,
      bottomRightSel: string
    ) =>
      page.evaluate(
        ([sel, tlSel, trSel, blSel, brSel]) => {
          const vw = document.documentElement.clientWidth;
          const scrollW = document.documentElement.scrollWidth;
          const rectOf = (q: string) => {
            const node = document.querySelector<HTMLElement>(`${sel} ${q}`);
            if (!node) throw new Error(`Missing ${sel} ${q}`);
            const r = node.getBoundingClientRect();
            return { left: r.left, right: vw - r.right };
          };
          const tl = rectOf(tlSel);
          const tr = rectOf(trSel);
          const bl = document.querySelector<HTMLElement>(blSel)?.getBoundingClientRect();
          const br = document.querySelector<HTMLElement>(brSel)?.getBoundingClientRect();
          if (!bl || !br) throw new Error(`Missing bottom corner selector ${blSel} / ${brSel}`);
          return {
            overflowX: scrollW - vw,
            tlLeft: Math.round(tl.left * 10) / 10,
            trRight: Math.round(tr.right * 10) / 10,
            blLeft: Math.round(bl.left * 10) / 10,
            brRight: Math.round((vw - br.right) * 10) / 10,
          };
        },
        [selector, topLeftSel, topRightSel, bottomLeftSel, bottomRightSel]
      );

    await bootIntoGameLevel(page, 12);

    // Force standalone mode attribute too, confirming uniform native radii & zero phantom bottom padding
    await page.evaluate(() => {
      const shell = document.getElementById('app-shell');
      if (shell) shell.dataset.standalone = 'true';
    });

    // Uniform native architectural radii even under standalone + touch
    expect(await readCornerRadii('btn-booster-undo')).toEqual({ tl: 6, tr: 6, br: 6, bl: 6 });
    expect(await readCornerRadii('btn-booster-vacuum')).toEqual({ tl: 6, tr: 6, br: 6, bl: 6 });
    expect(await readCornerRadii('badge-booster-undo')).toEqual({ tl: 3, tr: 3, br: 3, bl: 3 });
    expect(await readCornerRadii('badge-booster-vacuum')).toEqual({ tl: 3, tr: 3, br: 3, bl: 3 });

    const dockPad = await readBarPadding('.booster-dock');
    expect(dockPad.bottom).toBeLessThanOrEqual(8.5);
    expect(Math.abs(dockPad.bottom - dockPad.top)).toBeLessThanOrEqual(2);
    expect(Math.abs(dockPad.left - dockPad.bottom)).toBeLessThanOrEqual(3.5);

    await page.locator('#btn-hud-home').click();
    await expect(page.locator('#screen-home')).toBeVisible();
    expect(await readCornerRadii('tab-btn-home')).toEqual({ tl: 4, tr: 4, br: 4, bl: 4 });
    expect(await readCornerRadii('tab-btn-settings')).toEqual({ tl: 4, tr: 4, br: 4, bl: 4 });

    const tabBarPad = await readBarPadding('#menu-tab-bar');
    expect(tabBarPad.bottom).toBeLessThanOrEqual(8.5);
    expect(Math.abs(tabBarPad.bottom - tabBarPad.top)).toBeLessThanOrEqual(2);
    expect(Math.abs(tabBarPad.left - tabBarPad.bottom)).toBeLessThanOrEqual(3.5);

    const viewportsToAudit =
      testInfo.project.name === 'desktop-chrome'
        ? [
            { width: 472, height: 1024, minInset: 7.5, maxInset: 10.5, checkGame: true },
            { width: 390, height: 844, minInset: 7.5, maxInset: 10.5, checkGame: true },
            { width: 375, height: 812, minInset: 7.5, maxInset: 10.5, checkGame: true },
            { width: 320, height: 568, minInset: 7.5, maxInset: 10.5, checkGame: true },
            { width: 844, height: 390, minInset: 7.5, maxInset: 10.5, checkGame: false },
          ]
        : [
            { width: 390, height: 844, minInset: 7.5, maxInset: 10.5, checkGame: true },
            { width: 472, height: 1024, minInset: 7.5, maxInset: 10.5, checkGame: true },
            { width: 320, height: 568, minInset: 7.5, maxInset: 10.5, checkGame: true },
            { width: 844, height: 390, minInset: 7.5, maxInset: 10.5, checkGame: false },
          ];

    for (const vp of viewportsToAudit) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await expect(page.locator('#screen-home')).toBeVisible();
      const homeTabPad = await readBarPadding('#menu-tab-bar');
      expect(homeTabPad.bottom).toBeLessThanOrEqual(8.5);

      const plumbLine = await page.evaluate(() => {
        const stripEl = document.querySelector<HTMLElement>('#screen-home .home-global-strip .chests-row');
        const shellEl = document.querySelector<HTMLElement>('#screen-home .mode-sanctuary-panel');
        if (!stripEl || !shellEl) throw new Error('Missing home plumb-line elements');
        return {
          stripLeft: stripEl.getBoundingClientRect().left,
          shellLeft: shellEl.getBoundingClientRect().left,
        };
      });
      expect(Math.abs(plumbLine.stripLeft - homeTabPad.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(plumbLine.shellLeft - homeTabPad.left)).toBeLessThanOrEqual(1);

      const homeClearance = await measureEdgeClearance(
        '#screen-home .top-economy-bar',
        '#btn-home-title',
        '.economy-pills',
        '#tab-btn-home',
        '#tab-btn-settings'
      );
      expect(homeClearance.overflowX).toBeLessThanOrEqual(0);
      expect(homeClearance.tlLeft).toBeGreaterThanOrEqual(vp.minInset);
      expect(homeClearance.tlLeft).toBeLessThanOrEqual(vp.maxInset);
      expect(homeClearance.trRight).toBeGreaterThanOrEqual(vp.minInset);
      expect(homeClearance.trRight).toBeLessThanOrEqual(vp.maxInset);
      expect(homeClearance.blLeft).toBeGreaterThanOrEqual(vp.minInset);
      expect(homeClearance.blLeft).toBeLessThanOrEqual(vp.maxInset);
      expect(homeClearance.brRight).toBeGreaterThanOrEqual(vp.minInset);
      expect(homeClearance.brRight).toBeLessThanOrEqual(vp.maxInset);

      if (vp.checkGame) {
        await page.locator('#tab-btn-play').click();
        await expect(page.locator('#screen-game')).toBeVisible();
        expect(await readCornerRadii('btn-booster-undo')).toEqual({ tl: 6, tr: 6, br: 6, bl: 6 });
        expect(await readCornerRadii('btn-booster-vacuum')).toEqual({ tl: 6, tr: 6, br: 6, bl: 6 });

        const gameDockPad = await readBarPadding('.booster-dock');
        expect(gameDockPad.bottom).toBeLessThanOrEqual(8.5);
        expect(Math.abs(gameDockPad.left - gameDockPad.bottom)).toBeLessThanOrEqual(3.5);

        const gameClearance = await measureEdgeClearance(
          '#screen-game .hud-top-bar',
          '#btn-hud-home',
          '#btn-restart',
          '#btn-booster-undo',
          '#btn-booster-vacuum'
        );
        expect(gameClearance.overflowX).toBeLessThanOrEqual(0);
        expect(gameClearance.tlLeft).toBeGreaterThanOrEqual(vp.minInset);
        expect(gameClearance.tlLeft).toBeLessThanOrEqual(vp.maxInset);
        expect(gameClearance.trRight).toBeGreaterThanOrEqual(vp.minInset);
        expect(gameClearance.trRight).toBeLessThanOrEqual(vp.maxInset);
        expect(gameClearance.blLeft).toBeGreaterThanOrEqual(vp.minInset);
        expect(gameClearance.blLeft).toBeLessThanOrEqual(vp.maxInset);
        expect(gameClearance.brRight).toBeGreaterThanOrEqual(vp.minInset);
        expect(gameClearance.brRight).toBeLessThanOrEqual(vp.maxInset);

        await page.locator('#btn-hud-home').click();
        await expect(page.locator('#screen-home')).toBeVisible();
      }
    }

    expect(errors).toEqual([]);
  });

  test('HUD Keystone (HUD-KEYSTONE-01): Challenge/Timed/Zen & conditional controls', async ({ page }) => {
    const chk = () =>
      page.evaluate(() => ({
        ov: document.documentElement.scrollWidth - window.innerWidth,
        tw: document.getElementById('hud-level-title')?.getBoundingClientRect().width ?? 0,
        bh: document.querySelector('#screen-game .hud-top-bar')?.getBoundingClientRect().height ?? 999,
      }));
    const setRushTime = (sec: number) =>
      page.evaluate((s) => {
        const dbg = window.__SHREDBLOCKS_DEBUG__;
        dbg.freezeTime(1.0);
        Object.assign(dbg.getBoard(), { timerRunning: true, movesCommitted: 1, timeRemainingSec: s });
        dbg.syncHud();
      }, sec);
    await page.setViewportSize({ width: 320, height: 568 });
    await bootIntoGameLevel(page, 1);
    await expect(page.locator('#hud-moves-value')).toHaveText('8');
    await expect(page.locator('#hud-keystone-info')).toBeVisible();
    expect((await chk()).ov).toBeLessThanOrEqual(0);
    await page.locator('#hud-keystone-info').click();
    await expect(page.locator('#game-toast')).toContainText('Challenge');
    await expect(page.locator('#hud-mode-label')).toContainText('Challenge');
    await page.locator('#btn-mode-next').click();
    await expect(page.locator('#app-shell')).toHaveAttribute('data-hud-urgency', 'calm');
    await expect(page.locator('#hud-moves-value')).toHaveText('∞');
    await expect(page.locator('#hud-keystone-stars')).toContainText('Calm Flow');
    await page.locator('#btn-mode-next').click();
    await expect(page.locator('#hud-timer-pill')).toBeVisible();
    await setRushTime(12);
    await expect(page.locator('#app-shell')).toHaveAttribute('data-hud-urgency', 'warn');
    await setRushTime(4);
    await expect(page.locator('#app-shell')).toHaveAttribute('data-hud-urgency', 'critical');
    await page.setViewportSize({ width: 667, height: 375 });
    expect((await chk()).bh).toBeLessThanOrEqual(58);
    // Conditional Zen Skip + 99,999 coins + SUPER_HARD + Rocket banner + Map Install & LAN DevTools
    await page.locator('#btn-mode-prev').click();
    await page.evaluate(() => {
      const dbg = window.__SHREDBLOCKS_DEBUG__;
      dbg.patchSave({ coins: 99999 });
      dbg.loadLevel(29);
      dbg.getBoard().difficulty = 'SUPER_HARD';
      dbg.syncHud();
    });
    await page.locator('#btn-booster-rocket').click();
    await expect(page.locator('#btn-rocket-axis')).toBeVisible();
    for (const width of [320, 375, 667]) {
      await page.setViewportSize({ width, height: width === 667 ? 375 : width === 375 ? 667 : 568 });
      const m = await chk();
      expect(m.ov).toBeLessThanOrEqual(0);
      expect(m.tw).toBeGreaterThanOrEqual(64);
      if (width === 667) expect(m.bh).toBeLessThanOrEqual(58);
    }
    await page.locator('#btn-cancel-booster').click();
    await page.locator('#btn-hud-home').click();
    await page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.patchSave({ coins: 99999, totalStars: 2700, winStreak: 150 });
      const ev = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: async () => {},
        userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
      });
      window.dispatchEvent(ev);
    });
    await expect(page.locator('#btn-install-header')).toBeVisible();
    await expect(page.locator('#btn-lan-unlock-home')).toHaveCount(0);
    const checkSingleLineBar = (screenId: string) =>
      page.evaluate((sid) => {
        const bar = document.querySelector(`#${sid} > .top-economy-bar`);
        const children = Array.from(bar?.children ?? []).filter(
          (el) => getComputedStyle(el).display !== 'none'
        );
        const centers = children.map((el) => {
          const r = el.getBoundingClientRect();
          return r.top + r.height * 0.5;
        });
        const maxDeltaY = centers.length > 1 ? Math.max(...centers) - Math.min(...centers) : 0;
        return {
          ov: document.documentElement.scrollWidth - window.innerWidth,
          bh: bar?.getBoundingClientRect().height ?? 999,
          maxDeltaY,
        };
      }, screenId);
    for (const width of [320, 360, 390]) {
      await page.setViewportSize({ width, height: 640 });
      const homeBar = await checkSingleLineBar('screen-home');
      expect(homeBar.ov).toBeLessThanOrEqual(0);
      expect(homeBar.bh).toBeLessThanOrEqual(48);
      expect(homeBar.maxDeltaY).toBeLessThanOrEqual(6);
    }
    await page.locator('#tab-btn-play').click();
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(299));
    await page.locator('#btn-pause').click();
    await page.locator('#btn-toggle-cosmetics-drawer').click();
    await page.locator('#btn-pause-open-themes').click();
    await expect(page.locator('#btn-themes-resume-game')).toBeVisible();
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 640 });
      const themesBar = await checkSingleLineBar('screen-themes');
      expect(themesBar.ov).toBeLessThanOrEqual(0);
      expect(themesBar.bh).toBeLessThanOrEqual(54);
      expect(themesBar.maxDeltaY).toBeLessThanOrEqual(6);
    }
  });

  test('FLOOR-PATH-01 & TAP-TOAST-01: Level 176 floor-path tap & drag-collision toasts, glued-group frozen partner tap, and Stone block lock/ice toasts', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await bootIntoGameLevel(page, 176);

    // 1. Direct tap on the exposed Royal Purple Floor Path at (row: 4, col: 3)
    const fpPt = await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.boardToScreen(3.5, 4.5));
    await page.mouse.click(fpPt.x, fpPt.y);
    const toast = page.locator('#game-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Royal Purple Floor Path');
    await expect(toast).toContainText('only Royal Purple blocks can cross');

    // 2. Drag Orange Block 3 at (row: 4, col: 4) leftward into the Royal Purple Floor Path
    const b3Start = await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.boardToScreen(4.5, 4.5));
    await page.mouse.move(b3Start.x, b3Start.y);
    await page.mouse.down();
    await page.mouse.move(fpPt.x, fpPt.y, { steps: 6 });
    await expect(toast).toContainText('Royal Purple Floor Path');
    await page.mouse.up();
    const b3Col = await page.evaluate(
      () => window.__SHREDBLOCKS_DEBUG__.getBoard().blocks.find((b) => b.id === 3)?.col ?? -1
    );
    expect(b3Col).toBe(4);

    // 3. Tapping the un-iced half (Block 2 at r=0, c=2) of a glued pair with frozen Block 9 shows Frozen toast
    await page.evaluate(() => {
      const board = window.__SHREDBLOCKS_DEBUG__.getBoard();
      const b2 = board.blocks.find((b) => b.id === 2);
      const b9 = board.blocks.find((b) => b.id === 9);
      if (!b2 || !b9) throw new Error('Expected blocks 2 and 9 on Level 176');
      b2.groupId = 77;
      b9.groupId = 77;
      b2.iceCount = 0;
      b9.iceCount = 2;
    });
    const b2Pt = await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.boardToScreen(2.5, 0.5));
    await page.mouse.click(b2Pt.x, b2Pt.y);
    await expect(toast).toContainText('Frozen!');

    // 4. Neutral Stone slider (color 0) immobilized by ice or chain shows accurate blocker toast (not permanent obstacle)
    await page.evaluate(() => {
      const board = window.__SHREDBLOCKS_DEBUG__.getBoard();
      const b2 = board.blocks.find((b) => b.id === 2);
      const b9 = board.blocks.find((b) => b.id === 9);
      if (!b2 || !b9) throw new Error('Expected blocks 2 and 9');
      b2.groupId = 0;
      b9.groupId = 0;
      b9.iceCount = 0;
      b2.colorStack = [0];
      b2.colorCursor = 0;
      b2.iceCount = 1;
      b2.chained = false;
    });
    await page.mouse.click(b2Pt.x, b2Pt.y);
    await expect(toast).toContainText('Frozen!');
    await expect(toast).not.toContainText('permanent obstacle');

    await page.evaluate(() => {
      const b2 = window.__SHREDBLOCKS_DEBUG__.getBoard().blocks.find((b) => b.id === 2);
      if (!b2) throw new Error('Expected block 2');
      b2.iceCount = 0;
      b2.chained = true;
    });
    await page.mouse.click(b2Pt.x, b2Pt.y);
    await expect(toast).toContainText('Chained!');

    expect(errors).toEqual([]);
  });
});
