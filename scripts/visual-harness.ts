// @ts-expect-error Node built-in module resolved at runtime by tsx
import { spawn } from 'node:child_process';
// @ts-expect-error Node built-in module resolved at runtime by tsx
import { mkdirSync } from 'node:fs';
// @ts-expect-error Node built-in module resolved at runtime by tsx
import { join } from 'node:path';
import { type Browser, chromium } from '@playwright/test';

declare const process: {
  cwd: () => string;
  env: Record<string, string | undefined>;
  exit: (code: number) => void;
  on: (event: string, listener: () => void) => void;
};

// Output dir: override with VISUAL_OUT_DIR (e.g. an agent artifact scratch folder); defaults to test-results/visual
const ARTIFACT_SCRATCH_DIR = process.env.VISUAL_OUT_DIR ?? join(process.cwd(), 'test-results', 'visual');
const PORT = 4179;
const BASE_URL = `http://127.0.0.1:${PORT}`;

interface SpawnedProcess {
  pid?: number;
  killed: boolean;
  exitCode: number | null;
  kill: (sig?: string) => boolean;
  on: (event: string, cb: (code: number | null) => void) => void;
}

async function waitForServer(url: string, proc: SpawnedProcess, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (proc.exitCode !== null) {
      throw new Error(
        `Vite server exited prematurely with code ${proc.exitCode} (port ${PORT} bind blocked or in use)`
      );
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (err) {
      const causeCode = String(
        (err as { cause?: { code?: string }; code?: string })?.cause?.code ||
          (err as { code?: string })?.code ||
          err
      );
      if (causeCode.includes('EPERM') || causeCode.includes('EACCES')) {
        throw new Error(
          `Loopback socket blocked by macOS sandbox (${causeCode}). Run with BypassSandbox: true.`
        );
      }
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`Timed out waiting for Vite server at ${url}`);
}

async function runVisualHarness(): Promise<void> {
  mkdirSync(ARTIFACT_SCRATCH_DIR, { recursive: true });

  let serverProc: SpawnedProcess | null = null;
  let browser: Browser | null = null;

  const emergencyCleanup = () => {
    if (serverProc && serverProc.exitCode === null && !serverProc.killed) {
      try {
        serverProc.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
  };

  process.on('exit', emergencyCleanup);
  process.on('SIGINT', () => {
    emergencyCleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    emergencyCleanup();
    process.exit(143);
  });

  try {
    // Spawn ./node_modules/.bin/vite directly (no npx wrapper process) to prevent orphan processes
    serverProc = spawn(
      './node_modules/.bin/vite',
      ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
      {
        cwd: process.cwd(),
        stdio: 'ignore',
        detached: false,
      }
    ) as unknown as SpawnedProcess;

    await waitForServer(BASE_URL, serverProc);

    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
    });

    const errors: string[] = [];

    // =========================================================================
    // 1. STANDARD MOBILE PORTRAIT (390x844 @ 2x DPR — iPhone 14/15/16 Class)
    // =========================================================================
    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    const mobilePage = await mobileCtx.newPage();
    mobilePage.on('pageerror', (err) => errors.push(`MOBILE_PAGEERROR: ${err.message}`));
    mobilePage.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`MOBILE_CONSOLE_ERROR: ${msg.text()}`);
    });

    await mobilePage.goto(BASE_URL, { waitUntil: 'networkidle' });
    await mobilePage.waitForTimeout(150);

    // 00. Sacred-Geometry Title Screen — Brand-New Player FTUE (Mobile Portrait 390x844)
    await mobilePage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '00-title-screen-new-player-mobile.png'),
    });

    // 01. Home Roadmap (Mobile Portrait 390x844)
    await mobilePage.evaluate(() => window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('home'));
    await mobilePage.waitForTimeout(100);
    await mobilePage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '01-home-roadmap-mobile.png'),
    });

    // 02. Level 1 Gameplay (3D Perspective + Debut Banner)
    await mobilePage.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(1));
    await mobilePage.waitForTimeout(150);
    await mobilePage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '02-level-001-gameplay-mobile.png'),
    });

    // 03. Level 41 Gameplay (Frozen Ice Blocks)
    await mobilePage.evaluate(() => window.__SHREDBLOCKS_DEBUG__.loadLevel(41));
    await mobilePage.waitForTimeout(150);
    await mobilePage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '03-level-041-obstacles-mobile.png'),
    });

    // 04. Level 155 Gameplay (Stone Pillars + Colored Floor Paths + Timed Rush HUD)
    await mobilePage.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.loadLevel(155);
      window.__SHREDBLOCKS_DEBUG__.setPlayMode('TIMED');
    });
    await mobilePage.waitForTimeout(150);
    await mobilePage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '04-level-155-timed-rush-mobile.png'),
    });

    // 05. Colorblind Symbols + High Contrast Mode on Level 91 (Time-Bombs)
    await mobilePage.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setPlayMode('ZEN');
      window.__SHREDBLOCKS_DEBUG__.loadLevel(91);
      window.__SHREDBLOCKS_DEBUG__.setColorblindMode(true);
      window.__SHREDBLOCKS_DEBUG__.setHighContrast(true);
    });
    await mobilePage.waitForTimeout(150);
    await mobilePage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '05-level-091-colorblind-highcontrast.png'),
    });

    // 06. Booster Targeting Banner (Rocket Row/Col Toggle)
    await mobilePage.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setColorblindMode(false);
      window.__SHREDBLOCKS_DEBUG__.setHighContrast(false);
      window.__SHREDBLOCKS_DEBUG__.activateBooster('ROCKET');
    });
    await mobilePage.waitForTimeout(100);
    await mobilePage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '06-booster-targeting-rocket.png'),
    });

    // 07. Victory Modal on Level 1
    await mobilePage.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.loadLevel(1);
      window.__SHREDBLOCKS_DEBUG__.autoSolveCurrentLevel();
    });
    await mobilePage.waitForTimeout(150);
    await mobilePage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '07-dialog-victory-mobile.png'),
    });

    // 30. Sacred-Geometry Title Screen — Returning Player Flow (Mobile Portrait 390x844)
    await mobilePage.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.closeAllModals();
      window.__SHREDBLOCKS_DEBUG__.openTitleScreen();
    });
    await mobilePage.waitForTimeout(150);
    await mobilePage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '30-title-screen-returning-player-mobile.png'),
    });
    await mobilePage.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('game');
    });

    // 08. Failure / Retry Modal
    await mobilePage.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.closeAllModals();
      window.__SHREDBLOCKS_DEBUG__.openModal('failure');
    });
    await mobilePage.waitForTimeout(100);
    await mobilePage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '08-dialog-failure-mobile.png'),
    });

    // 09. Pause & Settings Modal with Live Telemetry
    await mobilePage.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.openModal('pause');
    });
    await mobilePage.waitForTimeout(100);
    await mobilePage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '09-dialog-pause-settings.png'),
    });

    // 10. Save Backup, Offline QR SVG & Diff Confirmation Modal
    await mobilePage.evaluate(() => {
      const code = document.querySelector<HTMLTextAreaElement>('#save-code-output')?.value || '';
      window.__SHREDBLOCKS_DEBUG__.openModal('save-transfer');
      const currentCode = document.querySelector<HTMLTextAreaElement>('#save-code-output')?.value || code;
      if (currentCode) {
        window.__SHREDBLOCKS_DEBUG__.previewSaveImport(currentCode);
      }
    });
    await mobilePage.waitForTimeout(150);
    await mobilePage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '10-dialog-save-transfer-qr-diff.png'),
    });

    // 11. Install App Guide Modal
    await mobilePage.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.openModal('install');
    });
    await mobilePage.waitForTimeout(100);
    await mobilePage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '11-dialog-install-guide.png'),
    });

    // 12. Themes Studio Screen
    await mobilePage.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.closeAllModals();
      document.getElementById('btn-pause')?.click();
      document.getElementById('btn-pause-home')?.click();
      document.getElementById('tab-btn-themes')?.click();
    });
    await mobilePage.waitForTimeout(150);
    await mobilePage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '12-themes-studio-mobile.png'),
    });

    // 16. Locked Level Toast on Home Screen (PLAY-01 verification)
    await mobilePage.locator('#tab-btn-home').click();
    await mobilePage.locator('#roadmap-list .level-node-card').nth(4).click();
    await mobilePage.waitForTimeout(80);
    await mobilePage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '16-interactive-home-locked-toast.png'),
    });

    // 14. Interactive Mid-Drag Lifted Block + Cyan Reticle + Green Gate Beam + Hint Arrow
    await mobilePage.locator('#level-jump-input').fill('2');
    await mobilePage.locator('#btn-level-jump').click();
    await mobilePage.waitForTimeout(100);
    await mobilePage.locator('#btn-booster-freeze').click();
    await mobilePage.waitForTimeout(80);
    const dragPts = await mobilePage.evaluate(() => {
      const start = window.__SHREDBLOCKS_DEBUG__.boardToScreen(3.5, 2.5);
      const mid = window.__SHREDBLOCKS_DEBUG__.boardToScreen(3.85, 2.5);
      const gate = window.__SHREDBLOCKS_DEBUG__.boardToScreen(4.5, 2.5);
      return { start, mid, gate };
    });
    await mobilePage.mouse.move(dragPts.start.x, dragPts.start.y);
    await mobilePage.mouse.down();
    await mobilePage.mouse.move(dragPts.mid.x, dragPts.mid.y, { steps: 5 });
    await mobilePage.waitForTimeout(60);
    await mobilePage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '14-interactive-middrag-reticle-and-hint.png'),
    });

    // 15. Complete drag into the RIGHT gate to trigger active 3D shredder particle burst
    await mobilePage.mouse.move(dragPts.gate.x, dragPts.gate.y, { steps: 5 });
    await mobilePage.mouse.up();
    await mobilePage.waitForTimeout(45);
    await mobilePage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '15-interactive-shred-particles-burst.png'),
    });

    await mobileCtx.close();

    // =========================================================================
    // 2. COMPACT MOBILE PORTRAIT (360x640 @ 2x DPR — Small Android / iPhone SE)
    // =========================================================================
    const compactCtx = await browser.newContext({
      viewport: { width: 360, height: 640 },
      deviceScaleFactor: 2,
    });
    const compactPage = await compactCtx.newPage();
    compactPage.on('pageerror', (err) => errors.push(`COMPACT_PAGEERROR: ${err.message}`));

    await compactPage.goto(BASE_URL, { waitUntil: 'networkidle' });
    await compactPage.evaluate(() => window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('home'));
    await compactPage.waitForTimeout(100);
    // 17. Compact Mobile Home Roadmap (360x640)
    await compactPage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '17-compact-360x640-home-roadmap.png'),
    });

    // 18. Compact Mobile In-Game Gameplay with Neon Cyber + Mint Studio Theme on Level 61 (Lock & Key)
    await compactPage.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setTheme('neon_cyber', 'mint_studio', 'lightning_bolts');
      window.__SHREDBLOCKS_DEBUG__.loadLevel(61);
    });
    await compactPage.waitForTimeout(150);
    await compactPage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '18-compact-360x640-level-061-neon-theme.png'),
    });

    await compactCtx.close();

    // =========================================================================
    // 3. TABLET PORTRAIT (768x1024 @ 2x DPR — iPad Mini / Air Class)
    // =========================================================================
    const tabletCtx = await browser.newContext({
      viewport: { width: 768, height: 1024 },
      deviceScaleFactor: 2,
    });
    const tabletPage = await tabletCtx.newPage();
    tabletPage.on('pageerror', (err) => errors.push(`TABLET_PAGEERROR: ${err.message}`));

    await tabletPage.goto(BASE_URL, { waitUntil: 'networkidle' });
    await tabletPage.evaluate(() => window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('home'));
    await tabletPage.waitForTimeout(100);
    // 19. Tablet Portrait Home Roadmap (768x1024)
    await tabletPage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '19-tablet-768x1024-home-roadmap.png'),
    });

    // 20. Tablet Portrait In-Game Gameplay with Gummy Jelly + Frosted Quartz Theme on Level 121
    await tabletPage.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setTheme('gummy_jelly', 'frosted_quartz', 'soap_bubbles');
      window.__SHREDBLOCKS_DEBUG__.loadLevel(121);
    });
    await tabletPage.waitForTimeout(150);
    await tabletPage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '20-tablet-768x1024-level-121-gummy-theme.png'),
    });

    await tabletCtx.close();

    // =========================================================================
    // 4. DESKTOP WIDESCREEN LANDSCAPE (1440x900 @ 2x DPR)
    // =========================================================================
    const desktopCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const desktopPage = await desktopCtx.newPage();
    desktopPage.on('pageerror', (err) => errors.push(`DESKTOP_PAGEERROR: ${err.message}`));

    await desktopPage.goto(BASE_URL, { waitUntil: 'networkidle' });
    await desktopPage.waitForTimeout(150);
    // 31. Desktop Widescreen Title Screen (1440x900)
    await desktopPage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '31-desktop-1440x900-title-screen.png'),
    });
    await desktopPage.evaluate(() => window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('home'));
    await desktopPage.waitForTimeout(100);
    // 21. Desktop Widescreen Home Roadmap (1440x900)
    await desktopPage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '21-desktop-1440x900-home-roadmap.png'),
    });

    // 13. Level 200 Grand Finale on Desktop Landscape with Carved Wood & Warm Birch Theme
    await desktopPage.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setTheme('carved_wood', 'warm_birch', 'star_confetti');
      window.__SHREDBLOCKS_DEBUG__.loadLevel(200);
    });
    await desktopPage.waitForTimeout(200);
    await desktopPage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '13-level-200-desktop-wood-theme.png'),
    });

    // 22. Desktop Widescreen Smooth Bevel + Midnight Arcade Theme on Level 81 (Wooden Crates)
    await desktopPage.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setTheme('smooth_bevel', 'midnight_arcade', 'pixel_sparks');
      window.__SHREDBLOCKS_DEBUG__.loadLevel(81);
    });
    await desktopPage.waitForTimeout(150);
    await desktopPage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '22-desktop-1440x900-level-081-arcade-theme.png'),
    });

    // 23. Level 21: Immovable Interior Pillars (occ === -2, Dark Obsidian-Bronze + Brass Lock) & Cutouts
    await desktopPage.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setTheme('classic_studs', 'industrial_slate', 'micro_cubes');
      window.__SHREDBLOCKS_DEBUG__.loadLevel(21);
    });
    await desktopPage.waitForTimeout(150);
    await desktopPage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '23-level-021-pillars-and-cutouts.png'),
    });

    // 24. Level 71: Movable Neutral Stone Sliders (color: 0, Brushed Silver-Steel + Crosshatch)
    await desktopPage.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setTheme('classic_studs', 'industrial_slate', 'micro_cubes');
      window.__SHREDBLOCKS_DEBUG__.loadLevel(71);
    });
    await desktopPage.waitForTimeout(150);
    await desktopPage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '24-level-071-movable-stone-sliders.png'),
    });

    // 25. Level 11: Full-Block 3D Axis-Lock Directional Rail Channels + Sculpted Medallion + 3D Perimeter Frame Guide (Desktop)
    await desktopPage.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setTheme('classic_studs', 'industrial_slate', 'micro_cubes');
      window.__SHREDBLOCKS_DEBUG__.loadLevel(11);
    });
    await desktopPage.waitForTimeout(180);
    await desktopPage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '25-level-011-axis-lock-rails-and-guide.png'),
    });

    // 26. Level 250: Citadel Sovereign (8x8 Grand Citadel Courtyard)
    await desktopPage.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.loadLevel(250);
    });
    await desktopPage.waitForTimeout(160);
    await desktopPage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '26-level-250-citadel-8x8.png'),
    });

    // 27. Level 300: Sacred Astrolabe (9x9 Campaign Finale Sanctuary)
    await desktopPage.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.loadLevel(300);
    });
    await desktopPage.waitForTimeout(160);
    await desktopPage.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '27-level-300-astrolabe-9x9.png'),
    });

    await desktopCtx.close();

    // 28. Mobile Portrait 390x844 Level 11 (exact match to user's attached screenshot viewport)
    const mobileL11Ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    const mobileL11Page = await mobileL11Ctx.newPage();
    await mobileL11Page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await mobileL11Page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setTheme('classic_studs', 'industrial_slate', 'micro_cubes');
      window.__SHREDBLOCKS_DEBUG__.loadLevel(11);
    });
    await mobileL11Page.waitForTimeout(180);
    await mobileL11Page.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '28-mobile-level-011-axis-lock-rails-and-guide.png'),
    });

    // 32. Level 18: East Wing Alcove (L_WING Sculpted Courtyard + Stepped-Edge TOP Gate at row 2)
    await mobileL11Page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.loadLevel(18);
    });
    await mobileL11Page.waitForTimeout(180);
    await mobileL11Page.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '32-level-018-stepped-gate-l-wing-mobile.png'),
    });

    // 33. Level 25: Twin Sanctum (TWIN_SANCTUM Multi-Room Portcullis Barrier + Sunken Twilight North Chamber)
    await mobileL11Page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.loadLevel(25);
    });
    await mobileL11Page.waitForTimeout(180);
    await mobileL11Page.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '33-level-025-twin-sanctum-locked-mobile.png'),
    });

    // 35. Level 25: Twin Sanctum with Custom Theme (Frosted Quartz Tray + Gummy Jelly Skin)
    await mobileL11Page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setTheme('gummy_jelly', 'frosted_quartz', 'soap_bubbles');
      window.__SHREDBLOCKS_DEBUG__.loadLevel(25);
    });
    await mobileL11Page.waitForTimeout(180);
    await mobileL11Page.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '35-level-025-twin-sanctum-frosted-quartz-theme.png'),
    });

    // 36. Level 31: Multi-Layer Blocks + Custom Warm Birch Tray & Neon Cyber Skin + High Contrast + Colorblind Symbols
    await mobileL11Page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setTheme('neon_cyber', 'warm_birch', 'lightning_bolts');
      window.__SHREDBLOCKS_DEBUG__.setHighContrast(true);
      window.__SHREDBLOCKS_DEBUG__.setColorblindMode(true);
      window.__SHREDBLOCKS_DEBUG__.loadLevel(31);
    });
    await mobileL11Page.waitForTimeout(180);
    await mobileL11Page.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '36-level-031-custom-theme-high-contrast-colorblind-mobile.png'),
    });

    // 37. Level 25: Twin Sanctum + Custom Frosted Quartz Tray & Gummy Jelly Skin + High Contrast + Colorblind Symbols
    await mobileL11Page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setTheme('gummy_jelly', 'frosted_quartz', 'soap_bubbles');
      window.__SHREDBLOCKS_DEBUG__.setHighContrast(true);
      window.__SHREDBLOCKS_DEBUG__.setColorblindMode(true);
      window.__SHREDBLOCKS_DEBUG__.loadLevel(25);
    });
    await mobileL11Page.waitForTimeout(180);
    await mobileL11Page.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '37-level-025-frosted-quartz-high-contrast-colorblind-mobile.png'),
    });

    // 38. Level 28: Gilded Vault (8x6 Tall Portrait Sealed Mystery Vault + Synchronized Frozen Gate)
    await mobileL11Page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setHighContrast(false);
      window.__SHREDBLOCKS_DEBUG__.setColorblindMode(false);
      window.__SHREDBLOCKS_DEBUG__.setTheme('classic_studs', 'industrial_slate', 'micro_cubes');
      window.__SHREDBLOCKS_DEBUG__.loadLevel(28);
    });
    await mobileL11Page.waitForTimeout(180);
    await mobileL11Page.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '38-level-028-mystery-vault-sealed-mobile.png'),
    });

    // 41. Level 28: Unsealed Mystery Vault Reveal + Thawed Bottom Gate after 3 Shreds
    await mobileL11Page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.commitMove(1, 0, 2);
      window.__SHREDBLOCKS_DEBUG__.commitMove(2, 0, 2);
      window.__SHREDBLOCKS_DEBUG__.commitMove(4, 2, 0);
    });
    await mobileL11Page.waitForTimeout(220);
    await mobileL11Page.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '41-level-028-mystery-vault-unsealed-reveal-mobile.png'),
    });

    // 39. Level 38: Hourglass Vault (8x6 Central Mystery Vault Island)
    await mobileL11Page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.loadLevel(38);
    });
    await mobileL11Page.waitForTimeout(180);
    await mobileL11Page.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '39-level-038-central-hourglass-vault-mobile.png'),
    });

    // 40. Level 74: Quad Vault Sanctum (9x7 Tall Portrait Multi-Vault Puzzle Box)
    await mobileL11Page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.loadLevel(74);
    });
    await mobileL11Page.waitForTimeout(180);
    await mobileL11Page.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '40-level-074-quad-vault-tall-portrait-mobile.png'),
    });

    // 42. Level 74: Quad Vault Sanctum with High Contrast + Colorblind Symbols + Frosted Quartz Theme
    await mobileL11Page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setTheme('gummy_jelly', 'frosted_quartz', 'soap_bubbles');
      window.__SHREDBLOCKS_DEBUG__.setHighContrast(true);
      window.__SHREDBLOCKS_DEBUG__.setColorblindMode(true);
      window.__SHREDBLOCKS_DEBUG__.loadLevel(74);
    });
    await mobileL11Page.waitForTimeout(180);
    await mobileL11Page.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '42-level-074-quad-vault-high-contrast-colorblind-mobile.png'),
    });

    // 34. Level 25: Title Screen Wall-Scroll Diagram over Twin Sanctum Multi-Room Courtyard
    await mobileL11Page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setHighContrast(false);
      window.__SHREDBLOCKS_DEBUG__.setColorblindMode(false);
      window.__SHREDBLOCKS_DEBUG__.setTheme('classic_studs', 'industrial_slate', 'micro_cubes');
      window.__SHREDBLOCKS_DEBUG__.loadLevel(25);
      window.__SHREDBLOCKS_DEBUG__.openTitleScreen();
    });
    await mobileL11Page.waitForTimeout(180);
    await mobileL11Page.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '34-level-025-twin-sanctum-title-scroll-mobile.png'),
    });

    // 43. Title Screen with Contextual In-Flow Sanctuary Update Ribbon (`PWA-UPDATE-01`)
    await mobileL11Page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setPwaUpdateBannerVisible(true);
    });
    await mobileL11Page.waitForTimeout(140);
    await mobileL11Page.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '43-title-screen-pwa-update-ribbon-mobile.png'),
    });

    // 44. Sanctuary Map (#screen-home) with Contextual In-Flow Sanctuary Update Ribbon (`PWA-UPDATE-01`)
    await mobileL11Page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('home');
      window.__SHREDBLOCKS_DEBUG__.setPwaUpdateBannerVisible(true);
    });
    await mobileL11Page.waitForTimeout(140);
    await mobileL11Page.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '44-home-map-pwa-update-ribbon-mobile.png'),
    });

    // 45. Android WebAPK 472x986 Level 29 (`Neon Crucible`) Zero-Cutoff Verification (`VIEWPORT-01`)
    await mobileL11Page.setViewportSize({ width: 472, height: 986 });
    await mobileL11Page.evaluate(() => {
      window.__SHREDBLOCKS_DEBUG__.setPwaUpdateBannerVisible(false);
      window.__SHREDBLOCKS_DEBUG__.setPlayMode('TIMED');
      window.__SHREDBLOCKS_DEBUG__.loadLevel(29);
    });
    await mobileL11Page.waitForTimeout(180);
    await mobileL11Page.screenshot({
      path: join(ARTIFACT_SCRATCH_DIR, '45-level-029-android-472x986-no-cutoff-mobile.png'),
    });

    await mobileL11Ctx.close();

    if (errors.length > 0) {
      throw new Error(`Visual harness encountered runtime errors:\n${errors.join('\n')}`);
    }

    console.log('✅ Captured all 45 multi-viewport visual verification screenshots cleanly with 0 errors.');
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (serverProc && serverProc.exitCode === null && !serverProc.killed) {
      serverProc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 150));
      if (serverProc.exitCode === null && !serverProc.killed) {
        serverProc.kill('SIGKILL');
      }
    }
  }
}

runVisualHarness().catch((err) => {
  console.error(err);
  process.exit(1);
});
