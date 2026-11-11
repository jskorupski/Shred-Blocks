import { expect, type Page, test } from '@playwright/test';

/**
 * Golden Screenshot Regression Suite (`VISUAL-GOLDEN-01`).
 *
 * Determinism contract (every capture):
 * - Fixed save payload, pinned `ULTRA_120` quality tier, service workers blocked, fonts awaited.
 * - `freezeTime(t)` halts the rAF loop, clears in-flight particles/shockwaves, and renders at a fixed shader time,
 *   so the living crack pulses, idle breathing, and gate rollers are pixel-stable.
 * - `setFxRandomSeed(n)` makes cosmetic bursts (relic awakening shards/smoke/embers) repeatable.
 * - CSS animations are disabled by `toHaveScreenshot`; transient toasts are hidden.
 *
 * Update intended changes with `npm run test:visual:update` and review the PNG diffs before committing.
 */

type SkinId = 'classic_studs' | 'relic_stone' | 'gummy_jelly' | 'carved_wood' | 'neon_cyber';
type TrayId = 'industrial_slate' | 'warm_birch' | 'midnight_arcade' | 'frosted_quartz' | 'mint_studio';

function buildSave(levelId: number, tray: TrayId, skin: SkinId, extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    appId: 'shredblocks-color-jam',
    writeSeq: 5,
    updatedAt: 1_760_000_000_000,
    highestLevelUnlocked: Math.max(levelId, 80),
    currentLevelId: levelId,
    coins: 450,
    totalStars: 48,
    winStreak: 3,
    bestWinStreak: 5,
    totalBlocksShredded: 140,
    totalMovesCommitted: 220,
    shredderChestProgress: 40,
    milestoneChestLevel: 20,
    starReliquaryLevel: 25,
    economyVersion: 2,
    boosters: { UNDO: 3, FREEZE: 2, HAMMER: 1, ROCKET: 1, VACUUM: 1 },
    unlockedSkins: ['classic_studs', 'relic_stone', 'gummy_jelly', 'carved_wood', 'neon_cyber'],
    unlockedTrays: ['industrial_slate', 'warm_birch', 'midnight_arcade', 'frosted_quartz', 'mint_studio'],
    unlockedParticles: ['micro_cubes', 'star_confetti', 'pixel_sparks', 'soap_bubbles', 'lightning_bolts'],
    equippedSkin: skin,
    equippedTray: tray,
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
    levelRecords: {
      1: { stars: 3, bestMoves: 3, bestTimeSec: 20 },
      2: { stars: 2, bestMoves: 5, bestTimeSec: 30 },
    },
    ...extra,
  };
}

const HIDE_TRANSIENTS = `
  #game-toast, #unlock-toast, #pwa-update-toast { visibility: hidden !important; }
`;

async function boot(page: Page, save: object | null): Promise<void> {
  if (save) {
    await page.addInitScript(
      (raw) => window.localStorage.setItem('shredblocks.save.v1', raw),
      JSON.stringify(save)
    );
  }
  await page.goto('/');
  await expect(page.locator('#title-overlay')).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.__SHREDBLOCKS_DEBUG__.setQualityTier('ULTRA_120');
    window.__SHREDBLOCKS_DEBUG__.setFxRandomSeed(1337);
  });
  await page.addStyleTag({ content: HIDE_TRANSIENTS });
}

async function freezeAndCapture(page: Page, name: string, timeSec = 2.0): Promise<void> {
  await page.evaluate((t) => window.__SHREDBLOCKS_DEBUG__.freezeTime(t), timeSec);
  // Two rAF ticks so the compositor has presented the frozen WebGL frame
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(page).toHaveScreenshot(`${name}.png`);
}

async function enterLevel(page: Page, levelId: number): Promise<void> {
  await page.evaluate((id) => {
    window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('game', false);
    window.__SHREDBLOCKS_DEBUG__.loadLevel(id);
  }, levelId);
  await expect(page.locator('#screen-game')).toBeVisible();
}

const desktopToo = new Set([
  'title-returning-slate-l25',
  'home-map',
  'game-l74-midnight',
  'relic-awakening-burst',
]);

test.beforeEach(async ({ page }, testInfo) => {
  void page;
  const captureName = testInfo.title.split(' ')[0];
  test.skip(
    testInfo.project.name === 'golden-desktop' && !desktopToo.has(captureName),
    'Desktop goldens cover a representative subset only'
  );
});

test('title-new-player — fresh FTUE title over the Level 1 astrolabe board', async ({ page }) => {
  await boot(page, null);
  await freezeAndCapture(page, 'title-new-player');
});

test('title-returning-slate-l25 — returning player, Industrial Slate astrolabe tint', async ({ page }) => {
  await boot(page, buildSave(25, 'industrial_slate', 'classic_studs'));
  await freezeAndCapture(page, 'title-returning-slate-l25');
});

test('title-returning-birch-l74 — warm bronze-amber astrolabe tint on a tall quad-vault board', async ({
  page,
}) => {
  await boot(page, buildSave(74, 'warm_birch', 'carved_wood'));
  await freezeAndCapture(page, 'title-returning-birch-l74', 3.3);
});

test('relic-awakening-burst — seeded mid-burst frame of the astrolabe-shatter transition', async ({
  page,
}) => {
  await boot(page, buildSave(25, 'industrial_slate', 'classic_studs'));
  await page.evaluate(() => {
    const dbg = window.__SHREDBLOCKS_DEBUG__;
    dbg.freezeTime(2.0);
    dbg.setFxRandomSeed(1337);
    dbg.dismissTitleScreen('game', true);
    dbg.advanceFrozenFrames(9, 1 / 60);
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(page).toHaveScreenshot('relic-awakening-burst.png');
});

test('home-map — Grouped Linked Sanctuary Map', async ({ page }) => {
  await boot(page, buildSave(25, 'industrial_slate', 'classic_studs'));
  await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('home', false));
  await expect(page.locator('#screen-home')).toBeVisible();
  await freezeAndCapture(page, 'home-map');
});

test('game-l1-slate — FTUE board: default Classic Studs blocks on Industrial Slate', async ({ page }) => {
  await boot(page, buildSave(1, 'industrial_slate', 'classic_studs'));
  await enterLevel(page, 1);
  await freezeAndCapture(page, 'game-l1-slate', 1.0);
});

test('game-l25-relic-stone — Relic Stone worn aged rune skin on Industrial Slate', async ({ page }) => {
  await boot(page, buildSave(25, 'industrial_slate', 'relic_stone'));
  await enterLevel(page, 25);
  await freezeAndCapture(page, 'game-l25-relic-stone', 1.0);
});

test('game-l25-birch — multi-room sanctum on sandstone with carved wood blocks', async ({ page }) => {
  await boot(page, buildSave(25, 'warm_birch', 'carved_wood'));
  await enterLevel(page, 25);
  await freezeAndCapture(page, 'game-l25-birch', 1.0);
});

test('game-l28-vault-mint — sealed mystery vault on Mint Studio', async ({ page }) => {
  await boot(page, buildSave(28, 'mint_studio', 'gummy_jelly'));
  await enterLevel(page, 28);
  await freezeAndCapture(page, 'game-l28-vault-mint', 1.0);
});

test('game-l74-midnight — tall quad-vault board on Midnight Arcade with Neon Cyber blocks', async ({
  page,
}) => {
  await boot(page, buildSave(74, 'midnight_arcade', 'neon_cyber'));
  await enterLevel(page, 74);
  await freezeAndCapture(page, 'game-l74-midnight', 1.0);
});

test('game-l74-hc-colorblind — High Contrast + Colorblind Symbols accessibility rendering', async ({
  page,
}) => {
  await boot(page, buildSave(74, 'frosted_quartz', 'relic_stone'));
  await enterLevel(page, 74);
  await page.evaluate(() => {
    window.__SHREDBLOCKS_DEBUG__.setHighContrast(true);
    window.__SHREDBLOCKS_DEBUG__.setColorblindMode(true);
  });
  await freezeAndCapture(page, 'game-l74-hc-colorblind', 1.0);
});

test('pause-settings — Sanctuary & Settings modal', async ({ page }) => {
  await boot(page, buildSave(25, 'industrial_slate', 'classic_studs'));
  await enterLevel(page, 25);
  await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.openModal('pause'));
  await expect(page.locator('#dialog-pause')).toBeVisible();
  await freezeAndCapture(page, 'pause-settings', 1.0);
});

test('victory-modal — Level 1 Gold-Star clear rewards', async ({ page }) => {
  await boot(page, buildSave(1, 'industrial_slate', 'classic_studs', { levelRecords: {} }));
  await enterLevel(page, 1);
  await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.autoSolveCurrentLevel());
  await expect(page.locator('#dialog-victory')).toBeVisible();
  await freezeAndCapture(page, 'victory-modal', 1.0);
});

test('failure-modal — Out of Moves after the free final touch', async ({ page }) => {
  await boot(page, buildSave(1, 'industrial_slate', 'classic_studs'));
  await enterLevel(page, 1);
  await page.evaluate(() => {
    const dbg = window.__SHREDBLOCKS_DEBUG__;
    const board = dbg.getBoard();
    board.movesRemaining = 1;
    const block = board.blocks.find((b) => b.col === 3 && b.row === 2);
    if (!block) throw new Error('Level 1 layout changed: expected a block at col 3, row 2');
    dbg.commitMove(block.id, 1, 3);
    dbg.commitMove(block.id, 1, 4);
  });
  await expect(page.locator('#dialog-failure')).toBeVisible();
  await freezeAndCapture(page, 'failure-modal', 1.0);
});
