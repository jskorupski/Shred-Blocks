/**
 * Fast, parameterized UI & multi-viewport visual probe (`AGENT-PROBE-01`).
 *
 * Captures targeted scenes across `VIEWPORT-MATRIX-01` tiers and automatically runs
 * `auditViewportGeometry` (horizontal overflow, dialog scroll reachability, clipped controls,
 * and console/page errors) without executing the full 45-shot `visual-harness.ts` suite.
 *
 * Prefix-matchable CLI usage (`BypassSandbox: true` when starting local preview or hitting `:8443`):
 *   ./node_modules/.bin/tsx scripts/ui-probe.ts --scene pause-expanded --viewports matrix
 *   ./node_modules/.bin/tsx scripts/ui-probe.ts --scene themes-locked --viewports mobile,desktop --out-dir /tmp/probe
 *   ./node_modules/.bin/tsx scripts/ui-probe.ts --scene game --level 41 --mode TIMED --lan
 */

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlayMode } from '../src/core/types';
import {
  auditViewportGeometry,
  type Page,
  parseViewportSpec,
  seedPlayerSave,
  type ViewportAuditReport,
  type ViewportPreset,
  withHarnessSession,
} from './lib/agent-harness';

export const PROBE_SCENES = [
  'title',
  'title-returning',
  'home',
  'game',
  'pause',
  'pause-owned',
  'pause-expanded',
  'themes',
  'themes-locked',
  'victory',
  'failure',
  'save-transfer',
  'install',
] as const;

export type ProbeScene = (typeof PROBE_SCENES)[number];

export interface ProbeCliOptions {
  scenes: ProbeScene[];
  viewports: ViewportPreset[];
  levelId: number;
  mode: PlayMode;
  pwaUpdate: boolean;
  highContrast: boolean;
  colorblind: boolean;
  reducedMotion: boolean;
  useLan: boolean;
  port?: number;
  outDir: string;
  prefix: string;
  stressChrome: boolean;
  strictAudit: boolean;
  help: boolean;
}

const VALID_SCENE_SET = new Set<string>(PROBE_SCENES);
const VALID_MODES = new Set<string>(['CHALLENGE', 'ZEN', 'TIMED']);

export function formatProbeHelp(): string {
  return [
    'Usage: ./node_modules/.bin/tsx scripts/ui-probe.ts [options]',
    '',
    'Options:',
    `  --scene <list>       Comma-separated scenes (${PROBE_SCENES.join(', ')}) [default: game]`,
    '  --viewports <spec>   "quick", "matrix", preset names, or WxH list [default: quick]',
    '  --level <n>          Stage ID to load for gameplay/modal scenes [default: 12]',
    '  --mode <mode>        CHALLENGE | ZEN | TIMED [default: CHALLENGE]',
    '  --pwa-update         Show the global PWA Update Ready banner on compatible scenes',
    '  --high-contrast      Enable High Contrast mode',
    '  --colorblind         Enable Colorblind symbols mode',
    '  --reduced-motion     Enable Reduced Motion mode',
    '  --lan                Connect to running https://127.0.0.1:8443 instead of spawning dist/ preview',
    '  --port <n>           Strict port for vite preview [default: 4180]',
    '  --out-dir <dir>      Output folder for PNGs + probe-audit.json [default: test-results/probe]',
    '  --prefix <name>      Filename prefix [default: probe]',
    '  --stress-chrome      Show optional Install/Resume CTAs + 5-digit economy counts to stress single-line headers',
    '  --no-strict-audit    Record layout violations without failing process exit code',
    '  --help, -h           Print this usage summary',
  ].join('\n');
}

/**
 * Parses CLI arguments for `scripts/ui-probe.ts` with strict validation so typos fail fast.
 */
export function parseProbeCliArgs(argv: readonly string[]): ProbeCliOptions {
  let sceneRaw = 'game';
  let viewportRaw = 'quick';
  let levelId = 12;
  let mode: PlayMode = 'CHALLENGE';
  let pwaUpdate = false;
  let highContrast = false;
  let colorblind = false;
  let reducedMotion = false;
  let useLan = false;
  let port: number | undefined;
  let outDir = resolve(process.cwd(), 'test-results', 'probe');
  let prefix = 'probe';
  let stressChrome = false;
  let strictAudit = true;
  let help = false;

  const takeValue = (idx: number, flag: string): string => {
    const val = argv[idx + 1];
    if (!val || val.startsWith('--')) {
      throw new Error(`Missing value after ${flag}`);
    }
    return val;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        help = true;
        break;
      case '--scene':
      case '--scenes':
        sceneRaw = takeValue(i, arg);
        i++;
        break;
      case '--viewports':
      case '--viewport':
        viewportRaw = takeValue(i, arg);
        i++;
        break;
      case '--level': {
        const parsed = Number(takeValue(i, arg));
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error(`Invalid --level "${argv[i + 1]}": expected positive integer`);
        }
        levelId = parsed;
        i++;
        break;
      }
      case '--mode': {
        const rawMode = takeValue(i, arg).toUpperCase();
        if (!VALID_MODES.has(rawMode)) {
          throw new Error(`Invalid --mode "${rawMode}": expected CHALLENGE, ZEN, or TIMED`);
        }
        mode = rawMode as PlayMode;
        i++;
        break;
      }
      case '--pwa-update':
        pwaUpdate = true;
        break;
      case '--high-contrast':
        highContrast = true;
        break;
      case '--colorblind':
        colorblind = true;
        break;
      case '--reduced-motion':
        reducedMotion = true;
        break;
      case '--lan':
        useLan = true;
        break;
      case '--port': {
        const parsedPort = Number(takeValue(i, arg));
        if (!Number.isInteger(parsedPort) || parsedPort < 1024 || parsedPort > 65535) {
          throw new Error(`Invalid --port "${argv[i + 1]}": expected 1024..65535`);
        }
        port = parsedPort;
        i++;
        break;
      }
      case '--out-dir':
        outDir = resolve(takeValue(i, arg));
        i++;
        break;
      case '--prefix':
        prefix = takeValue(i, arg).replace(/[^A-Za-z0-9._-]/g, '-');
        i++;
        break;
      case '--stress-chrome':
        stressChrome = true;
        break;
      case '--no-strict-audit':
        strictAudit = false;
        break;
      case '--strict-audit':
        strictAudit = true;
        break;
      default:
        throw new Error(`Unknown CLI flag "${arg}". Pass --help to view supported flags.`);
    }
  }

  const scenes = sceneRaw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => {
      if (!VALID_SCENE_SET.has(s)) {
        throw new Error(`Unknown scene "${s}". Valid scenes: ${PROBE_SCENES.join(', ')}`);
      }
      return s as ProbeScene;
    });

  if (scenes.length === 0) {
    throw new Error('At least one --scene must be specified.');
  }

  return {
    scenes,
    viewports: parseViewportSpec(viewportRaw),
    levelId,
    mode,
    pwaUpdate,
    highContrast,
    colorblind,
    reducedMotion,
    useLan,
    port,
    outDir,
    prefix,
    stressChrome,
    strictAudit,
    help,
  };
}

async function applyBaseFlags(page: Page, opts: ProbeCliOptions): Promise<void> {
  await page.evaluate(
    ({ mode, hc, cb, rm }) => {
      const dbg = window.__SHREDBLOCKS_DEBUG__;
      dbg.closeAllModals();
      dbg.setPlayMode(mode);
      dbg.setHighContrast(hc);
      dbg.setColorblindMode(cb);
      dbg.setReducedMotion(rm);
    },
    {
      mode: opts.mode,
      hc: opts.highContrast,
      cb: opts.colorblind,
      rm: opts.reducedMotion,
    }
  );
}

async function navigateToScene(page: Page, scene: ProbeScene, opts: ProbeCliOptions): Promise<void> {
  if (scene === 'pause-owned' || scene === 'pause-expanded') {
    await seedPlayerSave(page, {
      coins: 640,
      unlockedSkins: ['classic_studs', 'relic_stone', 'carved_wood'],
      unlockedTrays: ['industrial_slate', 'warm_birch', 'mint_studio'],
      unlockedParticles: ['micro_cubes', 'star_confetti', 'soap_bubbles'],
      equippedSkin: 'relic_stone',
      equippedTray: 'warm_birch',
      equippedParticle: 'soap_bubbles',
    });
  } else if (scene === 'title-returning') {
    await seedPlayerSave(page, {
      highestUnlocked: Math.max(opts.levelId, 14),
      currentLevelId: Math.max(opts.levelId, 14),
      coins: 320,
    });
  }

  await applyBaseFlags(page, opts);

  if (opts.stressChrome) {
    const stressLevel = Math.max(opts.levelId, 299);
    await page.evaluate((lvl) => {
      try {
        localStorage.removeItem('shredblocks_pwa_installed_v1');
      } catch {
        // Ignore storage restrictions
      }
      window.__SHREDBLOCKS_DEBUG__.patchSave({
        coins: 99999,
        totalStars: 2700,
        winStreak: 150,
        highestLevelUnlocked: lvl,
        currentLevelId: lvl,
      });
      const ev = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: async () => {},
        userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
      });
      window.dispatchEvent(ev);
    }, stressLevel);
  }

  switch (scene) {
    case 'title':
    case 'title-returning':
      await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.openTitleScreen());
      break;
    case 'home':
      await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('home'));
      break;
    case 'game':
      await page.evaluate((lvl) => {
        window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('game');
        window.__SHREDBLOCKS_DEBUG__.loadLevel(lvl);
      }, opts.levelId);
      break;
    case 'pause':
    case 'pause-owned':
    case 'pause-expanded':
      await page.evaluate((lvl) => {
        window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('game');
        window.__SHREDBLOCKS_DEBUG__.loadLevel(lvl);
        window.__SHREDBLOCKS_DEBUG__.openModal('pause');
      }, opts.levelId);
      if (scene === 'pause-expanded') {
        const expanded = await page.locator('#btn-toggle-cosmetics-drawer').getAttribute('aria-expanded');
        if (expanded !== 'true') {
          await page.locator('#btn-toggle-cosmetics-drawer').click();
        }
      }
      break;
    case 'themes':
    case 'themes-locked':
      if (opts.stressChrome) {
        const stressLevel = Math.max(opts.levelId, 299);
        await page.evaluate((lvl) => {
          window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('game');
          window.__SHREDBLOCKS_DEBUG__.loadLevel(lvl);
          window.__SHREDBLOCKS_DEBUG__.openModal('pause');
        }, stressLevel);
        const expanded = await page.locator('#btn-toggle-cosmetics-drawer').getAttribute('aria-expanded');
        if (expanded !== 'true') {
          await page.locator('#btn-toggle-cosmetics-drawer').click();
        }
        await page.locator('#btn-pause-open-themes').click();
      } else {
        await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('themes'));
      }
      if (scene === 'themes-locked') {
        const lockedSwatch = page.locator('#themes-grid-particles .theme-card-top').nth(3);
        if ((await lockedSwatch.count()) > 0) {
          await lockedSwatch.click();
        }
      }
      break;
    case 'victory':
      await page.evaluate(
        (lvl) => {
          window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('game');
          window.__SHREDBLOCKS_DEBUG__.loadLevel(lvl);
          window.__SHREDBLOCKS_DEBUG__.setReducedMotion(true);
          window.__SHREDBLOCKS_DEBUG__.autoSolveCurrentLevel();
        },
        Math.min(opts.levelId, 15)
      );
      await page.waitForSelector('#dialog-victory[open]', { timeout: 5_000 });
      break;
    case 'failure':
      await page.evaluate((lvl) => {
        window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('game');
        window.__SHREDBLOCKS_DEBUG__.loadLevel(lvl);
        window.__SHREDBLOCKS_DEBUG__.openModal('failure');
      }, opts.levelId);
      break;
    case 'save-transfer':
      await page.evaluate(() => {
        window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('home');
        window.__SHREDBLOCKS_DEBUG__.openModal('save-transfer');
      });
      break;
    case 'install':
      await page.evaluate(() => {
        window.__SHREDBLOCKS_DEBUG__.dismissTitleScreen('home');
        window.__SHREDBLOCKS_DEBUG__.openModal('install');
      });
      break;
  }

  if (opts.pwaUpdate) {
    await page.evaluate(() => window.__SHREDBLOCKS_DEBUG__.setPwaUpdateBannerVisible(true));
  }

  await page.waitForTimeout(160);
}

interface SceneAuditEntry extends ViewportAuditReport {
  scene: ProbeScene;
  screenshotPath: string;
}

export async function runUiProbe(opts: ProbeCliOptions): Promise<{
  entries: SceneAuditEntry[];
  runtimeErrors: string[];
}> {
  const entries: SceneAuditEntry[] = [];
  let capturedErrors: string[] = [];

  await withHarnessSession(
    {
      outDir: opts.outDir,
      useLan: opts.useLan,
      port: opts.port,
    },
    async (session) => {
      for (const scene of opts.scenes) {
        for (const vp of opts.viewports) {
          const { context, page } = await session.openViewportPage(vp);
          try {
            await navigateToScene(page, scene, opts);
            const filename = `${opts.prefix}-${scene}-${vp.name}.png`;
            const screenshotPath = await session.saveScreenshot(page, filename);
            const report = await auditViewportGeometry(page, vp.name);
            entries.push({
              ...report,
              scene,
              screenshotPath,
            });
            const statusIcon = report.passed ? 'PASS' : 'FAIL';
            process.stdout.write(
              `[${statusIcon}] ${scene} @ ${vp.width}x${vp.height} -> ${screenshotPath}\n`
            );
            if (!report.passed) {
              process.stderr.write(`       Audit details: ${JSON.stringify(report)}\n`);
            }
          } finally {
            await context.close();
          }
        }
      }
      capturedErrors = [...session.runtimeErrors];
      writeFileSync(
        join(session.outDir, `${opts.prefix}-audit.json`),
        `${JSON.stringify({ entries, runtimeErrors: capturedErrors }, null, 2)}\n`,
        'utf8'
      );
    }
  );

  return { entries, runtimeErrors: capturedErrors };
}

async function main(): Promise<void> {
  const opts = parseProbeCliArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${formatProbeHelp()}\n`);
    return;
  }

  const { entries, runtimeErrors } = await runUiProbe(opts);
  const failedEntries = entries.filter((e) => !e.passed);

  if (runtimeErrors.length > 0) {
    process.stderr.write(`Runtime console/page errors (${runtimeErrors.length}):\n`);
    for (const err of runtimeErrors) {
      process.stderr.write(`  - ${err}\n`);
    }
  }

  if (opts.strictAudit && (failedEntries.length > 0 || runtimeErrors.length > 0)) {
    process.exit(1);
  }
}

const isDirectEntry = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectEntry) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack || err.message : String(err)}\n`);
    process.exit(1);
  });
}
