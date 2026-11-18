import { expect, type Page, test } from '@playwright/test';

function buildReturningSaveJson(levelId: number, highestUnlocked = 60): string {
  return JSON.stringify({
    schemaVersion: 1,
    appId: 'shredblocks-color-jam',
    writeSeq: 12,
    updatedAt: 1_760_000_000_000,
    highestLevelUnlocked: highestUnlocked,
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
  });
}

async function seedAndOpenGame(page: Page, levelId: number, highestUnlocked = 60): Promise<void> {
  await page.addInitScript(
    (raw) => window.localStorage.setItem('shredblocks.save.v1', raw),
    buildReturningSaveJson(levelId, highestUnlocked)
  );
  await page.goto('/');
  await page.evaluate((id) => {
    window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('game', false);
    window.__SHREDBLOCKS_DEBUG__.loadLevel(id);
  }, levelId);
  await expect(page.locator('#screen-game')).toBeVisible();
}

test.describe('Booster Jewel Crests & Dynamic Multi-Digit CTA Geometry', () => {
  test('BOOSTER-JEWELS: #booster-dock stays monochromatic SVG sprites while toasts & targeting banners use matching faceted jewels', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await seedAndOpenGame(page, 18);

    const dockHrefs = await page
      .locator('#booster-dock svg use')
      .evaluateAll((els) => els.map((el) => el.getAttribute('href')));
    expect(dockHrefs).toEqual([
      '#icon-booster-undo',
      '#icon-booster-hint',
      '#icon-booster-hammer',
      '#icon-booster-rocket',
      '#icon-booster-vacuum',
    ]);
    const dockShadow = await page
      .locator('#booster-dock .booster-icon')
      .first()
      .evaluate((el) => getComputedStyle(el).boxShadow);
    expect(dockShadow).toBe('none');

    // Lightbulb Hint toast renders a boosted jewel SVG matching #icon-booster-hint
    await page.locator('#btn-booster-hint').click();
    const hintJewel = page.locator('#game-toast .inline-booster-icon[data-booster-glyph="HINT"]');
    await expect(hintJewel).toBeVisible();
    await expect(hintJewel.locator('svg path')).toHaveCount(4);

    // Hammer, Rocket, and Vacuum targeting banners render matching faceted jewels
    for (const [btn, glyph] of [
      ['#btn-booster-hammer', 'HAMMER'],
      ['#btn-booster-rocket', 'ROCKET'],
      ['#btn-booster-vacuum', 'VACUUM'],
    ] as const) {
      await page.locator(btn).click();
      await expect(
        page.locator(`#booster-target-text .inline-booster-icon[data-booster-glyph="${glyph}"] svg`)
      ).toBeVisible();
    }
    await page.locator('#btn-cancel-booster').click();

    // Commit the hinted move so movesCommitted > 0, then verify Restart surfaces Undo jewel crest
    const moved = await page.evaluate(() => {
      const dbg = window.__SHREDBLOCKS_DEBUG__;
      const h = dbg.getBoard().hintMove;
      if (!h) return false;
      return dbg.commitMove(h.blockId, h.targetRow, h.targetCol).moved;
    });
    expect(moved).toBe(true);
    await page.locator('#btn-restart').click();
    await expect(
      page.locator('#game-toast .inline-booster-icon[data-booster-glyph="UNDO"] svg')
    ).toBeVisible();

    // Compact passive Zen status headers use unboxed normal icons, while toast keeps glowing jewel
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.setPlayMode('ZEN'));
    const zenHeaderState = await page.evaluate(() => {
      const checkClean = (sel: string) => {
        const el = document.querySelector(`${sel} .inline-mode-icon[data-mode-glyph="ZEN"]`);
        if (!el?.querySelector('svg.mode-svg-icon')) return false;
        const cs = getComputedStyle(el);
        return cs.backgroundImage === 'none' && cs.boxShadow === 'none';
      };
      return {
        starsClean: checkClean('#hud-keystone-stars'),
        ruleClean: checkClean('#hud-keystone-rule'),
      };
    });
    expect(zenHeaderState).toEqual({ starsClean: true, ruleClean: true });

    await page.locator('#hud-keystone-info').click();
    const zenToastGlow = await page
      .locator('#game-toast .inline-mode-icon[data-mode-glyph="ZEN"]')
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return cs.backgroundImage !== 'none' && cs.boxShadow !== 'none';
      });
    expect(zenToastGlow).toBe(true);

    expect(errors).toEqual([]);
  });

  test('DYNAMIC-CTA-FIT: #tab-btn-play, mode folder tabs, and Themes resume CTA handle 2-to-5 digit levels cleanly on 393px & 320px viewports', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await seedAndOpenGame(page, 177, 100_000);
    const pt = await page.evaluate(() => {
      const bState = window.__SHREDBLOCKS_DEBUG__.getBoard();
      for (let r = bState.rows - 1; r >= 0; r--) {
        for (let c = 0; c < bState.cols; c++) {
          const idx = r * bState.cols + c;
          const bid = bState.occupancy[idx];
          if (bid > 0 && bState.roomMap[idx] === 0) {
            const blk = bState.blocks.find((x) => x.id === bid);
            if (blk && blk.status === 'ACTIVE' && !blk.chained && blk.iceCount === 0) {
              return window.__SHREDBLOCKS_DEBUG__.boardToScreen(c + 0.5, r + 0.5);
            }
          }
        }
      }
      throw new Error('Expected smashable block cell in open courtyard on L177');
    });
    await page.locator('#btn-booster-hammer').click();
    await page.mouse.click(pt.x, pt.y);

    for (const [vw, vh] of [
      [393, 852],
      [320, 568],
    ] as const) {
      await page.setViewportSize({ width: vw, height: vh });
      await page.locator('#btn-hud-home').click();
      await expect(page.locator('#screen-home')).toBeVisible();
      await expect(page.locator('#tab-play-label')).toHaveText('Resume #177');

      const fit = await page.evaluate(() => {
        const btn = document.getElementById('tab-btn-play');
        const lbl = document.getElementById('tab-play-label');
        if (!btn || !lbl) throw new Error('Missing nav play elements');
        const b = btn.getBoundingClientRect();
        const l = lbl.getBoundingClientRect();
        const tabClip = Array.from(document.querySelectorAll('.mode-tab-name')).some(
          (n) => n.scrollWidth > n.clientWidth + 1
        );
        return {
          overflow: btn.scrollWidth > btn.clientWidth + 1,
          padL: l.left - b.left,
          padR: b.right - l.right,
          tabClip,
          docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      });
      expect(fit.overflow).toBe(false);
      expect(fit.padL).toBeGreaterThanOrEqual(4);
      expect(fit.padR).toBeGreaterThanOrEqual(4);
      expect(fit.tabClip).toBe(false);
      expect(fit.docOverflow).toBe(false);

      await page.locator('#tab-btn-play').click();
      await expect(page.locator('#screen-game')).toBeVisible();
    }

    // Also verify Themes Studio mid-run Resume badge uses compact #177 ref
    await page.locator('#btn-pause').click();
    await page.locator('#btn-toggle-cosmetics-drawer').click();
    await page.locator('#btn-pause-open-themes').click();
    await expect(page.locator('#btn-themes-resume-game')).toHaveText('▶ Resume #177');

    // Verify 4-digit & 5-digit levels on ultra-compact 320px Map CTA without overflow
    await page.locator('#btn-themes-home').click();
    for (const bigLvl of [2501, 99_999]) {
      await page.evaluate((id) => {
        window.__SHREDBLOCKS_DEBUG__.loadLevel(id);
      }, bigLvl);
      await page.locator('#btn-hud-home').click();
      await expect(page.locator('#tab-play-label')).toHaveText(`Play #${bigLvl}`);
      const overflow320 = await page.evaluate(() => {
        const btn = document.getElementById('tab-btn-play');
        if (!btn) return true;
        return btn.scrollWidth > btn.clientWidth + 1;
      });
      expect(overflow320).toBe(false);
    }

    expect(errors).toEqual([]);
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

  test('OUTCOME-TRANSITION-01: #dialog-victory maintains constant 520px desktop width with zero scrollbar or scale flicker across every entrance frame', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedAndOpenGame(page, 1);
    await page.addStyleTag({
      content:
        'dialog::-webkit-scrollbar { width: 15px; height: 15px; } dialog::-webkit-scrollbar-thumb { background: #888; }',
    });
    const probe = await page.evaluate(async () => {
      const dlg = document.getElementById('dialog-victory') as HTMLDialogElement | null;
      const card = dlg?.querySelector<HTMLElement>('.victory-dialog-card') ?? null;
      if (!dlg || !card) throw new Error('Missing #dialog-victory elements');
      const frames: Array<{
        overflowY: string;
        dlgClientW: number;
        cardOffsetW: number;
        cardRectW: number;
      }> = [];
      const start = performance.now();
      window.__SHREDBLOCKS_DEBUG__.autoSolveCurrentLevel();
      await new Promise((resolve) => {
        const tick = () => {
          if (dlg.open) {
            frames.push({
              overflowY: getComputedStyle(dlg).overflowY,
              dlgClientW: dlg.clientWidth,
              cardOffsetW: card.offsetWidth,
              cardRectW: Math.round(card.getBoundingClientRect().width),
            });
          }
          if (performance.now() - start < 650) {
            requestAnimationFrame(tick);
          } else {
            resolve(null);
          }
        };
        requestAnimationFrame(tick);
      });
      return frames;
    });
    expect(probe.length).toBeGreaterThanOrEqual(5);
    for (const frame of probe) {
      expect(frame).toEqual({
        overflowY: 'visible',
        dlgClientW: 520,
        cardOffsetW: 520,
        cardRectW: 520,
      });
    }
  });

  test('PWA-UPDATE-01: clicking #btn-pwa-update-now reloads page for stale background-activated workers (macOS Chrome App) and suppressed controllerchange', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.addInitScript(
      (rawSave: string) => {
        if (!window.localStorage.getItem('shredblocks.save.v1')) {
          window.localStorage.setItem('shredblocks.save.v1', rawSave);
        }

        const makeWorker = (initialState: ServiceWorkerState, onSkip?: () => void) => {
          const target = new EventTarget() as EventTarget & {
            state: ServiceWorkerState;
            postMessage: (msg: unknown) => void;
            __setState: (s: ServiceWorkerState) => void;
          };
          target.state = initialState;
          target.postMessage = (msg: unknown) => {
            if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'SKIP_WAITING') {
              onSkip?.();
            }
          };
          target.__setState = (next: ServiceWorkerState) => {
            target.state = next;
            target.dispatchEvent(new Event('statechange'));
          };
          return target;
        };

        const v1 = makeWorker('activated');
        const v2 = makeWorker('installing');
        const v3 = makeWorker('installing', () => {
          window.sessionStorage.setItem('__skipWaitingPosted', '1');
          // Simulate a standalone window that activates cleanly without emitting controllerchange
          setTimeout(() => v3.__setState('activated'), 20);
        });

        const winApi = window as unknown as {
          __BOOT_ID__?: number;
          __SW_REG_BOUND__?: boolean;
          __EMIT_WAITING_WORKER__?: (which: 'v2' | 'v3') => void;
          __TRIGGER_BG_PROMOTION__?: () => void;
        };
        const bootCount = Number(window.sessionStorage.getItem('__pwaBootCount') || '0') + 1;
        window.sessionStorage.setItem('__pwaBootCount', String(bootCount));
        winApi.__BOOT_ID__ = bootCount;
        winApi.__SW_REG_BOUND__ = false;

        const reg = new EventTarget() as EventTarget & {
          installing: unknown;
          waiting: unknown;
          active: unknown;
          update: () => Promise<void>;
        };
        reg.installing = null;
        reg.waiting = null;
        reg.active = v1;
        reg.update = () => Promise.resolve();
        const origRegAdd = reg.addEventListener.bind(reg);
        reg.addEventListener = (
          type: string,
          listener: EventListenerOrEventListenerObject | null,
          opts?: boolean | AddEventListenerOptions
        ) => {
          origRegAdd(type, listener, opts);
          if (type === 'updatefound') {
            winApi.__SW_REG_BOUND__ = true;
          }
        };

        const swContainer = new EventTarget() as EventTarget & {
          controller: unknown;
          register: () => Promise<unknown>;
        };
        swContainer.controller = v1;
        swContainer.register = () => Promise.resolve(reg);

        Object.defineProperty(navigator, 'serviceWorker', {
          configurable: true,
          value: swContainer,
        });

        winApi.__EMIT_WAITING_WORKER__ = (which) => {
          const next = which === 'v2' ? v2 : v3;
          reg.installing = next;
          reg.dispatchEvent(new Event('updatefound'));
          reg.installing = null;
          reg.waiting = next;
          next.__setState('installed');
        };
        winApi.__TRIGGER_BG_PROMOTION__ = () => {
          reg.waiting = null;
          reg.active = v2;
          swContainer.controller = v2;
          v2.__setState('activated');
          swContainer.dispatchEvent(new Event('controllerchange'));
        };
      },
      buildReturningSaveJson(3, 5)
    );

    const waitForBootReady = async (expectedBootId: number) => {
      await page.waitForFunction((id) => {
        const w = window as unknown as {
          __SHREDBLOCKS_DEBUG__?: unknown;
          __BOOT_ID__?: number;
          __SW_REG_BOUND__?: boolean;
        };
        return Boolean(w.__SHREDBLOCKS_DEBUG__ && w.__BOOT_ID__ === id && w.__SW_REG_BOUND__);
      }, expectedBootId);
      await expect(page.locator('#title-overlay')).toBeVisible();
    };

    await page.goto('/');
    await waitForBootReady(1);
    await page.locator('#btn-title-map').click();
    await expect(page.locator('#screen-home')).toBeVisible();

    // 1. Install v2 -> promote v2 in the background (Chrome App sibling tab / sleep-wake) -> click Update must still reload
    await page.evaluate(() => {
      (window as unknown as { __EMIT_WAITING_WORKER__: (w: 'v2' | 'v3') => void }).__EMIT_WAITING_WORKER__(
        'v2'
      );
    });
    await expect(page.locator('#pwa-update-toast')).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { __TRIGGER_BG_PROMOTION__: () => void }).__TRIGGER_BG_PROMOTION__();
    });
    await expect(page.locator('#pwa-update-toast')).toBeVisible();

    await page.locator('#btn-pwa-update-now').click();
    await waitForBootReady(2);

    // 2. After reload, install v3 -> click Update posts SKIP_WAITING and reloads on statechange === 'activated' without controllerchange
    await page.locator('#btn-title-map').click();
    await expect(page.locator('#screen-home')).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __EMIT_WAITING_WORKER__: (w: 'v2' | 'v3') => void }).__EMIT_WAITING_WORKER__(
        'v3'
      );
    });
    await expect(page.locator('#pwa-update-toast')).toBeVisible();

    await page.locator('#btn-pwa-update-now').click();
    await waitForBootReady(3);
    const skipPosted = await page.evaluate(() => window.sessionStorage.getItem('__skipWaitingPosted'));
    expect(skipPosted).toBe('1');
    expect(errors).toEqual([]);
  });
});
